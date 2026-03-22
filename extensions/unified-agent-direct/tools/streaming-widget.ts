/**
 * unified-agent-direct/tools — 스트리밍 위젯
 *
 * 도구 실행 중 aboveEditor 위젯으로 에이전트 응답을 실시간 표시합니다.
 * stream-store(단일 진실 원천)에 데이터를 기록하고,
 * stream-manager(제네릭 합성 위젯)를 통해 렌더링합니다.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentStatus } from "../../unified-agent-core/types";
import type { CollectedStreamData } from "../streaming/stream-store";
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getRunById,
} from "../streaming/stream-store";
import { createStreamWidgetManager } from "../streaming/stream-manager";

// ─── 하위 호환 re-export ────────────────────────────────

export type { CollectedStreamData } from "../streaming/stream-store";

// ─── 도구 실행용 위젯 매니저 (싱글턴) ──────────────────

const toolWidgetMgr = createStreamWidgetManager(
  "__pi_tool_stream_manager__",
  "ua-tool-stream",
);

// ─── 공개 API ────────────────────────────────────────────

export interface StreamingWidget {
  onMessage(text: string): void;
  onThought(text: string): void;
  onToolCall(title: string, status: string, rawOutput?: string, toolCallId?: string): void;
  onStatus(status: AgentStatus): void;
  finish(): void;
  fail(error: string): void;
  destroy(): void;
  /** 누적된 스트리밍 데이터를 반환합니다. */
  getCollectedData(): CollectedStreamData;
}

/**
 * aboveEditor 합성 위젯으로 에이전트 실행 스트리밍을 표시합니다.
 * stream-store에 데이터를 기록하고 stream-manager로 위젯을 관리합니다.
 */
export function createStreamingWidget(
  ctx: ExtensionContext,
  cli: string,
): StreamingWidget {
  // store에 새 run 생성
  const runId = createRun(cli, "conn");

  // 위젯 매니저에 등록
  toolWidgetMgr.register(ctx, cli, runId);

  return {
    onMessage(text) {
      appendTextBlock(cli, text);
    },

    onThought(text) {
      appendThoughtBlock(cli, text);
    },

    onToolCall(title, status, rawOutput, toolCallId) {
      upsertToolBlock(cli, title, status, rawOutput, toolCallId);
    },

    onStatus(status) {
      updateRunStatus(cli, status);
    },

    finish() {
      finalizeRun(cli, "done");
      toolWidgetMgr.sync();
    },

    fail(error) {
      finalizeRun(cli, "err", { error });
      toolWidgetMgr.sync();
    },

    destroy() {
      toolWidgetMgr.unregister(cli);
    },

    getCollectedData(): CollectedStreamData {
      const run = getRunById(runId);
      if (run) return run.toCollectedData();
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
