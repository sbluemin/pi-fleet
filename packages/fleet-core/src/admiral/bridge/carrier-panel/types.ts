/**
 * fleet/panel/types.ts — 패널 도메인 타입 정의
 *
 * 에이전트 패널 칼럼 데이터 등 패널 계층의 핵심 타입을 정의합니다.
 *
 * ⚠️ 이 파일은 런타임 코드가 아닌 순수 타입/인터페이스만 포함합니다.
 */

import type { ColBlock, ColStatus } from "../../_shared/agent-runtime.js";
import type { PanelJobKind, PanelJobStatus } from "../run-stream/types.js";

export interface AgentCol {
  cli: string;
  sessionId?: string;
  blocks: ColBlock[];
  thinking: string;
  text: string;
  toolCalls: { title: string; status: string }[];
  status: ColStatus;
  error?: string;
  scroll: number;
}

export type ColumnTrackKind = "carrier" | "subtask" | "backend";

export interface ColumnTrack {
  trackId: string;
  streamKey: string;
  displayCli: string;
  runId?: string;
  displayName: string;
  subtitle?: string;
  kind: ColumnTrackKind;
  status: ColStatus;
}

export interface PanelJob {
  jobId: string;
  kind: PanelJobKind;
  ownerCarrierId: string;
  label: string;
  startedAt: number;
  finishedAt?: number;
  status: PanelJobStatus;
  tracks: ColumnTrack[];
  activeJobToolCallId?: string;
}
