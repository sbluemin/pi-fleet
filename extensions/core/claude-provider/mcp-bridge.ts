/**
 * core/claude-provider — MCP 브릿지 모듈
 *
 * pi의 context.tools를 Claude Agent SDK의 MCP 서버로 변환하는 브릿지.
 * 원본: pi-claude-bridge/index.ts에서 MCP 관련 로직만 추출·포팅.
 *
 * imports → types → constants → functions 순서 준수.
 */

import type { Context, Tool } from "@mariozechner/pi-ai";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

import type { McpResult, McpContent, McpContentBlock, PendingToolCall, ToolNameMap } from "./types.ts";
import { MCP_SERVER_NAME } from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** MCP tool 이름 접두사 — SDK가 MCP 서버의 tool을 식별하는 데 사용 */
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// ═══════════════════════════════════════════════════════════════════════════
// Functions — Schema 변환
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TypeBox JSON Schema property → Zod 타입 변환.
 *
 * createSdkMcpServer는 내부적으로 zodToJsonSchema()를 호출하여 tool의
 * inputSchema를 변환함. 일반 JSON Schema 객체는 `{type: "object", properties: {}}`로
 * fallback되어 모델이 파라미터를 인식하지 못함.
 * Zod 객체를 제공해야 SDK가 올바른 스키마를 생성함.
 */
export function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodTypeAny {
	let base: z.ZodTypeAny;
	if (Array.isArray(prop.enum)) {
		base = z.enum(prop.enum as [string, ...string[]]);
	} else {
		switch (prop.type) {
			case "string":
				base = z.string();
				break;
			case "number":
			case "integer":
				base = z.number();
				break;
			case "boolean":
				base = z.boolean();
				break;
			case "array":
				base = prop.items
					? z.array(jsonSchemaPropertyToZod(prop.items as Record<string, unknown>))
					: z.array(z.unknown());
				break;
			case "object":
				base = z.record(z.string(), z.unknown());
				break;
			default:
				base = z.unknown();
		}
	}
	if (typeof prop.description === "string") base = base.describe(prop.description);
	return base;
}

/**
 * JSON Schema (object) → Zod shape 변환.
 * required 배열에 포함된 키는 필수, 나머지는 optional.
 */
function jsonSchemaToZodShape(schema: unknown): Record<string, z.ZodTypeAny> {
	const s = schema as Record<string, unknown>;
	if (!s || s.type !== "object" || !s.properties) return {};
	const props = s.properties as Record<string, Record<string, unknown>>;
	const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const [key, prop] of Object.entries(props)) {
		const zodProp = jsonSchemaPropertyToZod(prop);
		shape[key] = required.has(key) ? zodProp : zodProp.optional();
	}
	return shape;
}

// ═══════════════════════════════════════════════════════════════════════════
// Functions — Tool 결과 변환
// ═══════════════════════════════════════════════════════════════════════════

/**
 * pi tool result content → MCP content 블록 배열로 변환.
 * text와 image 타입만 지원, 빈 결과는 빈 텍스트 블록으로 대체.
 */
function toolResultToMcpContent(
	content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): McpContent {
	if (typeof content === "string") return [{ type: "text", text: content || "" }];
	if (!Array.isArray(content)) return [{ type: "text", text: "" }];
	const blocks: McpContent = [];
	for (const block of content) {
		if (block.type === "text" && block.text) {
			blocks.push({ type: "text", text: block.text });
		} else if (block.type === "image" && block.data && block.mimeType) {
			blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
		}
	}
	return blocks.length ? blocks : [{ type: "text", text: "" }];
}

// ═══════════════════════════════════════════════════════════════════════════
// Functions — MCP Tool 해석
// ═══════════════════════════════════════════════════════════════════════════

/** resolveMcpTools 반환 타입 */
export interface ResolveMcpToolsResult {
	mcpTools: Tool[];
	customToolNameToSdk: ToolNameMap;
	customToolNameToPi: ToolNameMap;
}

/**
 * context.tools를 MCP tool 정의로 변환.
 *
 * 내장 tool은 `tools: []`로 비활성화되어 있으므로,
 * context.tools에 있는 모든 tool을 MCP tool로 등록함.
 * pi tool name을 그대로 사용하되 MCP prefix만 추가/제거.
 */
export function resolveMcpTools(context: Context): ResolveMcpToolsResult {
	const mcpTools: Tool[] = [];
	const customToolNameToSdk: ToolNameMap = new Map();
	const customToolNameToPi: ToolNameMap = new Map();

	if (!context.tools) return { mcpTools, customToolNameToSdk, customToolNameToPi };

	for (const tool of context.tools) {
		const sdkName = `${MCP_TOOL_PREFIX}${tool.name}`;
		mcpTools.push(tool);
		// 양방향 매핑: 대소문자 구분 없이 조회 가능하도록 원본 + lowercase 모두 등록
		customToolNameToSdk.set(tool.name, sdkName);
		customToolNameToSdk.set(tool.name.toLowerCase(), sdkName);
		customToolNameToPi.set(sdkName, tool.name);
		customToolNameToPi.set(sdkName.toLowerCase(), tool.name);
	}

	return { mcpTools, customToolNameToSdk, customToolNameToPi };
}

// ═══════════════════════════════════════════════════════════════════════════
// Functions — MCP 서버 생성
// ═══════════════════════════════════════════════════════════════════════════

/**
 * MCP tool 정의로부터 SDK MCP 서버를 생성.
 *
 * 각 tool handler는 FIFO 큐 기반으로 동작:
 * - pendingResults에 결과가 있으면 즉시 반환
 * - 없으면 Promise를 생성하여 pendingToolCalls에 등록 후 대기
 *
 * SDK는 tool_use 순서대로 handler를 호출하고,
 * pi는 동일 순서로 결과를 전달하므로 위치 기반 매칭이 정확함.
 *
 * @param mcpTools - resolveMcpTools()에서 반환된 tool 목록
 * @param pendingToolCalls - FIFO 대기열 (handler가 결과를 기다리는 Promise)
 * @param pendingResults - FIFO 대기열 (pi가 먼저 전달한 결과)
 */
export function buildMcpServers(
	mcpTools: Tool[],
	pendingToolCalls: PendingToolCall[],
	pendingResults: McpResult[],
): Record<string, ReturnType<typeof createSdkMcpServer>> | undefined {
	if (!mcpTools.length) return undefined;

	const tools = mcpTools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: jsonSchemaToZodShape(tool.parameters),
		handler: async (): Promise<McpResult> => {
			// 결과가 이미 도착했으면 큐에서 꺼내 반환
			if (pendingResults.length > 0) {
				return pendingResults.shift()!;
			}
			// 아직 결과가 없으면 Promise로 대기
			return new Promise<McpResult>((resolve) => {
				pendingToolCalls.push({ toolName: tool.name, resolve });
			});
		},
	}));

	const server = createSdkMcpServer({
		name: MCP_SERVER_NAME,
		version: "1.0.0",
		tools,
	});

	return { [MCP_SERVER_NAME]: server };
}

// ═══════════════════════════════════════════════════════════════════════════
// Functions — Tool Result 추출
// ═══════════════════════════════════════════════════════════════════════════

/**
 * context.messages 끝에서 현재 턴의 tool result를 추출.
 *
 * 메시지 배열을 역순으로 순회하며 toolResult 메시지를 수집.
 * assistant 또는 user 메시지를 만나면 중단 — 현재 턴의 결과만 반환.
 */
export function extractAllToolResults(context: Context): McpResult[] {
	const results: McpResult[] = [];
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg.role === "toolResult") {
			results.unshift({
				content: toolResultToMcpContent(msg.content),
				isError: msg.isError,
			});
		} else if (msg.role === "user" || msg.role === "assistant") {
			break;
		}
	}
	return results;
}
