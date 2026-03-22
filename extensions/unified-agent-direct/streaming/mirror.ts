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
import type { ColBlock } from "../render/panel-renderer";
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
  toolCalls: { title: string; status: string; rawOutput?: string }[];
  /** 순서 보존된 이벤트 블록 (메시지 렌더러용) */
  blocks: ColBlock[];
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
  const accToolCalls: { title: string; status: string; rawOutput?: string }[] = [];
  const accBlocks: ColBlock[] = [];
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

      // accBlocks에 text 블록 추가/업데이트 (패널 col.blocks와 동일 로직)
      const lastAcc = accBlocks[accBlocks.length - 1];
      if (lastAcc?.type === "text") {
        lastAcc.text += text;
      } else {
        accBlocks.push({ type: "text", text });
      }

      const col = readCol(colIndex);
      if (!col) return;

      // blocks에서 마지막 text 블록에 이어붙이거나 새 블록 추가
      const blocks = col.blocks ?? [];
      const last = blocks[blocks.length - 1];
      let newBlocks: ColBlock[];
      if (last?.type === "text") {
        newBlocks = [...blocks.slice(0, -1), { type: "text", text: last.text + text }];
      } else {
        newBlocks = [...blocks, { type: "text", text }];
      }

      updateAgentCol(colIndex, {
        status: "stream",
        text: (col.text ?? "") + text,  // 하위 호환 유지
        blocks: newBlocks,
      });
    },

    onThoughtChunk(text: string) {
      accThinking += text;

      const lastAcc = accBlocks[accBlocks.length - 1];
      if (lastAcc?.type === "thought") {
        lastAcc.text += text;
      } else {
        accBlocks.push({ type: "thought", text });
      }

      const col = readCol(colIndex);
      const blocks = col?.blocks ?? [];
      const last = blocks[blocks.length - 1];
      const newBlocks = last?.type === "thought"
        ? [...blocks.slice(0, -1), { type: "thought" as const, text: last.text + text }]
        : [...blocks, { type: "thought" as const, text }];
      updateAgentCol(colIndex, {
        status: "stream",
        thinking: (col?.thinking ?? "") + text,
        blocks: newBlocks,
      });
    },

    /** 도구 호출 이벤트를 누적 + 패널 칼럼에 반영합니다. */
    onToolCall(title: string, status: string, rawOutput?: string) {
      // 자체 누적
      const accExisting = accToolCalls.find((tc) => tc.title === title);
      if (accExisting) {
        accExisting.status = status;
        if (rawOutput !== undefined) {
          accExisting.rawOutput = rawOutput;
        }
      } else {
        accToolCalls.push({ title, status, rawOutput });
      }

      // accBlocks에 tool 블록 추가/업데이트 (패널 col.blocks와 동일 로직)
      const accBlockIdx = accBlocks.findIndex(
        (b): b is Extract<ColBlock, { type: "tool" }> => b.type === "tool" && b.title === title,
      );
      if (accBlockIdx >= 0) {
        const block = accBlocks[accBlockIdx] as Extract<ColBlock, { type: "tool" }>;
        block.status = status;
        if (rawOutput !== undefined) block.rawOutput = rawOutput;
      } else {
        accBlocks.push({ type: "tool", title, status, rawOutput });
      }

      // 패널 칼럼 반영
      const col = readCol(colIndex);
      if (!col) return;

      // ── blocks 업데이트: 이벤트 순서 보존 ──────────────────
      const blocks = col.blocks ?? [];
      const toolBlockIdx = blocks.findIndex(
        (b): b is Extract<ColBlock, { type: "tool" }> => b.type === "tool" && b.title === title,
      );
      let newBlocks: ColBlock[];
      if (toolBlockIdx >= 0) {
        // 기존 tool 블록 업데이트 (status, rawOutput)
        newBlocks = blocks.map((b, i) => {
          if (i === toolBlockIdx && b.type === "tool") {
            return {
              type: "tool" as const,
              title: b.title,
              status,
              ...(rawOutput !== undefined ? { rawOutput } : {}),
            };
          }
          return b;
        });
      } else {
        // 새 tool 블록 추가
        newBlocks = [...blocks, { type: "tool" as const, title, status, rawOutput }];
      }

      // toolCalls 동기화 (하위 호환)
      const toolCalls = [...(col.toolCalls ?? [])];
      const existing = toolCalls.find((tc) => tc.title === title);
      if (existing) {
        existing.status = status;
        if (rawOutput !== undefined) existing.rawOutput = rawOutput;
      } else {
        toolCalls.push({ title, status, rawOutput });
      }

      updateAgentCol(colIndex, {
        blocks: newBlocks,
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
        blocks: accBlocks.map((b) => ({ ...b })),
        lastStatus,
      };
    },
  };
}
