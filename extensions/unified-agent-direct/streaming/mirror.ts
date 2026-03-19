/**
 * unified-agent-direct — 스트리밍 데이터 미러 (단일 누적 지점)
 *
 * 스트리밍 이벤트(thinking, 도구 호출, 응답)를 수집하면서
 * 동시에 에이전트 패널 칼럼 상태에 반영합니다.
 *
 * 누적된 데이터는 getCollectedData()를 통해 외부에 노출되어
 * 패널 렌더러(실시간)와 메시지 렌더러(채팅 히스토리) 모두에 공급됩니다.
 */

import type { CliType } from "@sbluemin/unified-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentStatus, ExecuteResult } from "../../unified-agent-core/types";
import {
  beginColStreaming,
  endColStreaming,
  getAgentPanelCols,
  updateAgentCol,
} from "../agent-panel";

// ─── 수집 데이터 타입 ─────────────────────────────────────

/** 스트리밍 중 누적된 데이터를 외부에 노출하는 인터페이스 */
export interface CollectedStreamData {
  /** 누적된 응답 텍스트 */
  text: string;
  /** 누적된 thinking 텍스트 */
  thinking: string;
  /** 누적된 도구 호출 목록 */
  toolCalls: { title: string; status: string }[];
  /** 마지막 에이전트 상태 */
  lastStatus: AgentStatus;
}

// ─── 내부 헬퍼 ────────────────────────────────────────────

const PANEL_CLI_ORDER: CliType[] = ["claude", "codex", "gemini"];

function getColIndex(cli: CliType): number {
  return PANEL_CLI_ORDER.indexOf(cli);
}

function readCol(index: number) {
  return getAgentPanelCols()[index];
}

// ─── 공개 API ─────────────────────────────────────────────

/**
 * 스트리밍 미러를 생성합니다.
 *
 * 스트리밍 이벤트를 수신하여:
 * 1. 내부 상태에 누적 (getCollectedData()로 조회)
 * 2. 에이전트 패널 칼럼에 실시간 반영
 */
export function createStreamingMirror(ctx: ExtensionContext, cli: CliType) {
  const colIndex = getColIndex(cli);

  if (colIndex < 0) {
    throw new Error(`지원하지 않는 CLI입니다: ${cli}`);
  }

  // ── 누적 상태 ──
  let accText = "";
  let accThinking = "";
  const accToolCalls: { title: string; status: string }[] = [];
  let lastStatus: AgentStatus = "connecting";

  return {
    start() {
      beginColStreaming(ctx, colIndex);
      updateAgentCol(colIndex, { error: undefined });
    },

    onStatusChange(status: AgentStatus) {
      lastStatus = status;

      if (status === "connecting") {
        updateAgentCol(colIndex, { status: "conn" });
        return;
      }
      if (status === "running") {
        updateAgentCol(colIndex, { status: "stream" });
      }
    },

    onMessageChunk(text: string) {
      accText += text;

      const col = readCol(colIndex);
      updateAgentCol(colIndex, {
        status: "stream",
        text: (col?.text ?? "") + text,
      });
    },

    onThoughtChunk(text: string) {
      accThinking += text;

      const col = readCol(colIndex);
      updateAgentCol(colIndex, {
        status: "stream",
        thinking: (col?.thinking ?? "") + text,
      });
    },

    /** 도구 호출 이벤트를 누적 + 패널 칼럼에 반영합니다. */
    onToolCall(title: string, status: string) {
      // 자체 누적
      const accExisting = accToolCalls.find((tc) => tc.title === title);
      if (accExisting) accExisting.status = status;
      else accToolCalls.push({ title, status });

      // 패널 칼럼 반영
      const col = readCol(colIndex);
      if (!col) return;

      const toolCalls = [...(col.toolCalls ?? [])];
      const existing = toolCalls.find((tc) => tc.title === title);
      if (existing) {
        existing.status = status;
      } else {
        toolCalls.push({ title, status });
      }

      updateAgentCol(colIndex, {
        toolCalls,
        status: col.status === "conn" || col.status === "wait" ? "stream" : col.status,
      });
    },

    finish(result: ExecuteResult) {
      const col = readCol(colIndex);
      const sessionId = result.connectionInfo.sessionId ?? col?.sessionId;
      if (result.status === "done") {
        updateAgentCol(colIndex, {
          status: "done",
          sessionId,
          error: undefined,
          thinking: col?.thinking ?? result.thoughtText,
          text: col?.text?.trim() ? col.text : (result.responseText || "(no output)"),
        });
        return;
      }

      if (result.status === "aborted") {
        updateAgentCol(colIndex, {
          status: "err",
          sessionId,
          error: "aborted",
          thinking: col?.thinking ?? result.thoughtText,
          text: col?.text?.trim() ? col.text : "Aborted.",
        });
        return;
      }

      updateAgentCol(colIndex, {
        status: "err",
        sessionId,
        error: result.error,
        thinking: col?.thinking ?? result.thoughtText,
        text: col?.text?.trim()
          ? col.text
          : `Error: ${result.error ?? result.status ?? "unknown"}`,
      });
    },

    fail(error: string) {
      const col = readCol(colIndex);
      updateAgentCol(colIndex, {
        status: "err",
        error,
        text: col?.text?.trim() ? col.text : `Error: ${error}`,
      });
    },

    stop() {
      endColStreaming(ctx, colIndex);
    },

    /** 누적된 스트리밍 데이터를 반환합니다. */
    getCollectedData(): CollectedStreamData {
      return {
        text: accText,
        thinking: accThinking,
        toolCalls: accToolCalls.map((tc) => ({ ...tc })),
        lastStatus,
      };
    },
  };
}
