import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export function persistDirectChatIfEmpty(ctx: ExtensionContext): void {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;

  const entries = ctx.sessionManager.getEntries();
  const hasDirectChat = entries.some((e) => e.type === "custom_message");
  if (!hasDirectChat) return;

  const hasAssistant = entries.some(
    (e) => e.type === "message" && (e as any).message?.role === "assistant",
  );
  if (hasAssistant) return;

  const header = ctx.sessionManager.getHeader();
  if (!header) return;

  const dir = path.dirname(sessionFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = JSON.stringify(header) + "\n";
  for (const entry of entries) {
    content += JSON.stringify(entry) + "\n";
  }
  writeFileSync(sessionFile, content);
}
