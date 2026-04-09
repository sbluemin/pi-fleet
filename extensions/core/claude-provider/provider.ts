/**
 * core/claude-provider/provider — fleet-cc native provider 메인 진입점
 *
 * pi-claude-bridge의 streamClaudeAgentSdk()를 포팅.
 * 핵심 변경: systemPrompt 문자열 직접 전달, tools: [] (내장 tool 비활성화),
 * skills/agents/settings 로직 제거, systemPrompt drift 감지 추가.
 *
 * imports → types → constants → functions 순서 준수.
 */

import type {
	AssistantMessageEventStream,
	Context,
	Model,
	SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { createSession } from "cc-session-io";

import {
	type FleetCcState,
	type SharedSession,
	type McpResult,
	type PendingToolCall,
	type ToolNameMap,
	ACTIVE_STREAM_KEY,
	MCP_SERVER_NAME,
	REASONING_TO_EFFORT,
	getOrInitState,
	hashSystemPrompt,
} from "./types.js";
import { resolveMcpTools, buildMcpServers, extractAllToolResults } from "./mcp-bridge.js";
import {
	consumeQuery,
	resetTurnState,
	finalizeCurrentStream,
	extractUserPrompt,
	extractUserPromptBlocks,
	wrapPromptStream,
} from "./message-mapper.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** MCP tool 이름 prefix — allowedTools 설정에 사용 */
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

/** 조건부 디버그 로깅 — FLEET_CC_DEBUG=1 으로 활성화 */
function debug(...args: unknown[]): void {
	if (process.env.FLEET_CC_DEBUG !== "1") return;
	console.debug("[fleet-cc:provider]", ...args);
}

/** 에러 메시지 추출 */
function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object") {
		const obj = err as Record<string, unknown>;
		if (typeof obj.message === "string") return obj.message;
		if (typeof obj.error === "string") return obj.error;
		try { return JSON.stringify(err); } catch { /* noop */ }
	}
	return String(err);
}

// ═══════════════════════════════════════════════════════════════════════════
// Session sync — cc-session-io 기반 세션 관리
// ═══════════════════════════════════════════════════════════════════════════

/**
 * pi 메시지를 Anthropic API 형식으로 변환 후 session에 import.
 *
 * 비손실: non-Anthropic thinking 블록은 signature가 없으므로 드롭.
 * text/image/toolCall 블록만 처리. assistant 메시지의 모든 블록이 필터링되면
 * 해당 메시지 자체를 드롭 — 시퀀스 불일치 가능 (SDK가 내부적으로 처리).
 */
function convertAndImportMessages(
	session: ReturnType<typeof createSession>,
	messages: Context["messages"],
	customToolNameToSdk?: ToolNameMap,
): void {
	const anthropicMessages: Array<{ role: string; content: unknown }> = [];
	const sanitizedIds = new Map<string, string>();
	const sanitizeToolId = (id: string): string => {
		const existing = sanitizedIds.get(id);
		if (existing) return existing;
		const clean = id.replace(/[^a-zA-Z0-9_-]/g, "_");
		sanitizedIds.set(id, clean);
		return clean;
	};

	for (const msg of messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				anthropicMessages.push({ role: "user", content: msg.content || "[empty]" });
			} else if (Array.isArray(msg.content)) {
				const parts: unknown[] = [];
				for (const block of msg.content) {
					if (block.type === "text" && block.text) {
						parts.push({ type: "text", text: block.text });
					} else if (block.type === "image" && (block as any).data && (block as any).mimeType) {
						parts.push({
							type: "image",
							source: { type: "base64", media_type: (block as any).mimeType, data: (block as any).data },
						});
					}
				}
				anthropicMessages.push({ role: "user", content: parts.length ? parts : "[image]" });
			} else {
				anthropicMessages.push({ role: "user", content: "[empty]" });
			}
		} else if (msg.role === "assistant") {
			const content = Array.isArray(msg.content) ? msg.content : [];
			const blocks: unknown[] = [];
			for (const block of content) {
				if (block.type === "text" && block.text) {
					blocks.push({ type: "text", text: block.text });
				} else if (block.type === "thinking") {
					const sig = (block as any).thinkingSignature;
					const isAnthropicProvider = (msg as any).provider === "Fleet CC"
						|| (msg as any).api === "anthropic";
					if (isAnthropicProvider && sig) {
						blocks.push({ type: "thinking", thinking: block.thinking ?? "", signature: sig });
					}
				} else if (block.type === "toolCall") {
					// pi tool name → SDK tool name 매핑
					const sdkName = mapPiToolNameToSdk(block.name, customToolNameToSdk);
					blocks.push({
						type: "tool_use",
						id: sanitizeToolId(block.id),
						name: sdkName,
						input: block.arguments ?? {},
					});
				}
			}
			if (blocks.length) anthropicMessages.push({ role: "assistant", content: blocks });
		} else if (msg.role === "toolResult") {
			const text = typeof msg.content === "string"
				? msg.content
				: messageContentToText(msg.content);
			anthropicMessages.push({
				role: "user",
				content: [{
					type: "tool_result",
					tool_use_id: sanitizeToolId(msg.toolCallId),
					content: text || "",
					is_error: msg.isError,
				}],
			});
		}
	}

	debug(
		`convertAndImportMessages: ${messages.length} pi msgs → ${anthropicMessages.length} anthropic msgs`,
	);
	if (anthropicMessages.length) session.importMessages(anthropicMessages as any);
}

/** pi tool name → SDK MCP tool name 변환 */
function mapPiToolNameToSdk(name: string | undefined, customToolNameToSdk?: ToolNameMap): string {
	if (!name) return "";
	if (customToolNameToSdk) {
		const mapped = customToolNameToSdk.get(name) ?? customToolNameToSdk.get(name.toLowerCase());
		if (mapped) return mapped;
	}
	// MCP prefix 추가 — 모든 tool이 MCP로 등록되므로
	return `${MCP_TOOL_PREFIX}${name}`;
}

/** 텍스트 전용 content 추출 — 이미지 블록은 무시 */
function messageContentToText(
	content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block.type === "text" && block.text) parts.push(block.text);
	}
	return parts.join("\n");
}

/**
 * 공유 세션 동기화.
 *
 * 마지막 user 메시지 이전까지의 히스토리를 cc-session-io 세션으로 변환.
 * Case 1: clean start (이전 메시지 없음) → null
 * Case 2: 첫 턴 + 이전 메시지 있음 → 새 세션 생성
 * Case 3: 이미 동기화됨 → 기존 sessionId 반환
 * Case 4: 누락 메시지 있음 → 전체 재생성
 */
function syncSharedSession(
	state: FleetCcState,
	messages: Context["messages"],
	cwd: string,
	customToolNameToSdk?: ToolNameMap,
	modelId?: string,
): { sessionId: string | null } {
	const priorMessages = messages.slice(0, -1);

	if (!state.sharedSession) {
		if (priorMessages.length === 0) {
			debug("syncSharedSession: Case 1 — clean start");
			return { sessionId: null };
		}
		const session = createSession({ projectPath: cwd, ...(modelId ? { model: modelId } : {}) });
		convertAndImportMessages(session, priorMessages, customToolNameToSdk);
		session.save();
		state.sharedSession = {
			sessionId: session.sessionId,
			cursor: priorMessages.length,
			cwd,
		};
		debug(`syncSharedSession: Case 2 — 새 세션 ${session.sessionId.slice(0, 8)}`);
		return { sessionId: session.sessionId };
	}

	const missed = priorMessages.slice(state.sharedSession.cursor);
	if (missed.length === 0) {
		debug(`syncSharedSession: Case 3 — 동기화됨, cursor=${state.sharedSession.cursor}`);
		return { sessionId: state.sharedSession.sessionId };
	}

	// Case 4: 전체 재생성 (기존 세션에 주입하면 분기가 생겨 resume 시 문제)
	const session = createSession({
		projectPath: state.sharedSession.cwd,
		...(modelId ? { model: modelId } : {}),
	});
	convertAndImportMessages(session, priorMessages, customToolNameToSdk);
	session.save();
	const oldId = state.sharedSession.sessionId;
	state.sharedSession = {
		sessionId: session.sessionId,
		cursor: priorMessages.length,
		cwd: state.sharedSession.cwd,
	};
	debug(
		`syncSharedSession: Case 4 — ${missed.length} missed,`,
		`새 세션 ${session.sessionId.slice(0, 8)} (이전: ${oldId.slice(0, 8)})`,
	);
	return { sessionId: session.sessionId };
}

// ═══════════════════════════════════════════════════════════════════════════
// streamClaudeAgentSdk — provider 진입점
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Provider 진입점 — pi의 streamSimple 계약 구현.
 *
 * 두 가지 경우:
 * 1. tool result delivery — activeQuery가 있고, pendingToolCalls/pendingResults 매칭
 * 2. fresh query — SDK query() 호출, consumeQuery()로 백그라운드 소비
 *
 * @param model - 사용할 모델
 * @param context - pi context (messages, tools, systemPrompt)
 * @param options - signal, reasoning, cwd 등
 */
export function streamClaudeAgentSdk(
	model: Model<any>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const state = getOrInitState();

	const lastMsgRole = context.messages[context.messages.length - 1]?.role;
	debug(
		`streamClaudeAgentSdk: activeQuery=${!!state.activeQuery},`,
		`lastMsgRole=${lastMsgRole}, stack=${state.queryStateStack.length}`,
	);

	// ─── systemPrompt drift 감지 ───
	// systemPrompt가 변경되면 기존 sharedSession을 폐기하여 새 세션으로 시작
	if (state.sharedSession) {
		const currentHash = hashSystemPrompt(context.systemPrompt);
		if (state.sharedSession.lastSystemPromptHash &&
			state.sharedSession.lastSystemPromptHash !== currentHash) {
			debug("systemPrompt drift 감지 — sharedSession 폐기");
			state.sharedSession = null;
		}
	}

	// ─── Case 1: tool result delivery ───
	if (state.activeQuery) {
		state.currentPiStream = stream;
		resetTurnState(model);
		const allResults = extractAllToolResults(context);
		debug(
			`tool results: ${allResults.length} results,`,
			`${state.pendingToolCalls.length} waiting handlers`,
		);
		for (const result of allResults) {
			if (state.pendingToolCalls.length > 0) {
				const pending = state.pendingToolCalls.shift()!;
				debug(`resolving ${pending.toolName}${result.isError ? " (error)" : ""}`);
				pending.resolve(result);
			} else {
				state.pendingResults.push(result);
				debug(`queued result (${state.pendingResults.length} pending)`);
			}
		}
		if (state.sharedSession) state.sharedSession.cursor = context.messages.length;
		return stream;
	}

	// ─── Case 2: orphaned tool result ───
	const lastMsg = context.messages[context.messages.length - 1];
	if (lastMsg?.role === "toolResult") {
		debug("orphaned tool result — 안전 종료");
		if (state.sharedSession) state.sharedSession.cursor = context.messages.length;
		queueMicrotask(() => {
			const turnOutput = resetTurnState(model);
			stream.push({ type: "done", reason: "stop", message: turnOutput });
			stream.end();
		});
		return stream;
	}

	// ─── Case 3: fresh query ───

	// reentrant query — 부모 상태 저장
	const isReentrant = state.activeQuery !== null;
	if (isReentrant) {
		state.queryStateStack.push({
			activeQuery: state.activeQuery,
			currentPiStream: state.currentPiStream,
			pendingToolCalls: [...state.pendingToolCalls],
			pendingResults: [...state.pendingResults],
		});
		debug(`reentrant: 부모 상태 저장 (stack depth ${state.queryStateStack.length})`);
	}

	state.currentPiStream = stream;
	state.pendingToolCalls.length = 0;
	state.pendingResults.length = 0;
	const turnOutput = resetTurnState(model);

	// tool 해석 및 MCP 서버 구성
	const { mcpTools, customToolNameToSdk, customToolNameToPi } = resolveMcpTools(context);
	const cwd = (options as { cwd?: string } | undefined)?.cwd ?? process.cwd();
	const { sessionId: resumeSessionId } = syncSharedSession(
		state, context.messages, cwd, customToolNameToSdk, model.id,
	);

	// 프롬프트 추출
	const promptBlocks = extractUserPromptBlocks(context.messages);
	let promptText = extractUserPrompt(context.messages) ?? "";

	if (!promptText && !promptBlocks) {
		debug("WARNING: empty prompt — fallback to [continue]");
		promptText = "[continue]";
	}

	const prompt: string | AsyncIterable<SDKUserMessage> = promptBlocks
		? wrapPromptStream(promptBlocks)
		: promptText;
	const mcpServers = buildMcpServers(mcpTools, state.pendingToolCalls, state.pendingResults);

	// effort level 매핑
	const effort = options?.reasoning ? REASONING_TO_EFFORT[options.reasoning] : undefined;

	// systemPrompt hash 저장 — drift 감지용
	const systemPromptHash = hashSystemPrompt(context.systemPrompt);

	const queryOptions: NonNullable<Parameters<typeof query>[0]["options"]> = {
		cwd,
		tools: [],                              // 내장 tool 전체 비활성화
		allowedTools: [`${MCP_TOOL_PREFIX}*`],  // MCP tool만 허용
		permissionMode: "bypassPermissions",
		includePartialMessages: true,
		systemPrompt: context.systemPrompt,     // 문자열 직접 전달
		extraArgs: { model: model.id },
		...(effort ? { effort } : {}),
		...(mcpServers ? { mcpServers } : {}),
		...(resumeSessionId ? { resume: resumeSessionId } : {}),
	};

	debug(
		`fresh query: model=${model.id} tools=${mcpTools.length}`,
		`resume=${resumeSessionId?.slice(0, 8) ?? "none"} effort=${effort ?? "default"}`,
		`prompt=${promptText.slice(0, 60)}${promptBlocks ? " [+images]" : ""}`,
	);

	// abort 핸들링
	let wasAborted = false;
	const sdkQuery = query({ prompt, options: queryOptions });
	state.activeQuery = sdkQuery;

	const requestAbort = () => {
		void sdkQuery.interrupt().catch(() => {});
		try { sdkQuery.close(); } catch { /* noop */ }
	};
	const onAbort = () => {
		wasAborted = true;
		for (const pending of state.pendingToolCalls) {
			pending.resolve({ content: [{ type: "text", text: "Operation aborted" }] });
		}
		state.pendingToolCalls.length = 0;
		state.pendingResults.length = 0;
		requestAbort();
	};
	if (options?.signal) {
		if (options.signal.aborted) onAbort();
		else options.signal.addEventListener("abort", onAbort, { once: true });
	}

	// 백그라운드 소비 — consumeQuery가 SDK generator를 순회하며 이벤트 변환
	consumeQuery(sdkQuery, customToolNameToPi, model, () => wasAborted)
		.then(({ capturedSessionId }) => {
			debug(
				`consumeQuery 완료: stopReason=${turnOutput?.stopReason},`,
				`aborted=${wasAborted}`,
			);

			// abort 시 sharedSession 폐기 — 강제 종료된 세션은 resume 불가
			if (wasAborted || options?.signal?.aborted) {
				state.sharedSession = null;
				debug("abort 감지 — sharedSession 폐기");
				if (turnOutput) {
					turnOutput.stopReason = "aborted";
					turnOutput.errorMessage = "Operation aborted";
				}
				state.currentPiStream?.push({
					type: "error",
					reason: "aborted",
					error: turnOutput!,
				});
				state.currentPiStream?.end();
				state.currentPiStream = null;
				return;
			}

			// 세션 ID 갱신 — resume용
			const sessionId = capturedSessionId ?? state.sharedSession?.sessionId;
			if (sessionId) {
				const cursor = Math.max(
					context.messages.length,
					state.sharedSession?.cursor ?? 0,
				);
				state.sharedSession = {
					sessionId,
					cursor,
					cwd,
					lastSystemPromptHash: systemPromptHash,
				};
				debug(`세션 갱신: ${sessionId.slice(0, 8)}, cursor=${cursor}`);
			}
			finalizeCurrentStream(state.turnOutput?.stopReason);
		})
		.catch((error) => {
			debug(`query 에러: ${errorMessage(error)}, aborted=${wasAborted}`);
			if (wasAborted || options?.signal?.aborted) state.sharedSession = null;
			if (turnOutput) {
				turnOutput.stopReason = options?.signal?.aborted ? "aborted" : "error";
				turnOutput.errorMessage = errorMessage(error);
			}
			state.currentPiStream?.push({
				type: "error",
				reason: (turnOutput?.stopReason ?? "error") as "aborted" | "error",
				error: turnOutput!,
			});
			state.currentPiStream?.end();
			state.currentPiStream = null;
		})
		.finally(() => {
			if (options?.signal) options.signal.removeEventListener("abort", onAbort);
			if (state.activeQuery === sdkQuery) {
				// 남은 pending 정리
				for (const pending of state.pendingToolCalls) {
					pending.resolve({ content: [{ type: "text", text: "Query ended" }] });
				}
				state.pendingToolCalls.length = 0;
				state.pendingResults.length = 0;

				// reentrant → 부모 상태 복원
				if (isReentrant && state.queryStateStack.length > 0) {
					const saved = state.queryStateStack.pop()!;
					state.activeQuery = saved.activeQuery;
					state.currentPiStream = saved.currentPiStream;
					state.pendingToolCalls.length = 0;
					state.pendingToolCalls.push(...saved.pendingToolCalls);
					state.pendingResults.length = 0;
					state.pendingResults.push(...saved.pendingResults);
					debug(`부모 상태 복원 (stack depth ${state.queryStateStack.length})`);
				} else {
					state.activeQuery = null;
					debug("activeQuery 해제 (non-reentrant)");
				}
			}
			sdkQuery.close();
		});

	return stream;
}
