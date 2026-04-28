/**
 * core/acp-provider/event-mapper — ACP 이벤트 → pi AssistantMessageEventStream 변환
 *
 * AcpConnection의 이벤트(messageChunk, thoughtChunk, toolCall, toolCallUpdate, promptComplete)를
 * pi의 AssistantMessageEventStream 이벤트(text_*, thinking_*, done)로 매핑.
 *
 * MCP tool(pi native tool): MCP HTTP 콜백으로 toolCall content 블록 + done="toolUse" 발행.
 *   pi agent-loop이 native tool을 실행하고 streamSimple 재호출.
 * CLI 내장 tool: 디버그 로깅만 수행 (렌더링 없음). done="stop".
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

import type { AssistantMessage } from "../../compat/pi-ai-bridge.js";
import { createAssistantMessageEventStream } from "../../compat/pi-ai-bridge.js";
import type { AcpToolCall, AcpToolCallUpdate } from "@sbluemin/unified-agent";

import { PROVIDER_ID } from "@sbluemin/fleet-core/agent/provider-types";
import { getLogAPI } from "../../config-bridge/log/bridge.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

/** 이벤트 매퍼가 반환하는 스트림과 리스너 묶음 */
export interface EventMapperHandle {
  /** pi에 전달할 AssistantMessageEventStream */
  stream: ReturnType<typeof createAssistantMessageEventStream>;
  /** 최종 AssistantMessage 참조 */
  output: AssistantMessage;
  /** AcpConnection에 등록할 리스너 — 해제 시 사용 */
  listeners: {
    onMessageChunk: (text: string, sessionId: string) => void;
    onThoughtChunk: (text: string, sessionId: string) => void;
    onToolCall: (title: string, status: string, sessionId: string, data?: AcpToolCall) => void;
    onToolCallUpdate: (title: string, status: string, sessionId: string, data?: AcpToolCallUpdate) => void;
    onPromptComplete: (sessionId: string) => void;
    onError: (error: Error) => void;
    onExit: (code: number | null, signal: string | null) => void;
  };
  /** 외부에서 에러로 스트림 종료 시 사용 */
  finishWithError: (reason: "aborted" | "error", message: string) => void;
  /** 정상 종료 (promptComplete 외부 호출용) */
  finishDone: () => void;
  /** targetSessionId를 나중에 바인딩 — 비동기 세션 확보 후 설정 */
  setTargetSessionId: (id: string) => void;
  /** pi tool 이름 Set 설정 — MCP tool(pi tool) vs CLI 내장 tool 구분용 */
  setPiToolNames: (names: Set<string>) => void;
  /** MCP HTTP 요청 도착 시 호출 — toolCall 블록 + done="toolUse" 발행 */
  emitMcpToolCall: (toolName: string, args: Record<string, unknown>, toolCallId: string) => boolean;
}

/** retry gate 상태 갱신용 callback 묶음 */
export interface EventMapperCallbacks {
  /** assistant output 시작 알림 */
  onAssistantOutputStarted?: () => void;
  /** CLI built-in tool 시작 알림 */
  onBuiltinToolStarted?: () => void;
  /** MCP toolUse 시작 알림 */
  onMcpToolUseStarted?: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

/** 디버그 로깅 — log 시스템 사용 */
function debug(...args: unknown[]): void {
  const log = getLogAPI();
  log.debug("acp-provider", args.map(String).join(" "), { category: "acp" });
}

// ═══════════════════════════════════════════════════════════════════════════
// createEventMapper — 팩토리 함수
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ACP 이벤트 리스너와 pi 스트림을 묶는 매퍼를 생성.
 *
 * 호출자(provider.ts)가 AcpConnection에 리스너를 등록/해제하는 책임을 가짐.
 * 매퍼는 block accumulator 상태를 관리하고 start → delta → end 순서를 보장.
 *
 * @param modelId - 사용 중인 모델 ID
 * @param targetSessionId - 매핑 대상 ACP 세션 ID (다른 세션 이벤트 무시)
 */
export function createEventMapper(
  modelId: string,
  initialTargetSessionId: string = "",
  callbacks?: EventMapperCallbacks,
): EventMapperHandle {
  const stream = createAssistantMessageEventStream();

  // mutable — 비동기 세션 확보 후 setTargetSessionId()로 바인딩
  let targetSessionId = initialTargetSessionId;

  // pi tool 이름 Set — MCP tool(pi tool) vs CLI 내장 tool 구분용
  let piToolNames: Set<string> = new Set();

  // ── 턴 출력 메시지 초기화 ──
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: PROVIDER_ID,
    provider: PROVIDER_ID,
    model: modelId,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  // ── block accumulator 상태 ──
  let started = false;
  let textBlockOpen = false;
  let thinkingBlockOpen = false;
  let finished = false;

  /** start 이벤트 발행 (중복 호출 안전) */
  const ensureStarted = (): void => {
    if (!started && !finished) {
      stream.push({ type: "start", partial: output });
      started = true;
    }
  };

  /** 열린 텍스트 블록 닫기 */
  const closeTextBlock = (): void => {
    if (!textBlockOpen) return;
    textBlockOpen = false;
    const idx = output.content.length - 1;
    const block = output.content[idx];
    if (block && block.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex: idx,
        content: block.text ?? "",
        partial: output,
      });
    }
  };

  /** 열린 thinking 블록 닫기 */
  const closeThinkingBlock = (): void => {
    if (!thinkingBlockOpen) return;
    thinkingBlockOpen = false;
    const idx = output.content.length - 1;
    const block = output.content[idx];
    if (block && block.type === "thinking") {
      stream.push({
        type: "thinking_end",
        contentIndex: idx,
        content: block.thinking ?? "",
        partial: output,
      });
    }
  };

  /** 모든 열린 블록 닫기 */
  const closeAllBlocks = (): void => {
    closeTextBlock();
    closeThinkingBlock();
  };

  /** CLI 내장 tool 추적 — call_id 기반 (title은 update 시 빈 문자열이므로 사용 불가) */
  const activeCliTools = new Map<string, { toolName: string; title: string }>();
  /** call_id가 없는 CLI (Claude) fallback — 가장 최근 start된 tool */
  let lastCliToolStart: { toolName: string; title: string } | null = null;

  /** CLI 내장 도구 실행을 한 줄 마크다운으로 stream에 push — 현재 text block에 delta로 추가 */
  const emitCliToolLine = (label: string, isError: boolean): void => {
    ensureStarted();
    // thinking 블록만 닫고, text 블록은 유지 (없으면 새로 열기)
    closeThinkingBlock();

    if (!textBlockOpen) {
      const block = { type: "text" as const, text: "" };
      output.content.push(block);
      const idx = output.content.length - 1;
      textBlockOpen = true;
      stream.push({ type: "text_start", contentIndex: idx, partial: output });
    }

    const tag = isError ? "**\u2718**" : "**\u2714**";
    const truncated = truncateMid(label, 80);
    const delta = `\n\n\`${truncated}\` ${tag}\n\n`;

    const idx = output.content.length - 1;
    const block = output.content[idx];
    if (block && block.type === "text") {
      block.text = (block.text ?? "") + delta;
    }
    stream.push({ type: "text_delta", contentIndex: idx, delta, partial: output });
  };

  // ── ACP 이벤트 리스너 ──

  const onMessageChunk = (text: string, sessionId: string): void => {
    if (sessionId !== targetSessionId || finished) return;
    callbacks?.onAssistantOutputStarted?.();
    ensureStarted();

    if (!textBlockOpen) {
      // thinking 블록이 열려 있으면 먼저 닫기
      closeThinkingBlock();

      // 새 텍스트 블록 시작
      const block = { type: "text" as const, text: "" };
      output.content.push(block);
      const idx = output.content.length - 1;
      textBlockOpen = true;
      stream.push({ type: "text_start", contentIndex: idx, partial: output });
    }

    // 텍스트 블록에 delta 추가
    const idx = output.content.length - 1;
    const block = output.content[idx];
    if (block && block.type === "text") {
      block.text = (block.text ?? "") + text;
    }
    stream.push({ type: "text_delta", contentIndex: idx, delta: text, partial: output });
  };

  const onThoughtChunk = (text: string, sessionId: string): void => {
    if (sessionId !== targetSessionId || finished) return;
    callbacks?.onAssistantOutputStarted?.();
    ensureStarted();

    if (!thinkingBlockOpen) {
      // 텍스트 블록이 열려 있으면 먼저 닫기
      closeTextBlock();

      // 새 thinking 블록 시작
      const block = { type: "thinking" as const, thinking: "" };
      output.content.push(block);
      const idx = output.content.length - 1;
      thinkingBlockOpen = true;
      stream.push({ type: "thinking_start", contentIndex: idx, partial: output });
    }

    // thinking 블록에 delta 추가
    const idx = output.content.length - 1;
    const block = output.content[idx];
    if (block && block.type === "thinking") {
      block.thinking = (block.thinking ?? "") + text;
    }
    stream.push({ type: "thinking_delta", contentIndex: idx, delta: text, partial: output });
  };

  const onToolCall = (
    title: string,
    status: string,
    sessionId: string,
    data?: AcpToolCall,
  ): void => {
    if (sessionId !== targetSessionId || finished) return;
    ensureStarted();

    debug(`toolcall raw: title=${JSON.stringify(title)} kind=${data?.kind} status=${status} rawInput=${JSON.stringify(data?.rawInput)?.slice(0, 200)}`);

    // MCP tool 판별 — title에서 tool 이름 추출
    const rawToolName = (data?.rawInput as Record<string, unknown> | undefined)?.tool;
    const actualToolName = typeof rawToolName === "string" ? rawToolName : null;
    const parsedTitle = extractMcpToolName(title);
    const toolName = actualToolName || parsedTitle || title || (data?.kind ?? "tool");
    const isMcpTool = piToolNames.has(toolName);

    if (isMcpTool) {
      // MCP tool → ACP 이벤트 무시. MCP HTTP 콜백(emitMcpToolCall)에서 처리.
      debug(`MCP tool ${toolName} — ACP 이벤트 무시 (MCP 콜백으로 처리)`);
      return;
    }

    // CLI 내장 tool → call_id 기반 추적 시작 (call_id 없으면 lastCliToolStart fallback)
    callbacks?.onBuiltinToolStarted?.();
    const callId = extractCallId(data?.rawInput);
    if (callId) {
      activeCliTools.set(callId, { toolName, title });
    }
    lastCliToolStart = { toolName, title };
    debug(`CLI tool start: ${toolName} [${status}]`);
  };

  const onToolCallUpdate = (
    title: string,
    status: string,
    sessionId: string,
    data?: AcpToolCallUpdate,
  ): void => {
    if (sessionId !== targetSessionId || finished) return;

    debug(`toolcall_update raw: title=${JSON.stringify(title)} status=${status} content=${JSON.stringify(data?.content)?.slice(0, 300)} rawOutput=${JSON.stringify(data?.rawOutput)?.slice(0, 300)}`);

    // MCP tool 판별
    const rawToolName = (data as Record<string, unknown> | undefined)?.tool;
    const actualToolName = typeof rawToolName === "string" ? rawToolName : null;
    const parsedTitle = extractMcpToolName(title);
    const toolName = actualToolName || parsedTitle || title || "";
    const isMcpTool = piToolNames.has(toolName);

    if (isMcpTool) {
      debug(`MCP tool ${toolName} — update 무시 [${status}]`);
      return;
    }

    // CLI 내장 tool — 중간 update에서 상세 title 갱신 (Claude: 완료 시 title이 빈 문자열)
    if (title && lastCliToolStart) {
      lastCliToolStart.title = title;
    }

    // 완료 시 한 줄 렌더링
    if (status === "completed" || status === "error" || status === "failed") {
      const callId = extractCallId(data?.rawOutput);
      const tracked = callId ? activeCliTools.get(callId) : null;
      // call_id가 없는 CLI (Claude) → lastCliToolStart fallback
      const fallback = tracked ?? lastCliToolStart;
      // Claude: update의 title이 start보다 상세 — 비어있지 않으면 우선 사용
      let resolvedTitle = title || fallback?.title || toolName;
      // generic title("Read File", "grep" 등)인 경우 rawOutput에서 힌트 추출 시도
      if (isGenericTitle(resolvedTitle) && data?.rawOutput) {
        const hint = extractHintFromRawOutput(data.rawOutput, resolvedTitle);
        if (hint) resolvedTitle = hint;
      }
      const isError = status === "error" || status === "failed";

      // 빈 label이면 렌더링 생략
      if (resolvedTitle) {
        emitCliToolLine(resolvedTitle, isError);
      }

      if (callId) activeCliTools.delete(callId);
      lastCliToolStart = null;
      debug(`CLI tool complete: ${resolvedTitle} [${status}]`);
    }
  };

  const onPromptComplete = (sessionId: string): void => {
    if (sessionId !== targetSessionId || finished) return;
    finishDone();
  };

  const onError = (error: Error): void => {
    if (finished) return;
    debug("connection error:", error.message);
    finishWithError("error", error.message);
  };

  const onExit = (code: number | null, signal: string | null): void => {
    if (finished) return;
    debug(`connection exit: code=${code} signal=${signal}`);
    finishWithError("error", `ACP 프로세스 종료 (code=${code}, signal=${signal})`);
  };

  // ── 종료 helpers ──

  /** 정상 종료 — promptComplete 시 done="stop" */
  const finishDone = (): void => {
    if (finished) return;
    finished = true;
    closeAllBlocks();
    ensureStarted();
    output.stopReason = "stop";
    stream.push({ type: "done", reason: "stop", message: output });
    stream.end();
  };

  /** 에러/abort 종료 */
  const finishWithError = (reason: "aborted" | "error", message: string): void => {
    if (finished) return;
    finished = true;
    closeAllBlocks();
    ensureStarted();
    output.stopReason = reason === "aborted" ? "aborted" : "error";
    output.errorMessage = message;
    stream.push({ type: "error", reason, error: output });
    stream.end();
  };

  return {
    stream,
    output,
    listeners: {
      onMessageChunk,
      onThoughtChunk,
      onToolCall,
      onToolCallUpdate,
      onPromptComplete,
      onError,
      onExit,
    },
    finishWithError,
    finishDone,
    setTargetSessionId: (id: string) => { targetSessionId = id; },
    setPiToolNames: (names: Set<string>) => { piToolNames = names; },

    emitMcpToolCall: (toolName: string, args: Record<string, unknown>, toolCallId: string): boolean => {
      if (finished) return false;
      callbacks?.onMcpToolUseStarted?.();
      ensureStarted();
      closeTextBlock();
      closeThinkingBlock();

      const block = {
        type: "toolCall" as const,
        id: toolCallId,
        name: toolName,
        arguments: args,
      };
      output.content.push(block);
      const idx = output.content.length - 1;

      // toolcall_start + toolcall_end 즉시 발행
      stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
      stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: block, partial: output });

      // done="toolUse" 발행 → pi agent-loop이 tool을 실행하고 streamSimple 재호출
      finished = true;
      output.stopReason = "toolUse";
      stream.push({ type: "done", reason: "toolUse", message: output });
      stream.end();

      debug(`MCP toolCall → done=toolUse: ${toolName} (id=${toolCallId})`);
      return true;
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ───────────────────────────────────────────────────────────────────────

/**
 * title에서 MCP tool 이름 추출.
 * - Codex: "Tool: pi-tools/bash" → "bash"
 * - Claude: "mcp__pi-tools__bash" → "bash"
 * - Gemini: "bash (pi-tools MCP Server)" → "bash"
 * - 해당하지 않으면 null 반환
 */
function extractMcpToolName(title: string): string | null {
  // Claude CLI: mcp__<server>__<tool>
  const mcpMatch = title.match(/^mcp__[^_]+__(.+)$/);
  if (mcpMatch) return mcpMatch[1];
  // Codex CLI: Tool: <server>/<tool>
  const toolMatch = title.match(/^Tool:\s*[^/]+\/(.+)$/);
  if (toolMatch) return toolMatch[1];
  // Gemini CLI: <tool> (<server> MCP Server)
  const geminiMatch = title.match(/^(.+?)\s+\([^)]+\s+MCP Server\)$/);
  if (geminiMatch) return geminiMatch[1];
  return null;
}

/** rawInput/rawOutput에서 call_id 추출 */
function extractCallId(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  return typeof obj.call_id === "string" ? obj.call_id : undefined;
}

/** 문자열 중간 생략 — maxLen 초과 시 앞뒤를 유지하고 중간을 …으로 대체 */
function truncateMid(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const half = Math.floor((maxLen - 1) / 2);
  return s.slice(0, half) + "\u2026" + s.slice(s.length - half);
}

/** generic title 판별 — Claude가 상세 정보 없이 보내는 title */
const GENERIC_TITLES = new Set(["Read File", "Write File", "Edit File", "grep", "find", "ls", "bash"]);
function isGenericTitle(title: string): boolean {
  return GENERIC_TITLES.has(title);
}

/** rawOutput에서 파일 경로 등 힌트 추출 (Claude Read File 등) */
function extractHintFromRawOutput(rawOutput: unknown, fallbackTitle: string): string | null {
  if (typeof rawOutput !== "string" || !rawOutput) return null;
  // rawOutput 첫 줄에서 파일 경로 추출 시도
  const firstLine = rawOutput.split("\n")[0]?.trim() ?? "";
  // 번호 + 탭으로 시작하면 파일 내용 ("1\t...") — 파일명 없음
  if (/^\d+\t/.test(firstLine)) return null;
  // 경로처럼 보이면 fallbackTitle + 경로 조합
  if (firstLine.startsWith("/")) {
    return `${fallbackTitle} ${firstLine.split("\n")[0].slice(0, 60)}`;
  }
  return null;
}
