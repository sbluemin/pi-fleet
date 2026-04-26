import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export interface MemoryCaptureMessage {
  role: string;
  content: string;
}

export interface MemoryCaptureEvent {
  type: string;
  content: string;
}

export interface MemoryCaptureTranscript {
  branchId: string;
  operationSource: string;
  messages: MemoryCaptureMessage[];
  events: MemoryCaptureEvent[];
}

interface MemoryCaptureSourceItem {
  label: string;
  content: string;
}

export function collectCaptureTranscript(ctx: ExtensionContext): MemoryCaptureTranscript | null {
  const sessionEvents = (ctx.sessionManager?.getBranch?.() ?? []) as any[];
  const branchId = getBranchId(ctx);
  const messages: MemoryCaptureMessage[] = [];
  const events: MemoryCaptureEvent[] = [];
  const sourceItems: MemoryCaptureSourceItem[] = [];

  for (const event of sessionEvents) {
    if (event.type === "message") {
      const role = typeof event.message?.role === "string" ? event.message.role : "unknown";
      const content = stringifyMessageContent(event.message?.content);
      if (!content) continue;
      messages.push({ role, content });
      sourceItems.push({ label: role, content });
      continue;
    }

    if (event.type === "tool_call") {
      const content = stringifyToolCall(event);
      if (!content) continue;
      events.push({ type: "tool_call", content });
      sourceItems.push({ label: "tool_call", content });
      continue;
    }

    if (event.type === "tool_result") {
      const content = stringifyToolResult(event);
      if (!content) continue;
      events.push({ type: "tool_result", content });
      sourceItems.push({ label: "tool_result", content });
    }
  }

  if (messages.length === 0 && events.length === 0) {
    return null;
  }

  return {
    branchId,
    operationSource: buildOperationSource(branchId, sourceItems),
    messages,
    events,
  };
}

function getBranchId(ctx: ExtensionContext): string {
  const sessionId = ctx.sessionManager?.getSessionId?.();
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId.trim() : "current-session";
}

function buildOperationSource(branchId: string, sourceItems: MemoryCaptureSourceItem[]): string {
  const lines: string[] = [`Branch: ${branchId}`];

  for (const item of sourceItems.slice(-24)) {
    lines.push(`[${item.label}] ${truncateLine(item.content, 600)}`);
  }

  return lines.join("\n");
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const chunks = content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if ("type" in item && (item as { type?: unknown }).type === "text") {
        return typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
      }
      return "";
    })
    .filter((value) => value.trim().length > 0);

  return chunks.join("\n").trim();
}

function stringifyToolCall(event: any): string {
  const name = typeof event.name === "string"
    ? event.name
    : typeof event.toolName === "string"
      ? event.toolName
      : typeof event.tool?.name === "string"
        ? event.tool.name
        : "unknown-tool";
  const args = event.args ?? event.input ?? event.parameters;
  const renderedArgs = safeStringify(args);
  return renderedArgs ? `${name} ${renderedArgs}` : name;
}

function stringifyToolResult(event: any): string {
  const name = typeof event.name === "string"
    ? event.name
    : typeof event.toolName === "string"
      ? event.toolName
      : "tool_result";
  const payload = event.result ?? event.output ?? event.content;
  const renderedPayload = safeStringify(payload);
  return renderedPayload ? `${name} ${renderedPayload}` : name;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateLine(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}
