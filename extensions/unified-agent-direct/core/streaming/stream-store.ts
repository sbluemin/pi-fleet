/**
 * unified-agent-direct — 스트림 스토어 (단일 진실 원천)
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
 * ⚠️ globalThis 기반 — pi가 확장을 별도 번들로 로드하므로 필수.
 */

import type { ColBlock } from "../render/panel-renderer.js";
import type { AgentStatus } from "../../../unified-agent-core/types.js";
import { CLI_ORDER } from "../../constants.js";

// ─── 타입 ────────────────────────────────────────────────

/** 칼럼 상태 (패널 렌더러와 동일) */
export type ColStatus = "wait" | "conn" | "stream" | "done" | "err";

/** 수집된 스트리밍 데이터 (하위 호환 — mirror.ts의 CollectedStreamData 대체) */
export interface CollectedStreamData {
  text: string;
  thinking: string;
  toolCalls: { title: string; status: string; rawOutput?: string }[];
  blocks: ColBlock[];
  lastStatus: AgentStatus;
}

// ─── StreamRun 클래스 ────────────────────────────────────

/** 단일 실행의 스트리밍 데이터를 관리합니다. */
export class StreamRun {
  readonly runId: string;
  readonly cli: string;
  blocks: ColBlock[] = [];
  status: ColStatus = "wait";
  sessionId?: string;
  error?: string;

  /** blocks에서 파생되는 text 캐시 */
  private _textCache: string | null = null;
  /** blocks에서 파생되는 thinking 캐시 */
  private _thinkingCache: string | null = null;
  /** blocks에서 파생되는 toolCalls 캐시 */
  private _toolCallsCache: { title: string; status: string; rawOutput?: string }[] | null = null;
  /** 마지막 AgentStatus (SDK 콜백에서 전달된 값) */
  lastAgentStatus: AgentStatus = "connecting";

  constructor(runId: string, cli: string) {
    this.runId = runId;
    this.cli = cli;
  }

  /** blocks에서 파생된 응답 텍스트 */
  get text(): string {
    if (this._textCache === null) {
      this._textCache = this.blocks
        .filter((b): b is Extract<ColBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
    return this._textCache;
  }

  /** blocks에서 파생된 thinking 텍스트 */
  get thinking(): string {
    if (this._thinkingCache === null) {
      this._thinkingCache = this.blocks
        .filter((b): b is Extract<ColBlock, { type: "thought" }> => b.type === "thought")
        .map((b) => b.text)
        .join("");
    }
    return this._thinkingCache;
  }

  /** blocks에서 파생된 도구 호출 목록 */
  get toolCalls(): { title: string; status: string; rawOutput?: string }[] {
    if (this._toolCallsCache === null) {
      this._toolCallsCache = this.blocks
        .filter((b): b is Extract<ColBlock, { type: "tool" }> => b.type === "tool")
        .map((b) => ({ title: b.title, status: b.status, rawOutput: b.rawOutput }));
    }
    return this._toolCallsCache;
  }

  /** 파생 캐시 무효화 — 블록 변경 시 호출 */
  invalidateCache(): void {
    this._textCache = null;
    this._thinkingCache = null;
    this._toolCallsCache = null;
  }

  /** CollectedStreamData 형태로 복사본 반환 (하위 호환) */
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

// ─── globalThis 싱글턴 ──────────────────────────────────

const STORE_KEY = "__pi_stream_store__";

interface StreamStoreState {
  /** runId → StreamRun */
  runs: Map<string, StreamRun>;
  /** CLI → 현재 표시할 runId */
  visibleRunIdByCli: Map<string, string>;
  /** runId 생성용 카운터 */
  counter: number;
}

function getStoreState(): StreamStoreState {
  let s = (globalThis as any)[STORE_KEY] as StreamStoreState | undefined;
  if (!s) {
    s = {
      runs: new Map(),
      visibleRunIdByCli: new Map(),
      counter: 0,
    };
    (globalThis as any)[STORE_KEY] = s;
  }
  return s;
}

// ─── 내부 헬퍼 ──────────────────────────────────────────

/** 유니크 runId 생성 */
function nextRunId(cli: string): string {
  const s = getStoreState();
  s.counter++;
  return `${cli}-${s.counter}-${Date.now().toString(36)}`;
}

/** CLI에 대한 현재 활성 run을 조회 */
function resolveRun(cli: string): StreamRun | undefined {
  const s = getStoreState();
  const runId = s.visibleRunIdByCli.get(cli);
  if (!runId) return undefined;
  return s.runs.get(runId);
}

// ─── 도메인 특화 API (외부 mutation 진입점) ──────────────

/**
 * 새 run을 생성하고 해당 CLI의 visible run으로 설정합니다.
 * @returns 생성된 runId
 */
export function createRun(cli: string, initialStatus: ColStatus = "conn"): string {
  const s = getStoreState();
  const runId = nextRunId(cli);
  const run = new StreamRun(runId, cli);
  run.status = initialStatus;
  s.runs.set(runId, run);
  s.visibleRunIdByCli.set(cli, runId);
  return runId;
}

/**
 * 텍스트 블록을 추가하거나 마지막 텍스트 블록에 이어붙입니다.
 */
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

/**
 * 사고(thought) 블록을 추가하거나 마지막 thought 블록에 이어붙입니다.
 */
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

/**
 * 도구 블록을 추가하거나 기존 동일 toolCallId(또는 title) 블록을 업데이트합니다.
 * toolCallId가 있으면 toolCallId 기준, 없으면 title 기준 (하위 호환).
 */
export function upsertToolBlock(
  cli: string,
  title: string,
  status: string,
  rawOutput?: string,
  toolCallId?: string,
): void {
  const run = resolveRun(cli);
  if (!run) return;

  const existing = run.blocks.find(
    (b): b is Extract<ColBlock, { type: "tool" }> =>
      b.type === "tool" &&
      (toolCallId ? b.toolCallId === toolCallId : b.title === title),
  );

  if (existing) {
    existing.status = status;
    if (rawOutput !== undefined) existing.rawOutput = rawOutput;
  } else {
    run.blocks.push({ type: "tool", title, status, rawOutput, toolCallId });
  }

  if (run.status === "conn" || run.status === "wait") {
    run.status = "stream";
  }
  run.invalidateCache();
}

/**
 * run의 AgentStatus를 업데이트합니다.
 */
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

/**
 * run을 최종 상태로 마무리합니다.
 * SDK 실행 결과를 반영하여 status, sessionId, error를 설정합니다.
 */
export function finalizeRun(
  cli: string,
  finalStatus: "done" | "err",
  options?: {
    sessionId?: string;
    error?: string;
    /** SDK 결과 텍스트 (스트리밍 누적이 없을 때 폴백) */
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

  // 스트리밍으로 텍스트가 누적되지 않은 경우 SDK 결과로 폴백
  if (!run.text.trim() && options?.fallbackText) {
    run.blocks.push({ type: "text", text: options.fallbackText });
    run.invalidateCache();
  }

  // thinking 폴백
  if (!run.thinking.trim() && options?.fallbackThinking) {
    // thought 블록이 하나도 없으면 맨 앞에 추가
    run.blocks.unshift({ type: "thought", text: options.fallbackThinking });
    run.invalidateCache();
  }
}

// ─── 조회 API ───────────────────────────────────────────

/** 특정 CLI의 현재 visible run을 반환합니다. */
export function getVisibleRun(cli: string): StreamRun | undefined {
  return resolveRun(cli);
}

/** 모든 CLI에 대한 visible run 배열을 반환합니다 (CLI_ORDER 순서). */
export function getAllVisibleRuns(): (StreamRun | undefined)[] {
  return CLI_ORDER.map((cli) => resolveRun(cli));
}

/** runId로 직접 조회합니다. */
export function getRunById(runId: string): StreamRun | undefined {
  return getStoreState().runs.get(runId);
}

/**
 * 지정된 CLI들에 대해 새 run을 생성합니다.
 * All 모드나 개별 모드 시작 시 호출합니다.
 */
export function resetRuns(clis?: readonly string[]): void {
  const targets = clis ?? CLI_ORDER;
  for (const cli of targets) {
    createRun(cli, "wait");
  }
}

/**
 * 특정 CLI의 visible run을 sessionId 기반으로 복원합니다.
 * 패널 footer에 세션 정보를 표시하기 위해 사용합니다.
 */
export function setRunSessionId(cli: string, sessionId?: string): void {
  const run = resolveRun(cli);
  if (run) {
    run.sessionId = sessionId;
  }
}

/**
 * 특정 CLI의 visible runId 매핑을 초기화합니다 (run이 존재하지 않는 경우).
 * 패널 초기 표시용으로 빈 run을 생성합니다.
 */
export function ensureVisibleRun(cli: string): StreamRun {
  const existing = resolveRun(cli);
  if (existing) return existing;
  createRun(cli, "wait");
  return resolveRun(cli)!;
}
