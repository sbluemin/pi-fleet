/**
 * fleet/operation-runner.ts — 에이전트 작전 실행 러너
 *
 * 모든 에이전트 실행의 단일 진입점입니다.
 * runAgentRequest() 호출 시 자동으로:
 *  - stream-store에 run 생성 및 데이터 기록
 *  - 에이전트 패널 칼럼 동기화
 *  - aboveEditor 스트리밍 위젯 관리 (패널 토글 대응)
 *  - 외부 콜백 전달
 *
 * router.ts + streaming-widget.ts의 로직을 흡수한 통합 계층입니다.
 */

import { executeWithPool } from "./internal/agent/executor";
import type { AgentStatus } from "./internal/agent/types";
import { getModelConfig } from "./internal/agent/runtime.js";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getRunById,
  getVisibleRun,
} from "./internal/streaming/stream-store.js";
import { createStreamWidgetManager } from "./internal/streaming/stream-manager.js";
import {
  beginColStreaming,
  endColStreaming,
  updateAgentCol,
  isAgentPanelExpanded,
  onPanelToggle,
} from "./internal/panel/lifecycle.js";
import { getRegisteredOrder } from "./carrier/framework.js";
import type {
  UnifiedAgentRequestBridge,
  UnifiedAgentRequestOptions,
  UnifiedAgentRequestStatus,
  UnifiedAgentResult,
} from "./types.js";
import { UNIFIED_AGENT_REQUEST_KEY } from "./types.js";

// ─── 통합 위젯 매니저 (싱글턴) ──────────────────────────

const widgetManager = createStreamWidgetManager(
  "__pi_ua_stream_manager__",
  "ua-stream",
);

// ─── 완료 후 위젯 유지용 cleanup 맵 ────────────────────
// 스트리밍 완료 후에도 ua-stream 위젯과 패널 토글 구독을 유지하여
// ctrl+o 토글 및 패널 show/hide가 반영되도록 합니다.
//
// active: 스트리밍 진행 중인 run (toggle 구독 등록 직후 저장)
// completed: 스트리밍 완료된 run (finally에서 active → completed 이동)
// 분리 이유: busy 중 모드 OFF/세션 전환 시에도 active run의 구독을 정리하기 위함

/** 진행 중인 run의 cleanup (위젯 해제 + 토글 구독 해제) */
const activeRunCleanups = new Map<string, () => void>();
/** 완료된 run의 cleanup (위젯 해제 + 토글 구독 해제) */
const completedRunCleanups = new Map<string, () => void>();

/** 완료된 run의 cleanup만 실행합니다 (다음 run 시작 시). */
function flushCompletedCleanups(): void {
  for (const cleanup of completedRunCleanups.values()) cleanup();
  completedRunCleanups.clear();
}

/**
 * 완료된 run의 위젯만 제거합니다 (진행 중 위젯은 유지).
 * before_agent_start 시 호출하여 pi 호스트 출력과 겹치지 않게 합니다.
 */
export function clearCompletedStreamWidgets(): void {
  flushCompletedCleanups();
}

/**
 * ua-stream 위젯과 관련 구독을 모두 제거합니다.
 * 모드 비활성화/세션 전환 시 호출하여 잔존 위젯을 정리합니다.
 * active + completed 모두 해제하므로 busy 중에도 안전합니다.
 */
export function clearStreamWidgets(): void {
  for (const cleanup of activeRunCleanups.values()) cleanup();
  activeRunCleanups.clear();
  for (const cleanup of completedRunCleanups.values()) cleanup();
  completedRunCleanups.clear();
  widgetManager.clearAll();
}

// ─── 내부 타입 ──────────────────────────────────────────

interface RunAgentRequestOptions extends UnifiedAgentRequestOptions {}

// ─── 내부 헬퍼 ──────────────────────────────────────────

/** executeWithPool의 AgentStatus를 공개 API의 최종 상태로 변환 */
function toFinalStatus(status: AgentStatus): UnifiedAgentRequestStatus {
  if (status === "done" || status === "aborted") {
    return status;
  }
  return "error";
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

// ─── 공개 API ────────────────────────────────────────────

/**
 * 에이전트 실행의 통합 진입점입니다.
 *
 * stream-store에 run을 생성하고 executeWithPool로 실행하면서
 * 에이전트 패널 + 스트리밍 위젯을 자동으로 동기화합니다.
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

  const carrierId = options.carrierId ?? cli;
  const colIndex = getRegisteredOrder().indexOf(carrierId);

  // 0. 이전 run 정리
  flushCompletedCleanups();
  // 같은 carrier의 진행 중 run이 있으면 정리 (프로그래밍적 재실행 안전 가드)
  const prevActive = activeRunCleanups.get(carrierId);
  if (prevActive) {
    prevActive();
    activeRunCleanups.delete(carrierId);
  }

  // 1. store에 새 run 생성 (첫 줄만 추출하여 헤더 미리보기로 저장)
  const requestPreview = request?.trim().split(/\r?\n/, 1)[0];
  const runId = createRun(carrierId, "conn", requestPreview);

  // 2. 패널 칼럼 초기화
  if (colIndex >= 0) {
    beginColStreaming(ctx, colIndex);
  }

  // 3. 위젯 라우팅 (패널 토글 대응)
  //    패널이 접혀 있으면 aboveEditor 위젯으로 스트리밍 표시
  //    패널이 펼쳐지면 위젯 제거 (패널이 직접 렌더링)
  let unsubToggle: (() => void) | null = null;

  function activateWidget(): void {
    widgetManager.register(ctx, carrierId, runId);
  }
  function deactivateWidget(): void {
    widgetManager.unregister(carrierId);
  }

  if (!isAgentPanelExpanded()) {
    activateWidget();
  }
  unsubToggle = onPanelToggle((expanded) => {
    if (expanded) deactivateWidget();
    else activateWidget();
  });

  // 스트리밍 진행 중 cleanup 등록 — busy 중 모드 OFF/세션 전환 시에도 해제 가능
  activeRunCleanups.set(carrierId, () => {
    deactivateWidget();
    if (unsubToggle) unsubToggle();
  });

  try {
    // 4. 설정 파일에서 모델 옵션을 읽어 해석된 값으로 주입 (Push 방식)
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
        appendTextBlock(carrierId, text);
        syncColFromStore(carrierId, colIndex);
        onMessageChunk?.(text);
      },
      onThoughtChunk: (text) => {
        appendThoughtBlock(carrierId, text);
        syncColFromStore(carrierId, colIndex);
        onThoughtChunk?.(text);
      },
      onToolCall: (title, status, rawOutput, toolCallId) => {
        upsertToolBlock(carrierId, title, status, toolCallId);
        syncColFromStore(carrierId, colIndex);
        onToolCall?.(title, status, rawOutput, toolCallId);
      },
      // onStatusChange는 의도적으로 외부 미노출 — 위젯/패널이 자동 관리
      onStatusChange: (status) => {
        updateRunStatus(carrierId, status);
        syncColFromStore(carrierId, colIndex);
      },
    });

    // 5. 최종 상태 반영 (store finalize + 패널 동기화)
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

    // 6. 결과 수집 (store에서 읽기)
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
    // 7. 패널 칼럼 스트리밍 종료
    if (colIndex >= 0) {
      endColStreaming(ctx, colIndex);
    }
    // active → completed 이동: 위젯 + 토글 구독 유지
    // before_agent_start / 다음 runAgentRequest / clearStreamWidgets() 시 정리
    activeRunCleanups.delete(carrierId);
    completedRunCleanups.set(carrierId, () => {
      deactivateWidget();
      if (unsubToggle) unsubToggle();
    });

    // 2초 후 자동 소멸 — completedRunCleanups에 남아있을 때만 실행
    // flushCompletedCleanups / clearStreamWidgets가 먼저 호출되었으면 이미 삭제되어 중복 방지
    setTimeout(() => {
      const cleanup = completedRunCleanups.get(carrierId);
      if (cleanup) {
        cleanup();
        completedRunCleanups.delete(carrierId);
      }
    }, 2000);
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
