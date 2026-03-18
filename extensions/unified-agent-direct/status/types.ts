export type ProviderKey = "claude" | "codex" | "gemini";

export type HealthStatus =
  | "operational"
  | "partial_outage"
  | "major_outage"
  | "maintenance"
  | "unknown";

export interface ServiceSnapshot {
  provider: ProviderKey;
  label: string;
  status: HealthStatus;
  matchedTarget: string;
  sourceUrl: string;
  checkedAt: number;
  note?: string;
}

export interface StatusStore {
  ctx: any | null;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  lastRefreshStartedAt: number;
  lastUpdatedAt: number | null;
  snapshots: ServiceSnapshot[];
  /** provider별 마지막 확인 시각 (차등 폴링용) */
  providerLastChecked: Record<ProviderKey, number>;
}
