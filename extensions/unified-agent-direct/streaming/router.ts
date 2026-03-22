/**
 * unified-agent-direct — 스트리밍 출력 라우터
 *
 * 스트리밍 이벤트를 stream-store(단일 진실 원천)에 기록하고,
 * 패널 상태에 따라 위젯 표시를 동적으로 라우팅합니다:
 * - 패널 펼침 → 패널 칼럼에만 반영 (에이전트 패널이 렌더링)
 * - 패널 접힘 → 독립 aboveEditor 합성 위젯 동시 반영
 *
 * 데이터 누적은 stream-store가 단일 책임으로 관리하며,
 * 라우터는 store 기록 + 패널 브릿지 + 위젯 라우팅을 담당합니다.
 */

import type { CliType } from "@sbluemin/unified-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentStatus, ExecuteResult } from "../../unified-agent-core/types";
import type { CollectedStreamData } from "./stream-store";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getRunById,
  getVisibleRun,
} from "./stream-store";
import { createStreamWidgetManager } from "./stream-manager";
import {
  beginColStreaming,
  endColStreaming,
  updateAgentCol,
  isAgentPanelExpanded,
  onPanelToggle,
} from "../agent-panel";

// ─── 다이렉트 모드 위젯 매니저 (싱글턴) ────────────────

const directManager = createStreamWidgetManager(
  "__pi_direct_stream_manager__",
  "ua-direct-stream",
);

// ─── 내부 헬퍼 ──────────────────────────────────────────

const PANEL_CLI_ORDER: CliType[] = ["claude", "codex", "gemini"];

function getColIndex(cli: CliType): number {
  return PANEL_CLI_ORDER.indexOf(cli);
}

/**
 * store의 현재 run 데이터를 에이전트 패널 칼럼에 브릿지합니다.
 * agent-panel이 store를 직접 참조하도록 수정되면 이 함수는 제거됩니다.
 */
function syncColFromStore(cli: string, colIndex: number): void {
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

// ─── 라우터 공개 API ──────────────────────────────────────

export function createDirectStreamingRouter(ctx: ExtensionContext, cli: CliType) {
  const colIndex = getColIndex(cli);
  if (colIndex < 0) {
    throw new Error(`지원하지 않는 CLI입니다: ${cli}`);
  }

  let currentRunId: string | null = null;
  let unsubToggle: (() => void) | null = null;

  function activateWidget() {
    if (!currentRunId) return;
    directManager.register(ctx, cli, currentRunId);
  }

  function deactivateWidget() {
    directManager.unregister(cli);
  }

  function handleToggle(expanded: boolean) {
    if (expanded) {
      deactivateWidget();
    } else {
      activateWidget();
    }
  }

  return {
    start() {
      // store에 새 run 생성
      currentRunId = createRun(cli, "conn");

      // 패널 칼럼 초기화 (브릿지)
      beginColStreaming(ctx, colIndex);

      // 패널이 접힌 상태면 위젯 활성화
      if (!isAgentPanelExpanded()) {
        activateWidget();
      }
      unsubToggle = onPanelToggle(handleToggle);
    },

    onStatusChange(status: AgentStatus) {
      // store에 상태 업데이트
      updateRunStatus(cli, status);

      // 패널 칼럼 브릿지
      syncColFromStore(cli, colIndex);
    },

    onMessageChunk(text: string) {
      // store에 텍스트 블록 추가
      appendTextBlock(cli, text);

      // 패널 칼럼 브릿지
      syncColFromStore(cli, colIndex);
    },

    onThoughtChunk(text: string) {
      // store에 사고 블록 추가
      appendThoughtBlock(cli, text);

      // 패널 칼럼 브릿지
      syncColFromStore(cli, colIndex);
    },

    onToolCall(title: string, status: string, rawOutput?: string) {
      // store에 도구 블록 추가/업데이트
      upsertToolBlock(cli, title, status, rawOutput);

      // 패널 칼럼 브릿지
      syncColFromStore(cli, colIndex);
    },

    finish(result: ExecuteResult) {
      const sessionId = result.connectionInfo.sessionId;

      if (result.status === "done") {
        finalizeRun(cli, "done", {
          sessionId,
          fallbackText: result.responseText || "(no output)",
          fallbackThinking: result.thoughtText,
        });
      } else if (result.status === "aborted") {
        finalizeRun(cli, "err", {
          sessionId,
          error: "aborted",
          fallbackText: "Aborted.",
          fallbackThinking: result.thoughtText,
        });
      } else {
        finalizeRun(cli, "err", {
          sessionId,
          error: result.error,
          fallbackText: `Error: ${result.error ?? result.status ?? "unknown"}`,
          fallbackThinking: result.thoughtText,
        });
      }

      // 패널 칼럼 브릿지 (최종 상태)
      syncColFromStore(cli, colIndex);
    },

    fail(error: string) {
      finalizeRun(cli, "err", {
        error,
        fallbackText: `Error: ${error}`,
      });

      // 패널 칼럼 브릿지
      syncColFromStore(cli, colIndex);
    },

    stop() {
      deactivateWidget();
      endColStreaming(ctx, colIndex);
      if (unsubToggle) {
        unsubToggle();
        unsubToggle = null;
      }
    },

    /** 누적된 스트리밍 데이터를 반환합니다 (store에서 읽기). */
    getCollectedData(): CollectedStreamData {
      if (currentRunId) {
        const run = getRunById(currentRunId);
        if (run) return run.toCollectedData();
      }
      // 폴백: 빈 데이터
      return {
        text: "",
        thinking: "",
        toolCalls: [],
        blocks: [],
        lastStatus: "connecting",
      };
    },
  };
}
