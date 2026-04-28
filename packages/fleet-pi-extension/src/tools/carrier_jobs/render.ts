import { visibleWidth } from "@mariozechner/pi-tui";

import type { CarrierJobRecord, CarrierJobSummary } from "@sbluemin/fleet-core/job";
import type { CarrierJobsParams } from "@sbluemin/fleet-core/carrier-jobs";

interface CarrierJobsRenderResponse {
  action?: string;
  job_id?: string;
  status?: string;
  active?: CarrierJobRecord[];
  recent?: CarrierJobSummary[];
  summary?: CarrierJobSummary;
  full_result?: string;
  cancelled?: boolean;
  error?: string;
}

interface CarrierJobsToolResult {
  content?: Array<{ type: "text"; text: string }>;
  details?: unknown;
}

const ICON = "◈";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

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

function formatQuietCall(args: CarrierJobsParams): string {
  const action = args.format === "full" && args.action === "result" ? "result:full" : args.action;
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
  if (response.action === "result" && response.full_result) {
    return `${DIM}${ICON} Carrier Jobs · result:full · ${shortenJobId(response.job_id)} · ${formatKb(response.full_result)}${RESET}`;
  }
  if (response.action === "result") {
    const elapsed = response.summary?.finishedAt && response.summary.startedAt
      ? formatElapsed(response.summary.finishedAt - response.summary.startedAt)
      : "pending";
    const status = response.summary?.status ?? response.status ?? (response.error ? "error" : "unknown");
    return `${DIM}${ICON} Carrier Jobs · result · ${shortenJobId(response.job_id)} · ${status} · ${elapsed}${RESET}`;
  }
  return `${DIM}${ICON} Carrier Jobs · ${response.action ?? "unknown"}${RESET}`;
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

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}
