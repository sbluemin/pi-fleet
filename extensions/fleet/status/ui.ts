import { ANSI_RESET, PANEL_DIM_COLOR } from "../constants.js";
import type { HealthStatus, ProviderKey, ServiceSnapshot } from "../core/index.js";

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

function renderPart(snapshot: ServiceSnapshot): string {
  const statusColor = STATUS_ANSI_COLORS[snapshot.status];
  return `${statusColor}${STATUS_TEXT[snapshot.status]}${ANSI_RESET}`;
}

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
