import { getOperationNameSystemPrompt } from "./prompts.js";

export interface OperationNameComposeRequest {
  readonly worldviewEnabled: boolean;
  readonly preparedPrompt: string;
}

export interface OperationNameComposeResult {
  readonly systemPrompt: string;
  readonly messages: readonly [{ readonly role: "user"; readonly content: string }];
}

const OPERATION_PREFIX = "Operation › ";
const MAX_DISPLAY_CHARS = 40;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;
const BIDI_PATTERN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const SECRET_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[0-9A-Za-z-]+|Bearer\s+[A-Za-z0-9._~+/=-]{24,}|[A-Za-z0-9_-]{32,})\b/g;

export function composeOperationNameRequest(request: OperationNameComposeRequest): OperationNameComposeResult {
  return {
    systemPrompt: getOperationNameSystemPrompt(request.worldviewEnabled),
    messages: [{ role: "user", content: request.preparedPrompt }],
  };
}

export function sanitizeOperationNameDisplay(raw: string, worldviewEnabled: boolean): string | null {
  const cleaned = raw
    .replace(ANSI_PATTERN, "")
    .replace(BIDI_PATTERN, "")
    .replace(CONTROL_PATTERN, " ")
    .replace(SECRET_PATTERN, "[redacted]")
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  if (!cleaned) return null;

  const withoutPrefix = cleaned.startsWith(OPERATION_PREFIX)
    ? cleaned.slice(OPERATION_PREFIX.length).trim()
    : cleaned;
  const display = worldviewEnabled ? `${OPERATION_PREFIX}${withoutPrefix}` : withoutPrefix;

  return truncateDisplay(display, MAX_DISPLAY_CHARS);
}

function truncateDisplay(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join("").trim();
}
