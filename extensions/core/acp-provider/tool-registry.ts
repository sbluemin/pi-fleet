/**
 * core/acp-provider/tool-registry — 세션별 tool snapshot 관리
 *
 * MCP Bearer 토큰 기반으로 세션별 tool 목록을 관리.
 * tool hash 계산으로 변경 감지를 지원.
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type { Tool } from "@mariozechner/pi-ai";

import { getLogAPI } from "../log/bridge.js";
import { convertToolSchema } from "./schema-adapter.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/** tool snapshot에 저장되는 tool 정보 */
export interface RegisteredTool {
  /** tool 이름 */
  name: string;
  /** tool 설명 */
  description: string;
  /** MCP 호환 JSON Schema (TypeBox에서 변환됨) */
  inputSchema: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** pi 기본 도구 — CLI가 자체 도구로 대체하므로 MCP 등록에서 제외 */
const PI_BUILTIN_TOOLS = new Set([
  "read", "bash", "edit", "write", "grep", "find", "ls",
]);

// ═══════════════════════════════════════════════════════════════════════════
// Module state — 세션별 tool snapshot 저장소
// ═══════════════════════════════════════════════════════════════════════════

/** Bearer 토큰 → 등록된 tool 목록 맵 */
const sessionTools = new Map<string, RegisteredTool[]>();

/** Bearer 토큰 → pi tool 이름 Set (빠른 조회용) */
const sessionToolNames = new Map<string, Set<string>>();

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세션의 tool snapshot을 등록.
 * 기존 등록이 있으면 덮어씀.
 *
 * @param sessionToken - MCP Bearer 토큰
 * @param tools - pi의 context.tools 배열
 */
export function registerToolsForSession(
  sessionToken: string,
  tools: Tool[],
): void {
  const log = getLogAPI();

  // pi 기본 도구 필터링 — CLI가 자체 도구로 대체하므로 MCP 등록 제외
  const filtered = tools.filter((t) => !PI_BUILTIN_TOOLS.has(t.name));
  const skipped = tools.length - filtered.length;

  const registered: RegisteredTool[] = filtered.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: convertToolSchema(tool.parameters),
  }));

  sessionTools.set(sessionToken, registered);
  sessionToolNames.set(sessionToken, new Set(filtered.map((t) => t.name)));

  log.debug(
    "acp-provider",
    `tool registry: ${registered.length}개 등록, ${skipped}개 기본도구 제외 (token=${sessionToken.slice(0, 8)})`,
  );
}

/**
 * 세션에 등록된 tool 목록 조회.
 *
 * @param sessionToken - MCP Bearer 토큰
 * @returns 등록된 tool 목록, 없으면 빈 배열
 */
export function getToolsForSession(sessionToken: string): RegisteredTool[] {
  return sessionTools.get(sessionToken) ?? [];
}

/**
 * 세션에 등록된 pi tool 이름 Set 조회 (빠른 조회용).
 *
 * @param sessionToken - MCP Bearer 토큰
 */
export function getToolNamesForSession(sessionToken: string): Set<string> {
  return sessionToolNames.get(sessionToken) ?? new Set();
}

/**
 * 세션의 tool snapshot 제거.
 *
 * @param sessionToken - MCP Bearer 토큰
 */
export function removeToolsForSession(sessionToken: string): void {
  sessionTools.delete(sessionToken);
  sessionToolNames.delete(sessionToken);
}

/** 모든 세션의 tool snapshot 제거 */
export function clearAllTools(): void {
  sessionTools.clear();
  sessionToolNames.clear();
}

/**
 * tool 목록의 해시 계산 — 변경 감지용.
 * tool 이름 + 설명 + parameters 구조로 해시 생성.
 */
export function computeToolHash(tools: Tool[]): string {
  let hash = 5381;
  for (const tool of tools) {
    const key = `${tool.name}:${tool.description ?? ""}:${JSON.stringify(tool.parameters ?? {})}`;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
    }
  }
  return hash.toString(36);
}
