/**
 * fleet — 스트림 스토어 (단일 진실 원천)
 *
 * 모든 스트리밍 데이터를 `blocks: ColBlock[]` 하나로 정규화합니다.
 * `text`, `thinking`, `toolCalls`는 blocks에서 파생되는 계산 속성입니다.
 *
 * 외부에서는 도메인 특화 메서드(`appendTextBlock`, `appendThoughtBlock`,
 * `upsertToolBlock`, `finalizeRun`)로만 데이터를 변경할 수 있습니다.
 *
 * 내부적으로 runId 기반 식별을 사용하며, 패널 레이아웃용으로
 * `visibleRunIdByCli` 매핑을 통해 CLI당 현재 표시할 run을 결정합니다.
 *
 * 기본 저장소는 globalThis 기반입니다. pi가 확장을 별도 번들로
 * 로드해도 compatibility key를 공유해야 하므로 키 이름은 안정적으로 유지합니다.
 */

import type { AgentStatus } from "../../agent/types.js";
import { readBridgeState, writeBridgeState } from "./state-store.js";
import type { ColBlock, ColStatus, CollectedStreamData } from "./types.js";

export type { ColStatus, CollectedStreamData } from "./types.js";

interface StreamStoreState {
  runs: Map<string, StreamRun>;
  visibleRunIdByCli: Map<string, string>;
  counter: number;
}

const STORE_KEY = "__pi_stream_store__";
const TOOL_LABEL_CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;
const TOOL_LABEL_ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
let registeredOrderProvider: (() => readonly string[]) | null = null;

export class StreamRun {
  readonly runId: string;
  readonly cli: string;
  blocks: ColBlock[] = [];
  status: ColStatus = "wait";
  sessionId?: string;
  error?: string;
  requestPreview?: string;

  private _textCache: string | null = null;
  private _thinkingCache: string | null = null;
  private _toolCallsCache: { title: string; status: string }[] | null = null;
  lastAgentStatus: AgentStatus = "connecting";

  constructor(runId: string, cli: string) {
    this.runId = runId;
    this.cli = cli;
  }

  get text(): string {
    if (this._textCache === null) {
      this._textCache = this.blocks
        .filter((b): b is Extract<ColBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
    return this._textCache;
  }

  get thinking(): string {
    if (this._thinkingCache === null) {
      this._thinkingCache = this.blocks
        .filter((b): b is Extract<ColBlock, { type: "thought" }> => b.type === "thought")
        .map((b) => b.text)
        .join("");
    }
    return this._thinkingCache;
  }

  get toolCalls(): { title: string; status: string }[] {
    if (this._toolCallsCache === null) {
      this._toolCallsCache = this.blocks
        .filter((b): b is Extract<ColBlock, { type: "tool" }> => b.type === "tool")
        .map((b) => ({ title: b.title, status: b.status }));
    }
    return this._toolCallsCache;
  }

  invalidateCache(): void {
    this._textCache = null;
    this._thinkingCache = null;
    this._toolCallsCache = null;
  }

  toCollectedData(): CollectedStreamData {
    return {
      text: this.text,
      thinking: this.thinking,
      toolCalls: this.toolCalls.map((tc) => ({ ...tc })),
      blocks: this.blocks.map((b) => ({ ...b })),
      lastStatus: this.lastAgentStatus,
    };
  }
}

export function createRun(cli: string, initialStatus: ColStatus = "conn", requestPreview?: string): string {
  const s = getStoreState();
  const runId = nextRunId(cli);
  const run = new StreamRun(runId, cli);
  run.status = initialStatus;
  run.requestPreview = requestPreview;
  s.runs.set(runId, run);
  s.visibleRunIdByCli.set(cli, runId);
  return runId;
}

export function appendTextBlock(cli: string, text: string): void {
  const run = resolveRun(cli);
  if (!run) return;

  const last = run.blocks[run.blocks.length - 1];
  if (last?.type === "text") {
    last.text += text;
  } else {
    run.blocks.push({ type: "text", text });
  }
  run.status = "stream";
  run.invalidateCache();
}

export function appendThoughtBlock(cli: string, text: string): void {
  const run = resolveRun(cli);
  if (!run) return;

  const last = run.blocks[run.blocks.length - 1];
  if (last?.type === "thought") {
    last.text += text;
  } else {
    run.blocks.push({ type: "thought", text });
  }
  run.status = "stream";
  run.invalidateCache();
}

export function upsertToolBlock(
  cli: string,
  title: string,
  status: string,
  toolCallId?: string,
): void {
  const run = resolveRun(cli);
  if (!run) return;
  const sanitizedTitle = sanitizeToolBlockLabel(title);
  const sanitizedStatus = sanitizeToolBlockLabel(status);

  const existing = run.blocks.find(
    (b): b is Extract<ColBlock, { type: "tool" }> =>
      b.type === "tool" &&
      (toolCallId
        ? b.toolCallId === toolCallId
        : b.title === sanitizedTitle || sanitizeToolBlockLabel(b.title) === sanitizedTitle),
  );

  if (existing) {
    existing.status = sanitizedStatus;
  } else {
    run.blocks.push({ type: "tool", title: sanitizedTitle, status: sanitizedStatus, toolCallId });
  }

  if (run.status === "conn" || run.status === "wait") {
    run.status = "stream";
  }
  run.invalidateCache();
}

export function updateRunStatus(cli: string, agentStatus: AgentStatus): void {
  const run = resolveRun(cli);
  if (!run) return;

  run.lastAgentStatus = agentStatus;

  if (agentStatus === "connecting") {
    run.status = "conn";
  } else if (agentStatus === "running") {
    run.status = "stream";
  }
}

export function finalizeRun(
  cli: string,
  finalStatus: "done" | "err",
  options?: {
    sessionId?: string;
    error?: string;
    fallbackText?: string;
    fallbackThinking?: string;
  },
): void {
  const run = resolveRun(cli);
  if (!run) return;

  run.status = finalStatus;
  run.lastAgentStatus = finalStatus === "done" ? "done" : "error";

  if (options?.sessionId !== undefined) run.sessionId = options.sessionId;
  if (options?.error !== undefined) run.error = options.error;

  if (!run.text.trim() && options?.fallbackText) {
    run.blocks.push({ type: "text", text: options.fallbackText });
    run.invalidateCache();
  }

  if (!run.thinking.trim() && options?.fallbackThinking) {
    run.blocks.unshift({ type: "thought", text: options.fallbackThinking });
    run.invalidateCache();
  }
}

export function getVisibleRun(cli: string): StreamRun | undefined {
  return resolveRun(cli);
}

export function getRunById(runId: string): StreamRun | undefined {
  return getStoreState().runs.get(runId);
}

export function getAllVisibleRuns(clis?: readonly string[]): (StreamRun | undefined)[] {
  const ids = clis ?? getRegisteredOrder();
  return ids.map((carrierId) => resolveRun(carrierId));
}

export function listRuns(): StreamRun[] {
  return [...getStoreState().runs.values()];
}

export function setRunSessionId(cli: string, sessionId?: string): void {
  const run = resolveRun(cli);
  if (run) {
    run.sessionId = sessionId;
  }
}

export function ensureVisibleRun(cli: string): StreamRun {
  const existing = resolveRun(cli);
  if (existing) return existing;
  createRun(cli, "wait");
  return resolveRun(cli)!;
}

export function getVisibleRunId(cli: string): string | undefined {
  return getStoreState().visibleRunIdByCli.get(cli);
}

export function setVisibleRun(cli: string, runId: string): void {
  const state = getStoreState();
  if (!state.runs.has(runId)) return;
  state.visibleRunIdByCli.set(cli, runId);
}

export function setStreamStoreRegisteredOrderProvider(
  provider: (() => readonly string[]) | null,
): void {
  registeredOrderProvider = provider;
}

export function resetRuns(clis?: readonly string[]): void {
  const targets = clis ?? getRegisteredOrder();
  for (const cli of targets) {
    createRun(cli, "wait");
  }
}

function getStoreState(): StreamStoreState {
  let state = readBridgeState<Partial<StreamStoreState>>(STORE_KEY);
  if (!state) {
    state = {};
    writeBridgeState(STORE_KEY, state);
  }
  if (!(state.runs instanceof Map)) {
    state.runs = new Map();
  }
  if (!(state.visibleRunIdByCli instanceof Map)) {
    state.visibleRunIdByCli = new Map();
  }
  if (typeof state.counter !== "number") {
    state.counter = 0;
  }
  return state as StreamStoreState;
}

function resolveRun(cli: string): StreamRun | undefined {
  const state = getStoreState();
  const runId = state.visibleRunIdByCli.get(cli);
  return runId ? state.runs.get(runId) : undefined;
}

function nextRunId(cli: string): string {
  const state = getStoreState();
  state.counter += 1;
  return `${cli}-${state.counter}-${Date.now().toString(36)}`;
}

function sanitizeToolBlockLabel(value: string): string {
  return value
    .replace(TOOL_LABEL_ANSI_ESCAPE, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\n\r]/g, "↵")
    .replace(TOOL_LABEL_CONTROL_CHARS, "");
}

function getRegisteredOrder(): readonly string[] {
  return registeredOrderProvider?.() ?? [];
}
