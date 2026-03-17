/**
 * unified-agent-direct — 단일 direct 실행을 Agent Panel에 스트리밍
 *
 * 에이전트 패널이 스트리밍의 주 UI가 되었으므로,
 * 개별 CLI 실행의 모든 이벤트(thinking, 도구 호출, 응답)를
 * 패널 칼럼 상태에 직접 반영합니다.
 */

import type { CliType } from "@sbluemin/unified-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentStatus, ExecuteResult } from "../unified-agent-core/types";
import {
  beginColStreaming,
  endColStreaming,
  getAgentPanelCols,
  updateAgentCol,
} from "./agent-panel";

const PANEL_CLI_ORDER: CliType[] = ["claude", "codex", "gemini"];

function getColIndex(cli: CliType): number {
  return PANEL_CLI_ORDER.indexOf(cli);
}

function readCol(index: number) {
  return getAgentPanelCols()[index];
}

export function createDirectPanelMirror(ctx: ExtensionContext, cli: CliType) {
  const colIndex = getColIndex(cli);

  if (colIndex < 0) {
    throw new Error(`지원하지 않는 CLI입니다: ${cli}`);
  }

  return {
    start() {
      beginColStreaming(ctx, colIndex);
      updateAgentCol(colIndex, { error: undefined });
    },

    onStatusChange(status: AgentStatus) {
      if (status === "connecting") {
        updateAgentCol(colIndex, { status: "conn" });
        return;
      }
      if (status === "running") {
        updateAgentCol(colIndex, { status: "stream" });
      }
    },

    onMessageChunk(text: string) {
      const col = readCol(colIndex);
      updateAgentCol(colIndex, {
        status: "stream",
        text: (col?.text ?? "") + text,
      });
    },

    onThoughtChunk(text: string) {
      const col = readCol(colIndex);
      updateAgentCol(colIndex, {
        status: "stream",
        thinking: (col?.thinking ?? "") + text,
      });
    },

    /** 도구 호출 이벤트를 패널 칼럼에 반영합니다. */
    onToolCall(title: string, status: string) {
      const col = readCol(colIndex);
      if (!col) return;

      // 칼럼의 toolCalls 배열 업데이트
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
  };
}
