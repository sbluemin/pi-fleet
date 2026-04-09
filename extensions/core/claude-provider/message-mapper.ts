/**
 * core/claude-provider/message-mapper — SDK stream event → pi event 변환
 *
 * pi-claude-bridge의 이벤트 변환 로직을 fleet-cc native provider용으로 포팅.
 * 변경사항: allowSkillAliasRewrite 제거, skills 경로 rewrite 제거,
 * SDK 내장 tool 필터링 제거 (내장 tool이 비활성화됨).
 *
 * imports → types → constants → functions 순서 준수.
 */

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@mariozechner/pi-ai";
import { calculateCost } from "@mariozechner/pi-ai";
import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { type ToolNameMap, MCP_SERVER_NAME, getOrInitState } from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** MCP tool 이름 prefix — SDK가 MCP tool에 붙이는 접두사 */
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// ═══════════════════════════════════════════════════════════════════════════
// Module-level turn state — 턴마다 resetTurnState()에서 초기화
// ═══════════════════════════════════════════════════════════════════════════

let turnBlocks: Array<any> = [];
let turnStarted = false;
let turnSawStreamEvent = false;
let turnSawToolCall = false;

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════

/** 조건부 디버그 로깅 — FLEET_CC_DEBUG=1 으로 활성화 */
function debug(...args: unknown[]): void {
  if (process.env.FLEET_CC_DEBUG !== "1") return;
  console.debug("[fleet-cc:mapper]", ...args);
}

/** SDK tool name → pi tool name 매핑 (MCP prefix 제거 + customToolNameToPi 적용) */
function mapToolName(name: string, customToolNameToPi?: ToolNameMap): string {
  if (customToolNameToPi) {
    const mapped = customToolNameToPi.get(name) ?? customToolNameToPi.get(name.toLowerCase());
    if (mapped) return mapped;
  }
  // MCP prefix 제거 — "mcp__pi-tools__myTool" → "myTool"
  if (name.toLowerCase().startsWith(MCP_TOOL_PREFIX.toLowerCase())) {
    return name.slice(MCP_TOOL_PREFIX.length);
  }
  return name;
}

/** SDK stop_reason → pi stopReason 변환 */
function mapStopReason(reason: string | undefined): "stop" | "length" | "toolUse" {
  switch (reason) {
    case "tool_use": return "toolUse";
    case "max_tokens": return "length";
    case "end_turn": default: return "stop";
  }
}

/** 불완전한 JSON 파싱 시도 — 실패 시 fallback 반환 */
function parsePartialJson(
  input: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  if (!input) return fallback;
  try { return JSON.parse(input); } catch { return fallback; }
}

/** 텍스트 전용 content 추출 — 이미지 블록은 무시 */
function messageContentToText(
  content: string | Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  let hasText = false;
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
      hasText = true;
    } else if (block.type === "image") {
      debug("messageContentToText: 이미지 블록 무시 (텍스트 전용 경로)");
    } else {
      debug("messageContentToText: 미처리 블록 타입", block.type);
      parts.push(`[${block.type}]`);
    }
  }
  return hasText ? parts.join("\n") : "";
}

/** 현재 턴 스트림에 start 이벤트 발행 (중복 호출 안전) */
function ensureTurnStarted(): void {
  const state = getOrInitState();
  if (!turnStarted && state.currentPiStream && state.turnOutput) {
    state.currentPiStream.push({ type: "start", partial: state.turnOutput });
    turnStarted = true;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// processStreamEvent — SDK stream_event → pi 이벤트 변환
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SDK stream_event를 pi AssistantMessageEventStream 이벤트로 변환.
 * message_stop + tool_use 시 currentPiStream을 종료하여 pi가 tool을 실행할 수 있게 함.
 */
function processStreamEvent(
  message: SDKMessage,
  customToolNameToPi: ToolNameMap,
  model: Model<any>,
): void {
  const state = getOrInitState();
  if (!state.currentPiStream || !state.turnOutput) return;
  turnSawStreamEvent = true;
  const event = (message as SDKMessage & { event: any }).event;

  // --- message_start: usage 초기화 ---
  if (event?.type === "message_start") {
    if (event.message?.usage) updateUsage(state.turnOutput, event.message.usage, model);
    return;
  }

  // --- content_block_start: 새 블록 시작 ---
  if (event?.type === "content_block_start") {
    ensureTurnStarted();
    if (event.content_block?.type === "text") {
      turnBlocks.push({ type: "text", text: "", index: event.index });
      state.currentPiStream.push({
        type: "text_start",
        contentIndex: turnBlocks.length - 1,
        partial: state.turnOutput,
      });
    } else if (event.content_block?.type === "thinking") {
      turnBlocks.push({
        type: "thinking", thinking: "", thinkingSignature: "",
        index: event.index,
      });
      state.currentPiStream.push({
        type: "thinking_start",
        contentIndex: turnBlocks.length - 1,
        partial: state.turnOutput,
      });
    } else if (event.content_block?.type === "tool_use") {
      turnSawToolCall = true;
      turnBlocks.push({
        type: "toolCall",
        id: event.content_block.id,
        name: mapToolName(event.content_block.name, customToolNameToPi),
        arguments: (event.content_block.input as Record<string, unknown>) ?? {},
        partialJson: "",
        index: event.index,
      });
      state.currentPiStream.push({
        type: "toolcall_start",
        contentIndex: turnBlocks.length - 1,
        partial: state.turnOutput,
      });
    } else {
      debug("processStreamEvent: 미처리 content_block_start 타입", event.content_block?.type);
    }
    return;
  }

  // --- content_block_delta: 블록 내용 증분 ---
  if (event?.type === "content_block_delta") {
    const index = turnBlocks.findIndex((b: any) => b.index === event.index);
    const block = turnBlocks[index];
    if (!block) return;

    if (event.delta?.type === "text_delta" && block.type === "text") {
      block.text += event.delta.text;
      state.currentPiStream.push({
        type: "text_delta", contentIndex: index,
        delta: event.delta.text, partial: state.turnOutput,
      });
    } else if (event.delta?.type === "thinking_delta" && block.type === "thinking") {
      block.thinking += event.delta.thinking;
      state.currentPiStream.push({
        type: "thinking_delta", contentIndex: index,
        delta: event.delta.thinking, partial: state.turnOutput,
      });
    } else if (event.delta?.type === "input_json_delta" && block.type === "toolCall") {
      block.partialJson += event.delta.partial_json;
      block.arguments = parsePartialJson(block.partialJson, block.arguments);
      state.currentPiStream.push({
        type: "toolcall_delta", contentIndex: index,
        delta: event.delta.partial_json, partial: state.turnOutput,
      });
    } else if (event.delta?.type === "signature_delta" && block.type === "thinking") {
      block.thinkingSignature = (block.thinkingSignature ?? "") + event.delta.signature;
    } else {
      debug("processStreamEvent: 미처리 content_block_delta 타입", event.delta?.type);
    }
    return;
  }

  // --- content_block_stop: 블록 완료 ---
  if (event?.type === "content_block_stop") {
    const index = turnBlocks.findIndex((b: any) => b.index === event.index);
    const block = turnBlocks[index];
    if (!block) return;
    delete block.index;

    if (block.type === "text") {
      state.currentPiStream.push({
        type: "text_end", contentIndex: index,
        content: block.text, partial: state.turnOutput,
      });
    } else if (block.type === "thinking") {
      state.currentPiStream.push({
        type: "thinking_end", contentIndex: index,
        content: block.thinking, partial: state.turnOutput,
      });
    } else if (block.type === "toolCall") {
      turnSawToolCall = true;
      // partialJson → 최종 arguments 파싱 (skill alias rewrite 제거됨)
      block.arguments = parsePartialJson(block.partialJson, block.arguments);
      delete block.partialJson;
      state.currentPiStream.push({
        type: "toolcall_end", contentIndex: index,
        toolCall: block, partial: state.turnOutput,
      });
    }
    return;
  }

  // --- message_delta: stop_reason + usage 업데이트 ---
  if (event?.type === "message_delta") {
    state.turnOutput.stopReason = mapStopReason(event.delta?.stop_reason);
    if (event.usage) updateUsage(state.turnOutput, event.usage, model);
    return;
  }

  // --- message_stop + tool_use: 스트림 종료하여 pi에 tool 실행 양보 ---
  if (event?.type === "message_stop" && turnSawToolCall) {
    state.turnOutput.stopReason = "toolUse";
    state.currentPiStream.push({ type: "done", reason: "toolUse", message: state.turnOutput });
    state.currentPiStream.end();
    state.currentPiStream = null;
    return;
  }

  if (event?.type !== "message_stop" && event?.type !== "ping") {
    debug("processStreamEvent: 미처리 이벤트 타입", event?.type);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// processAssistantMessage — stream_event 미수신 시 fallback 경로
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SDK assistant 메시지를 pi content blocks로 변환.
 * resetTurnState 후 stream_event 없이 assistant 메시지가 먼저 도착하는 경우 사용.
 * processStreamEvent와 동일한 스트림 생명주기 유지 — tool_use 시 스트림 종료.
 */
function processAssistantMessage(
  message: SDKMessage,
  model: Model<any>,
  customToolNameToPi: ToolNameMap,
): void {
  if (turnSawStreamEvent) return;
  const state = getOrInitState();
  const assistantMsg = (message as any).message;
  if (!assistantMsg?.content) return;

  debug(
    `processAssistantMessage fallback: ${assistantMsg.content.length} 블록,`,
    `types=${assistantMsg.content.map((b: any) => b.type).join(",")}`,
  );

  for (const block of assistantMsg.content) {
    if (block.type === "text" && block.text) {
      ensureTurnStarted();
      turnBlocks.push({ type: "text", text: block.text });
      const idx = turnBlocks.length - 1;
      state.currentPiStream?.push({ type: "text_start", contentIndex: idx, partial: state.turnOutput });
      state.currentPiStream?.push({ type: "text_delta", contentIndex: idx, delta: block.text, partial: state.turnOutput });
      state.currentPiStream?.push({ type: "text_end", contentIndex: idx, content: block.text, partial: state.turnOutput });
    } else if (block.type === "thinking") {
      ensureTurnStarted();
      turnBlocks.push({
        type: "thinking",
        thinking: block.thinking ?? "",
        thinkingSignature: block.signature ?? "",
      });
      const idx = turnBlocks.length - 1;
      state.currentPiStream?.push({ type: "thinking_start", contentIndex: idx, partial: state.turnOutput });
      if (block.thinking) {
        state.currentPiStream?.push({ type: "thinking_delta", contentIndex: idx, delta: block.thinking, partial: state.turnOutput });
      }
      state.currentPiStream?.push({ type: "thinking_end", contentIndex: idx, content: block.thinking ?? "", partial: state.turnOutput });
    } else if (block.type === "tool_use") {
      ensureTurnStarted();
      turnSawToolCall = true;
      const piName = mapToolName(block.name, customToolNameToPi);
      turnBlocks.push({
        type: "toolCall", id: block.id,
        name: piName,
        arguments: block.input ?? {},
      });
      const idx = turnBlocks.length - 1;
      state.currentPiStream?.push({ type: "toolcall_start", contentIndex: idx, partial: state.turnOutput });
      state.currentPiStream?.push({ type: "toolcall_end", contentIndex: idx, toolCall: turnBlocks[idx], partial: state.turnOutput });
    } else {
      debug("processAssistantMessage: 미처리 블록 타입", block.type);
    }
  }

  if (assistantMsg.usage && state.turnOutput) {
    updateUsage(state.turnOutput, assistantMsg.usage, model);
  }

  // tool_use 시 스트림 종료 — processStreamEvent의 message_stop 핸들러와 동일 패턴
  if (turnSawToolCall && state.currentPiStream && state.turnOutput) {
    state.turnOutput.stopReason = "toolUse";
    state.currentPiStream.push({ type: "done", reason: "toolUse", message: state.turnOutput });
    state.currentPiStream.end();
    state.currentPiStream = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported functions
// ═══════════════════════════════════════════════════════════════════════════

/** usage/cost 추적 — SDK usage → pi AssistantMessage.usage 업데이트 */
export function updateUsage(
  output: AssistantMessage,
  usage: Record<string, number | undefined>,
  model: Model<any>,
): void {
  if (usage.input_tokens != null) output.usage.input = usage.input_tokens;
  if (usage.output_tokens != null) output.usage.output = usage.output_tokens;
  if (usage.cache_read_input_tokens != null) output.usage.cacheRead = usage.cache_read_input_tokens;
  if (usage.cache_creation_input_tokens != null) output.usage.cacheWrite = usage.cache_creation_input_tokens;
  output.usage.totalTokens =
    output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model, output.usage);
  debug(
    `usage: in=${output.usage.input} out=${output.usage.output}`,
    `cacheR=${output.usage.cacheRead} cacheW=${output.usage.cacheWrite}`,
  );
}

/**
 * 턴 시작 시 출력 메시지 초기화.
 * 새 AssistantMessage를 생성하고 state.turnOutput에 설정한 뒤 반환.
 */
export function resetTurnState(model: Model<any>): AssistantMessage {
  const state = getOrInitState();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  state.turnOutput = output;
  turnBlocks = output.content as Array<any>;
  turnStarted = false;
  turnSawStreamEvent = false;
  turnSawToolCall = false;
  return output;
}

/**
 * 스트림 완료 처리.
 * start 이벤트가 미발행이면 먼저 발행하고, done 이벤트로 스트림 종료.
 */
export function finalizeCurrentStream(
  stopReason?: string,
): void {
  const state = getOrInitState();
  const stream = state.currentPiStream;
  const output = state.turnOutput;
  if (!stream || !output) return;

  if (!turnStarted) {
    stream.push({ type: "start", partial: output });
  }
  const reason = stopReason === "length" ? "length" : "stop";
  stream.push({ type: "done", reason, message: output });
  stream.end();
  state.currentPiStream = null;
}

/** context에서 마지막 user 메시지의 텍스트 프롬프트 추출 */
export function extractUserPrompt(messages: Context["messages"]): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  if (typeof last.content === "string") return last.content;
  return messageContentToText(last.content) || "";
}

/**
 * context에서 마지막 user 메시지를 ContentBlockParam[]으로 추출 (이미지 보존).
 * 이미지가 없으면 null 반환 — 호출자가 string prompt로 fallback 해야 함.
 */
export function extractUserPromptBlocks(
  messages: Context["messages"],
): ContentBlockParam[] | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  if (typeof last.content === "string") return null;
  if (!Array.isArray(last.content)) return null;

  let hasImage = false;
  const blocks: ContentBlockParam[] = [];
  for (const block of last.content) {
    if (block.type === "text" && block.text) {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      const imgBlock = block as { type: "image"; data?: string; mimeType?: string };
      if (!imgBlock.data || !imgBlock.mimeType) {
        debug("extractUserPromptBlocks: 이미지 블록에 data/mimeType 누락, 건너뜀");
        continue;
      }
      hasImage = true;
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: imgBlock.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: imgBlock.data,
        },
      });
    }
  }
  return hasImage ? blocks : null;
}

/** 이미지 포함 프롬프트를 SDK user message 스트림으로 래핑 */
export async function* wrapPromptStream(
  blocks: ContentBlockParam[],
): AsyncIterable<SDKUserMessage> {
  yield {
    type: "user",
    message: { role: "user", content: blocks } as MessageParam,
    parent_tool_use_id: null,
  };
}

/**
 * SDK query의 async generator를 소비하며 이벤트 변환.
 * 각 턴마다 SDK가 stream_event → assistant → result 순으로 메시지를 전달.
 * tool_use 시 processStreamEvent/processAssistantMessage가 currentPiStream을 종료하고,
 * MCP 핸들러가 generator를 자연스럽게 블로킹하여 pi의 tool 결과를 기다림.
 */
export async function consumeQuery(
  sdkQuery: AsyncIterable<SDKMessage>,
  customToolNameToPi: ToolNameMap,
  model: Model<any>,
  wasAbortedFn: () => boolean,
): Promise<{ capturedSessionId?: string }> {
  const state = getOrInitState();
  let capturedSessionId: string | undefined;

  for await (const message of sdkQuery) {
    if (wasAbortedFn()) break;
    if (!state.currentPiStream || !state.turnOutput) continue;

    switch (message.type) {
      case "stream_event":
        processStreamEvent(message, customToolNameToPi, model);
        break;

      case "assistant":
        processAssistantMessage(message, model, customToolNameToPi);
        break;

      case "result":
        // stream_event 미수신 시 result에서 직접 텍스트 블록 생성
        if (!turnSawStreamEvent && (message as any).subtype === "success") {
          ensureTurnStarted();
          const text = (message as any).result || "";
          turnBlocks.push({ type: "text", text });
          const idx = turnBlocks.length - 1;
          state.currentPiStream?.push({ type: "text_start", contentIndex: idx, partial: state.turnOutput });
          state.currentPiStream?.push({ type: "text_delta", contentIndex: idx, delta: text, partial: state.turnOutput });
          state.currentPiStream?.push({ type: "text_end", contentIndex: idx, content: text, partial: state.turnOutput });
        }
        break;

      case "system":
        // SDK 초기화 시 session_id 캡처 — resume에 사용
        if ((message as any).subtype === "init" && (message as any).session_id) {
          capturedSessionId = (message as any).session_id;
        }
        break;

      default:
        debug("consumeQuery: 미처리 SDK 메시지 타입", message.type);
        break;
    }
  }

  debug(
    `consumeQuery: 루프 종료,`,
    `wasAborted=${wasAbortedFn()},`,
    `sessionId=${capturedSessionId?.slice(0, 8) ?? "none"}`,
  );
  return { capturedSessionId };
}
