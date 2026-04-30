import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { HealthStatus, ProviderKey, ServiceSnapshot } from "@sbluemin/unified-agent";

export interface ServiceStatusCallbacks {
  setLoading: () => void;
  setStatus: (snapshots: ServiceSnapshot[], lastUpdatedAt: number | null) => void;
}

export interface ServiceStatusContextPort {
  hasUI: boolean;
  getSessionId(): string | null;
  notify(message: string, level: "info" | "warning"): void;
}

interface StatusStore {
  callbacks: ServiceStatusCallbacks | null;
  timer: ReturnType<typeof setInterval> | null;
  inFlight: Promise<void> | null;
  lastRefreshStartedAt: number;
  lastUpdatedAt: number | null;
  snapshots: ServiceSnapshot[];
  providerLastChecked: Record<ProviderKey, number>;
}

interface ComponentResponse {
  components?: Array<{
    name?: string;
    status?: string;
    updated_at?: string;
  }>;
}

interface ProviderFetchConfig {
  key: ProviderKey;
  intervalMs: number;
  fetcher: () => Promise<ServiceSnapshot>;
  fallback: (error: unknown) => ServiceSnapshot;
}

const execFileAsync = promisify(execFile);
const POLL_TICK_MS = 3 * 60_000;
const JSON_API_INTERVAL_MS = 3 * 60_000;
const GEMINI_INTERVAL_MS = 10 * 60_000;
const MIN_MANUAL_REFRESH_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const GEMINI_RENDER_TIMEOUT_MS = 20_000;
const CLAUDE_COMPONENT_NAMES = ["Claude API (api.anthropic.com)", "Claude Code"];
const OPENAI_COMPONENT_NAMES = ["Codex", "Responses", "Chat Completions"];
const STORE_KEY = "__pi_unified_agent_status_store__";
const PROVIDER_ORDER: ProviderKey[] = ["claude", "codex", "gemini"];
const PROVIDER_CONFIGS: ProviderFetchConfig[] = [
  {
    key: "claude",
    intervalMs: JSON_API_INTERVAL_MS,
    fetcher: fetchClaudeStatus,
    fallback: (err) => buildUnknownSnapshot("claude", "Claude", CLAUDE_COMPONENT_NAMES[0], "https://status.claude.com/#", err),
  },
  {
    key: "codex",
    intervalMs: JSON_API_INTERVAL_MS,
    fetcher: fetchOpenAiStatus,
    fallback: (err) => buildUnknownSnapshot("codex", "Codex", OPENAI_COMPONENT_NAMES[0], "https://status.openai.com/", err),
  },
  {
    key: "gemini",
    intervalMs: GEMINI_INTERVAL_MS,
    fetcher: fetchGeminiStatus,
    fallback: (err) => buildUnknownSnapshot("gemini", "Gemini", "API", "https://aistudio.google.com/status", err),
  },
];

let currentStatusCtx: ServiceStatusContextPort | null = null;
let statusContextGeneration = 0;

export function initServiceStatus(callbacks: ServiceStatusCallbacks): void {
  getStore().callbacks = callbacks;
}

export function resetServiceStatus(): void {
  const store = getStore();
  store.callbacks = null;
  currentStatusCtx = null;
  statusContextGeneration++;
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
}

export function attachStatusContext(ctx: ExtensionContext): void {
  attachStatusContextPort(createStatusContextPort(ctx));
}

export function detachStatusContext(): void {
  const store = getStore();
  currentStatusCtx = null;
  statusContextGeneration++;
  if (store.timer) {
    clearInterval(store.timer);
    store.timer = null;
  }
}

export async function refreshStatusNow(ctx: ExtensionContext): Promise<void> {
  const port = createStatusContextPort(ctx);
  setStatusContext(port);
  getStore().callbacks?.setLoading();
  await refreshSnapshots({ force: true, notify: true });
}

export function getServiceSnapshots(): ServiceSnapshot[] {
  return [...getStore().snapshots];
}

export function refreshStatusQuiet(): void {
  void refreshSnapshots();
}

function attachStatusContextPort(ctx: ServiceStatusContextPort): void {
  const store = getStore();
  setStatusContext(ctx);
  if (store.snapshots.length > 0) {
    syncPanelStatus();
  }
  ensurePolling();
}

function createStatusContextPort(ctx: ExtensionContext): ServiceStatusContextPort {
  return {
    get hasUI() {
      return ctx.hasUI;
    },
    getSessionId() {
      return ctx.sessionManager.getSessionId();
    },
    notify(message, level) {
      ctx.ui.notify(message, level);
    },
  };
}

function getStore(): StatusStore {
  let store = (globalThis as unknown as Record<string, StatusStore | undefined>)[STORE_KEY];
  if (!store) {
    store = {
      callbacks: null,
      timer: null,
      inFlight: null,
      lastRefreshStartedAt: 0,
      lastUpdatedAt: null,
      snapshots: [],
      providerLastChecked: { claude: 0, codex: 0, gemini: 0 },
    };
    (globalThis as unknown as Record<string, StatusStore | undefined>)[STORE_KEY] = store;
  }
  if (!store.providerLastChecked) {
    store.providerLastChecked = { claude: 0, codex: 0, gemini: 0 };
  }
  return store;
}

function syncPanelStatus(): void {
  const store = getStore();
  store.callbacks?.setStatus(store.snapshots, store.lastUpdatedAt);
}

function setStatusContext(ctx: ServiceStatusContextPort): void {
  if (currentStatusCtx !== ctx) {
    currentStatusCtx = ctx;
    statusContextGeneration++;
  }
}

function readSessionId(ctx: ServiceStatusContextPort): string | null {
  try {
    return ctx.getSessionId();
  } catch {
    return null;
  }
}

function mapRawStatus(rawStatus: string | undefined): HealthStatus {
  switch ((rawStatus ?? "").toLowerCase()) {
    case "operational":
      return "operational";
    case "degraded_performance":
    case "partial_outage":
      return "partial_outage";
    case "major_outage":
      return "major_outage";
    case "maintenance":
    case "under_maintenance":
      return "maintenance";
    default:
      return "unknown";
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "pi-fleet/status",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return await response.json() as T;
}

function findComponent(response: ComponentResponse, targetNames: string[]): { name: string; status: string; updatedAt?: string } {
  const components = response.components ?? [];
  for (const targetName of targetNames) {
    const matched = components.find((component) => component.name === targetName);
    if (matched?.name && matched.status) {
      return { name: matched.name, status: matched.status, updatedAt: matched.updated_at };
    }
  }
  throw new Error(`대상 컴포넌트를 찾지 못했습니다: ${targetNames.join(", ")}`);
}

function buildUnknownSnapshot(
  provider: ProviderKey,
  label: string,
  matchedTarget: string,
  sourceUrl: string,
  error: unknown,
): ServiceSnapshot {
  const message = error instanceof Error ? error.message : String(error);
  return {
    provider,
    label,
    status: "unknown",
    matchedTarget,
    sourceUrl,
    checkedAt: Date.now(),
    note: message,
  };
}

async function fetchClaudeStatus(): Promise<ServiceSnapshot> {
  const sourceUrl = "https://status.claude.com/api/v2/components.json";
  const response = await fetchJson<ComponentResponse>(sourceUrl);
  const matched = findComponent(response, CLAUDE_COMPONENT_NAMES);
  return {
    provider: "claude",
    label: "Claude",
    status: mapRawStatus(matched.status),
    matchedTarget: matched.name,
    sourceUrl,
    checkedAt: matched.updatedAt ? Date.parse(matched.updatedAt) || Date.now() : Date.now(),
  };
}

async function fetchOpenAiStatus(): Promise<ServiceSnapshot> {
  const sourceUrl = "https://status.openai.com/api/v2/components.json";
  const response = await fetchJson<ComponentResponse>(sourceUrl);
  const matched = findComponent(response, OPENAI_COMPONENT_NAMES);
  return {
    provider: "codex",
    label: "Codex",
    status: mapRawStatus(matched.status),
    matchedTarget: matched.name,
    sourceUrl,
    checkedAt: matched.updatedAt ? Date.parse(matched.updatedAt) || Date.now() : Date.now(),
  };
}

function getChromeCandidates(): string[] {
  if (process.env.PI_UNIFIED_AGENT_STATUS_CHROME) {
    return [process.env.PI_UNIFIED_AGENT_STATUS_CHROME];
  }
  switch (process.platform) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "google-chrome",
        "chromium",
      ];
    case "win32":
      return [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "chrome.exe",
      ];
    default:
      return [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "google-chrome",
        "chromium-browser",
        "chromium",
      ];
  }
}

function looksLikePath(binary: string): boolean {
  return binary.includes("/") || binary.includes("\\");
}

async function dumpDomWithChrome(url: string): Promise<string> {
  const args = ["--headless=new", "--disable-gpu", "--dump-dom", url];
  let lastError: unknown;
  for (const candidate of getChromeCandidates()) {
    if (looksLikePath(candidate) && !existsSync(candidate)) continue;
    try {
      const { stdout } = await execFileAsync(candidate, args, {
        timeout: GEMINI_RENDER_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout?.trim()) return stdout;
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
    }
  }
  const message = lastError instanceof Error ? lastError.message : "Chrome headless 실행 실패";
  throw new Error(message);
}

function extractGeminiOverallStatus(dom: string): HealthStatus {
  const match = dom.match(
    /class="status status-large ([^"]+)".*?<span[^>]*>(All Systems Operational|Partial Outage|We are working to resolve the issues as quickly as possible)<\/span>/s,
  );
  const rawClass = match?.[1] ?? "";
  const rawText = match?.[2] ?? "";
  if (rawClass.includes("operational") || rawText === "All Systems Operational") return "operational";
  if (rawClass.includes("full-outage") || rawText.startsWith("We are working to resolve")) return "major_outage";
  if (rawClass.includes("partial-outage") || rawText === "Partial Outage") return "partial_outage";
  return "unknown";
}

function extractGeminiServiceBlocks(dom: string): Map<string, string> {
  const normalized = dom.replace(/></g, ">\n<");
  const blocks = new Map<string, string>();
  const regex = /data-testid="service-name"[^>]*>\s*([^<]+?)\s*<\/div>([\s\S]*?)(?=<div [^>]*data-testid="service-name"|<footer\b)/g;
  for (const match of normalized.matchAll(regex)) {
    const serviceName = match[1]?.trim();
    const block = match[2];
    if (serviceName && block) {
      blocks.set(serviceName, block);
    }
  }
  return blocks;
}

function extractLastTimelineStatus(block: string): HealthStatus {
  const matches = [...block.matchAll(/class="xap-inline-dialog timeline-day([^"]*)"/g)];
  const lastClass = matches.at(-1)?.[1] ?? "";
  if (lastClass.includes("severity-major")) return "major_outage";
  if (lastClass.includes("severity-moderate")) return "partial_outage";
  if (matches.length > 0) return "operational";
  return "unknown";
}

async function fetchGeminiStatus(): Promise<ServiceSnapshot> {
  const sourceUrl = "https://aistudio.google.com/status";
  const dom = await dumpDomWithChrome(sourceUrl);
  const overallStatus = extractGeminiOverallStatus(dom);
  const serviceBlocks = extractGeminiServiceBlocks(dom);
  const apiBlock = serviceBlocks.get("API");
  const blockStatus = apiBlock ? extractLastTimelineStatus(apiBlock) : "unknown";
  return {
    provider: "gemini",
    label: "Gemini",
    status: overallStatus === "operational" ? "operational" : blockStatus,
    matchedTarget: "API",
    sourceUrl,
    checkedAt: Date.now(),
    note: apiBlock ? undefined : "API 블록 파싱 실패 — HTML 구조 변경 가능성",
  };
}

async function loadSnapshots(force: boolean): Promise<ServiceSnapshot[]> {
  const store = getStore();
  const now = Date.now();
  const staleConfigs = force
    ? PROVIDER_CONFIGS
    : PROVIDER_CONFIGS.filter((config) => now - store.providerLastChecked[config.key] >= config.intervalMs);
  if (staleConfigs.length === 0) return store.snapshots;

  const snapshotMap = new Map<ProviderKey, ServiceSnapshot>();
  for (const snapshot of store.snapshots) {
    snapshotMap.set(snapshot.provider, snapshot);
  }

  const fetched = await Promise.all(staleConfigs.map((config) => config.fetcher().catch((err) => config.fallback(err))));
  for (let index = 0; index < staleConfigs.length; index++) {
    const config = staleConfigs[index];
    snapshotMap.set(config.key, fetched[index]);
    store.providerLastChecked[config.key] = now;
  }

  return PROVIDER_ORDER
    .map((key) => snapshotMap.get(key))
    .filter((snapshot): snapshot is ServiceSnapshot => snapshot !== undefined);
}

async function refreshSnapshots(options?: { force?: boolean; notify?: boolean }): Promise<void> {
  const store = getStore();
  const ctx = currentStatusCtx;
  const ctxGeneration = statusContextGeneration;
  const ctxSessionId = ctx ? readSessionId(ctx) : null;
  if (!ctx?.hasUI) return;

  if (store.inFlight) {
    await store.inFlight;
    return;
  }

  const now = Date.now();
  if (!options?.force && now - store.lastRefreshStartedAt < MIN_MANUAL_REFRESH_MS) {
    syncPanelStatus();
    return;
  }

  store.lastRefreshStartedAt = now;
  store.inFlight = (async () => {
    const snapshots = await loadSnapshots(!!options?.force);
    store.snapshots = snapshots;
    store.lastUpdatedAt = Date.now();
    syncPanelStatus();

    const activeCtx = currentStatusCtx;
    const activeSessionId = activeCtx ? readSessionId(activeCtx) : null;
    const isCurrentCtx = activeCtx === ctx &&
      statusContextGeneration === ctxGeneration &&
      activeSessionId === ctxSessionId;

    if (options?.notify && isCurrentCtx && activeCtx?.hasUI) {
      const unknownCount = snapshots.filter((snapshot) => snapshot.status === "unknown").length;
      activeCtx.notify(
        unknownCount > 0 ? `상태 새로고침 완료 (${unknownCount}개 항목 미확인)` : "상태 새로고침 완료",
        unknownCount > 0 ? "warning" : "info",
      );
    }
  })();

  try {
    await store.inFlight;
  } finally {
    store.inFlight = null;
  }
}

function ensurePolling(): void {
  const store = getStore();
  if (store.timer) return;
  store.timer = setInterval(() => {
    void refreshSnapshots();
  }, POLL_TICK_MS);
  store.timer.unref?.();
}
