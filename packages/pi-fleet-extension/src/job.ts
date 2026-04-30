import type { ExtensionAPI, MessageRenderer } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

import type { CarrierJobsParams } from "@sbluemin/fleet-core/carrier-jobs";
import type { CarrierJobRecord, CarrierJobSummary } from "@sbluemin/fleet-core/job";
import { configureJobSummaryCache, detachJobArchive } from "@sbluemin/fleet-core/job";

interface CarrierJobsRenderContext {
  readonly lastComponent?: unknown;
}

interface CarrierJobsRenderResponse {
  action?: string;
  format?: "summary" | "full";
  job_id?: string;
  status?: string;
  active?: CarrierJobRecord[];
  recent?: CarrierJobSummary[];
  summary?: CarrierJobSummary;
  full_result?: string;
  cancelled?: boolean;
  error?: string;
}

export interface CarrierResultMessageDetails {
  jobIds: string[];
  summaries: string[];
}

export interface CarrierJobsToolResult {
  content?: Array<{ type: "text"; text: string }>;
  details?: unknown;
}

interface CarrierJobsVerboseState {
  value: boolean;
  callbacks: Array<(value: boolean) => void>;
}

const CARRIER_JOBS_VERBOSE_KEY = "__pi_fleet_carrier_jobs_verbose__";
const ICON = "◈";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export const CARRIER_RESULT_CUSTOM_TYPE = "carrier-result";

export const carrierResultRenderer: MessageRenderer<CarrierResultMessageDetails> = () => undefined;

export function registerJob(ctx: ExtensionAPI): void {
  configureJobSummaryCache(50, detachJobArchive);
  ctx.registerMessageRenderer(CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer);
}

export function renderCarrierJobsCall(args: unknown, context: CarrierJobsRenderContext | undefined): CarrierJobsCallComponent | CarrierJobsVerboseCallComponent {
  const typedArgs = args as CarrierJobsParams;
  if (getCarrierJobsVerbose()) {
    const component = context?.lastComponent instanceof CarrierJobsVerboseCallComponent
      ? context.lastComponent
      : new CarrierJobsVerboseCallComponent();
    component.setState(typedArgs);
    return component;
  }
  const component = context?.lastComponent instanceof CarrierJobsCallComponent
    ? context.lastComponent
    : new CarrierJobsCallComponent();
  component.setState(typedArgs);
  return component;
}

export function renderCarrierJobsResult(result: CarrierJobsToolResult): ReturnType<typeof renderQuietResult> | ReturnType<typeof renderVerboseResult> {
  return getCarrierJobsVerbose() ? renderVerboseResult(result) : renderQuietResult(result);
}

export class CarrierJobsCallComponent {
  private args: CarrierJobsParams = { action: "list" };

  setState(args: CarrierJobsParams): void {
    this.args = args;
  }

  render(): string[] {
    return [formatQuietCall(this.args)];
  }

  invalidate(): void {}
}

export class CarrierJobsVerboseCallComponent {
  private args: CarrierJobsParams = { action: "list" };

  setState(args: CarrierJobsParams): void {
    this.args = args;
  }

  render(width = process.stdout.columns ?? 120): string[] {
    return formatJsonLines(this.args, width);
  }

  invalidate(): void {}
}

export function renderQuietResult(_result: CarrierJobsToolResult): { render(): string[]; invalidate(): void } {
  return { render() { return []; }, invalidate() {} };
}

export function renderVerboseResult(result: CarrierJobsToolResult): { render(): string[]; invalidate(): void } {
  return {
    render(width = process.stdout.columns ?? 120) {
      return formatJsonLines(parseResultPayload(result) ?? result, width);
    },
    invalidate() {},
  };
}

export function formatQuietResult(result: CarrierJobsToolResult): string {
  return formatQuietResponse(parseResultPayload(result));
}

export function shortenJobId(jobId: string | undefined): string {
  if (!jobId) return "(none)";
  const separator = jobId.indexOf(":");
  if (separator === -1) return jobId.length <= 14 ? jobId : `…${jobId.slice(-6)}`;
  const prefix = jobId.slice(0, separator + 1);
  const rest = jobId.slice(separator + 1);
  if (rest.length <= 12) return jobId;
  return `${prefix}…${rest.slice(-6)}`;
}

export function getCarrierJobsVerbose(): boolean {
  return getState().value;
}

export function setCarrierJobsVerbose(value: boolean): void {
  const state = getState();
  if (state.value === value) return;
  state.value = value;
  notifyCarrierJobsVerboseChange(state);
}

export function toggleCarrierJobsVerbose(): boolean {
  const next = !getCarrierJobsVerbose();
  setCarrierJobsVerbose(next);
  return next;
}

export function onCarrierJobsVerboseChange(callback: (value: boolean) => void): () => void {
  const state = getState();
  state.callbacks.push(callback);
  return () => {
    const index = state.callbacks.indexOf(callback);
    if (index >= 0) state.callbacks.splice(index, 1);
  };
}

export function resetCarrierJobsVerboseForTest(): void {
  const state = getState();
  state.value = false;
  state.callbacks = [];
}

function formatQuietCall(args: CarrierJobsParams): string {
  const action = args.format ? `${args.action}:${args.format}` : args.action;
  const job = args.action === "list" ? "" : ` · ${shortenJobId(args.job_id)}`;
  return `${DIM}${ICON} Carrier Jobs · ${action}${job}${RESET}`;
}

function formatQuietResponse(response: CarrierJobsRenderResponse | null): string {
  if (!response) return `${DIM}${ICON} Carrier Jobs · result · unavailable${RESET}`;
  if (response.action === "list") {
    return `${DIM}${ICON} Carrier Jobs · list · ${response.active?.length ?? 0} active, ${response.recent?.length ?? 0} recent${RESET}`;
  }
  if (response.action === "status") {
    return `${DIM}${ICON} Carrier Jobs · status · ${shortenJobId(response.job_id)} · ${response.status ?? "unknown"}${RESET}`;
  }
  if (response.action === "cancel") {
    return `${DIM}${ICON} Carrier Jobs · cancel · ${shortenJobId(response.job_id)} · ${response.cancelled ? "cancelled" : "failed"}${RESET}`;
  }
  if (response.action === "result") {
    if (response.full_result) {
      return `${DIM}${ICON} Carrier Jobs · ${formatResultAction(response)} · ${shortenJobId(response.job_id)} · ${formatKb(response.full_result)}${RESET}`;
    }
    const status = response.status ?? (response.error ? "error" : "unknown");
    return `${DIM}${ICON} Carrier Jobs · ${formatResultAction(response)} · ${shortenJobId(response.job_id)} · ${status}${RESET}`;
  }
  return `${DIM}${ICON} Carrier Jobs · ${response.action ?? "unknown"}${RESET}`;
}

function formatResultAction(response: CarrierJobsRenderResponse): string {
  if (response.format) return `result:${response.format}`;
  return response.full_result ? "result:full" : "result";
}

function parseResultPayload(result: CarrierJobsToolResult): CarrierJobsRenderResponse | null {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as CarrierJobsRenderResponse;
  } catch {
    return null;
  }
}

function formatJsonLines(value: unknown, width = process.stdout.columns ?? 120): string[] {
  const safeWidth = Math.max(20, width);
  return JSON.stringify(value, null, 2)
    .split("\n")
    .flatMap((line) => wrapLine(line, safeWidth))
    .map((line) => `${DIM}${line}${RESET}`);
}

function wrapLine(line: string, width: number): string[] {
  if (visibleWidth(line) <= width) return [line];
  const lines: string[] = [];
  let chunk = "";
  let chunkWidth = 0;
  for (const char of line) {
    const charWidth = visibleWidth(char);
    if (chunk && chunkWidth + charWidth > width) {
      lines.push(chunk);
      chunk = char;
      chunkWidth = charWidth;
      continue;
    }
    chunk += char;
    chunkWidth += charWidth;
  }
  if (chunk) lines.push(chunk);
  return lines;
}

function formatKb(value: string): string {
  return `${Math.max(1, Math.ceil(Buffer.byteLength(value, "utf8") / 1024))}KB`;
}

function notifyCarrierJobsVerboseChange(state: CarrierJobsVerboseState): void {
  for (const callback of state.callbacks) {
    try { callback(state.value); } catch { /* 리스너 실패는 렌더 상태 전파를 막지 않습니다. */ }
  }
}

function getState(): CarrierJobsVerboseState {
  const root = globalThis as Record<string, unknown>;
  const existing = root[CARRIER_JOBS_VERBOSE_KEY] as CarrierJobsVerboseState | undefined;
  if (existing) return existing;
  const state: CarrierJobsVerboseState = { value: false, callbacks: [] };
  root[CARRIER_JOBS_VERBOSE_KEY] = state;
  return state;
}
