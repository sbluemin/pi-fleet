/**
 * service-status/renderer.ts — 서비스 상태 토큰 렌더러
 *
 * footer에 표시되는 CLI별 서비스 상태(OP/DEG/OUT 등)를
 * ANSI 컬러 토큰으로 렌더링합니다.
 */

import type { HealthStatus, ProviderKey, ServiceSnapshot } from "../types.js";

const ANSI_RESET = "\x1b[0m";
const PANEL_DIM_COLOR = "\x1b[38;2;100;100;100m";

const STATUS_TEXT: Record<HealthStatus, string> = {
  operational: "OP",
  partial_outage: "DEG",
  major_outage: "OUT",
  maintenance: "MNT",
  unknown: "UNK",
};

const STATUS_ANSI_COLORS: Record<HealthStatus, string> = {
  operational: "\x1b[38;2;80;200;120m",
  partial_outage: "\x1b[38;2;220;180;50m",
  major_outage: "\x1b[38;2;220;80;80m",
  maintenance: "\x1b[38;2;200;170;60m",
  unknown: "\x1b[38;2;120;120;120m",
};

export function renderServiceStatusToken(
  provider: ProviderKey,
  snapshots: ServiceSnapshot[],
  loading: boolean,
): string | undefined {
  const snapshot = snapshots.find((item) => item.provider === provider);
  if (snapshot) {
    return ` ${renderPart(snapshot)}`;
  }

  if (!loading) return undefined;
  return ` ${PANEL_DIM_COLOR}...${ANSI_RESET}`;
}

function renderPart(snapshot: ServiceSnapshot): string {
  const statusColor = STATUS_ANSI_COLORS[snapshot.status];
  return `${statusColor}${STATUS_TEXT[snapshot.status]}${ANSI_RESET}`;
}
