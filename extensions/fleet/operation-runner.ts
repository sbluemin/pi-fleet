/**
 * fleet/operation-runner.ts — 에이전트 작전 실행 러너
 *
 * 모든 에이전트 실행의 단일 진입점입니다.
 * runAgentRequest() 호출 시 자동으로:
 *  - stream-store에 run 생성 및 데이터 기록
 *  - 에이전트 패널 칼럼 동기화
 *  - 외부 콜백 전달
 *
 * router.ts + streaming-widget.ts의 로직을 흡수한 통합 계층입니다.
 */

import { executeWithPool } from "../core/agent/executor";
import type { AgentStatus } from "../core/agent/types";
import { loadModels as getModelConfig } from "./shipyard/store.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getRunById,
  getVisibleRun,
} from "./streaming/stream-store.js";
import {
  beginColStreaming,
  endColStreaming,
  updateAgentCol,
} from "./panel/lifecycle.js";
import { findColIndex } from "./panel/state.js";
import type {
  UnifiedAgentRequestBridge,
  UnifiedAgentRequestOptions,
  UnifiedAgentRequestStatus,
  UnifiedAgentResult,
} from "./types.js";
import { UNIFIED_AGENT_REQUEST_KEY } from "./types.js";

// ─── 내부 타입 ──────────────────────────────────────────

interface RunAgentRequestOptions extends UnifiedAgentRequestOptions {}

// ─── 공개 API ────────────────────────────────────────────

/**
 * 에이전트 실행의 통합 진입점입니다.
 *
 * stream-store에 run을 생성하고 executeWithPool로 실행하면서
 * 에이전트 패널을 자동으로 동기화합니다.
 * 다른 확장에서도 await 가능한 형태로 결과를 반환합니다.
 */
export async function runAgentRequest(options: RunAgentRequestOptions): Promise<UnifiedAgentResult> {
  const {
    cli,
    request,
    ctx,
    signal,
    cwd,
    onMessageChunk,
    onThoughtChunk,
    onToolCall,
  } = options;

  const carrierId = options.carrierId;
  const colIndex = findColIndex(carrierId);

  // 1. store에 새 run 생성 (첫 줄만 추출하여 헤더 미리보기로 저장)
  const requestPreview = request?.trim().split(/\r?\n/, 1)[0];
  const runId = createRun(carrierId, "conn", requestPreview);

  // 2. 패널 칼럼 초기화
  if (colIndex >= 0) {
    beginColStreaming(ctx, colIndex);
  }

  try {
    // 3. 설정 파일에서 모델 옵션을 읽어 해석된 값으로 주입 (Push 방식)
    const cliConfig = getModelConfig()[carrierId];
    const result = await executeWithPool({
      carrierId,
      cliType: cli,
      request,
      cwd: cwd ?? ctx.cwd,
      model: cliConfig?.model,
      effort: cliConfig?.effort,
      budgetTokens: cliConfig?.budgetTokens,
      signal,
      onMessageChunk: (text) => {
        appendTextBlock(carrierId, sanitizeChunk(text));
        syncColFromStore(carrierId, colIndex);
        onMessageChunk?.(text);
      },
      onThoughtChunk: (text) => {
        appendThoughtBlock(carrierId, sanitizeChunk(text));
        syncColFromStore(carrierId, colIndex);
        onThoughtChunk?.(text);
      },
      onToolCall: (title, status, rawOutput, toolCallId) => {
        upsertToolBlock(carrierId, title, status, toolCallId);
        syncColFromStore(carrierId, colIndex);
        onToolCall?.(title, status, rawOutput, toolCallId);
      },
      // onStatusChange는 의도적으로 외부 미노출 — 패널이 자동 관리
      onStatusChange: (status) => {
        updateRunStatus(carrierId, status);
        syncColFromStore(carrierId, colIndex);
      },
    });

    // 4. 최종 상태 반영 (store finalize + 패널 동기화)
    const finalStatus = toFinalStatus(result.status);
    const sessionId = result.connectionInfo.sessionId;

    if (finalStatus === "done") {
      finalizeRun(carrierId, "done", {
        sessionId,
        fallbackText: result.responseText || "(no output)",
        fallbackThinking: result.thoughtText,
      });
    } else if (finalStatus === "aborted") {
      finalizeRun(carrierId, "err", {
        sessionId,
        error: "aborted",
        fallbackText: "Aborted.",
        fallbackThinking: result.thoughtText,
      });
    } else {
      finalizeRun(carrierId, "err", {
        sessionId,
        error: result.error,
        fallbackText: `Error: ${result.error ?? "unknown"}`,
        fallbackThinking: result.thoughtText,
      });
    }
    syncColFromStore(carrierId, colIndex);

    // 5. 결과 수집 (store에서 읽기)
    const run = getRunById(runId);
    const collected = run
      ? run.toCollectedData()
      : { text: "", thinking: "", toolCalls: [] as { title: string; status: string }[], blocks: [] as any[], lastStatus: "connecting" as const };

    return {
      status: finalStatus,
      responseText: result.responseText,
      sessionId: sessionId ?? undefined,
      error: result.error,
      thinking: collected.thinking || undefined,
      toolCalls: collected.toolCalls.length > 0 ? collected.toolCalls : undefined,
      blocks: collected.blocks.length > 0 ? collected.blocks : undefined,
    };
  } catch (error) {
    // executeWithPool이 throw한 경우 (연결 에러, abort 등)
    const message = error instanceof Error ? error.message : String(error);
    finalizeRun(carrierId, "err", { error: message, fallbackText: `Error: ${message}` });
    syncColFromStore(carrierId, colIndex);
    throw error;
  } finally {
    // 6. 패널 칼럼 스트리밍 종료
    if (colIndex >= 0) {
      endColStreaming(ctx, colIndex);
    }
  }
}

/**
 * 다른 확장에서 globalThis를 통해 접근할 공개 브릿지를 등록합니다.
 */
export function exposeAgentApi(): UnifiedAgentRequestBridge {
  const bridge: UnifiedAgentRequestBridge = {
    requestUnifiedAgent: (options) =>
      runAgentRequest({
        ...options,
      }),
  };

  (globalThis as Record<string, unknown>)[UNIFIED_AGENT_REQUEST_KEY] = bridge;
  return bridge;
}

// ─── 내부 헬퍼 ──────────────────────────────────────────

/** executeWithPool의 AgentStatus를 공개 API의 최종 상태로 변환 */
function toFinalStatus(status: AgentStatus): UnifiedAgentRequestStatus {
  if (status === "done" || status === "aborted") {
    return status;
  }
  return "error";
}

/** 스트리밍 청크에서 커서 이동 제어문자를 제거 — \r, \x1b[A 등이 위젯 레이아웃을 깨뜨리는 것 방지 */
function sanitizeChunk(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/\x1b\[\d*[ABCDEFGHJKST]/g, "")
    .replace(/\x1b\[\d*;\d*[Hf]/g, "")
    .replace(/\x1b\[(?:\??\d+[hl]|2J|K)/g, "");
}

/** store의 현재 run 데이터를 에이전트 패널 칼럼에 브릿지 */
function syncColFromStore(cli: string, colIndex: number): void {
  if (colIndex < 0) return;
  const run = getVisibleRun(cli);
  if (!run) return;
  updateAgentCol(colIndex, {
    status: run.status,
    text: run.text,
    thinking: run.thinking,
    toolCalls: run.toolCalls,
    blocks: run.blocks,
    sessionId: run.sessionId,
    error: run.error,
  });
}
