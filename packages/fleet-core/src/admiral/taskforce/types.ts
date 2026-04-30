/**
 * fleet/shipyard/taskforce/types.ts — Task Force 도구 타입 정의
 *
 * BackendProgress, TaskForceResult, TaskForceState를 정의합니다.
 */

import type { CliType } from "@sbluemin/unified-agent";

export type TaskForceCliType = "claude" | "codex" | "gemini";

export interface BackendProgress {
  status: "queued" | "connecting" | "streaming" | "done" | "error";
  toolCallCount: number;
  lineCount: number;
}

export interface TaskForceResult {
  cliType: TaskForceCliType;
  displayName: string;
  status: "done" | "error" | "aborted";
  responseText: string;
  error?: string;
  thinking?: string;
  toolCalls?: { title: string; status: string }[];
}

export interface TaskForceState {
  carrierId: string;
  requestKey: string;
  backends: Map<TaskForceCliType, BackendProgress>;
  startedAt: number;
  finishedAt?: number;
}

export const TASKFORCE_CLI_TYPES = ["claude", "codex", "gemini"] as const satisfies readonly CliType[];
