import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { runDryDock } from "./drydock.js";
import { approvePatch, listQueue, rejectPatch, showQueue } from "./patch.js";
import { ensureMemoryRoot, resolveMemoryPaths } from "./paths.js";
import { loadIndex } from "./store.js";

export function registerMemoryCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:memory:status", {
    description: "Fleet Memory 저장소 상태 확인 및 필요 시 초기화",
    handler: async (_args, ctx) => {
      const paths = resolveMemoryPaths(ctx.cwd);
      await ensureMemoryRoot(paths);
      const index = await loadIndex(paths);
      ctx.ui.notify(`Fleet Memory ready: ${Object.keys(index).length} wiki entries`, "info");
    },
  });

  pi.registerCommand("fleet:memory:queue", {
    description: "Fleet Memory patch queue 목록 표시",
    handler: async (_args, ctx) => {
      const items = await listQueue(resolveMemoryPaths(ctx.cwd));
      ctx.ui.notify(`Queue items: ${items.length}`, "info");
    },
  });

  pi.registerCommand("fleet:memory:show", {
    description: "Fleet Memory patch queue 항목 조회",
    handler: async (args, ctx) => {
      const item = await showQueue(args.trim(), resolveMemoryPaths(ctx.cwd));
      ctx.ui.notify(`Patch ${item.meta.id}: ${item.meta.status}`, "info");
    },
  });

  pi.registerCommand("fleet:memory:approve", {
    description: "Fleet Memory patch 승인",
    handler: async (args, ctx) => {
      const meta = await approvePatch(args.trim(), resolveMemoryPaths(ctx.cwd));
      ctx.ui.notify(`Approved ${meta.id}`, "info");
    },
  });

  pi.registerCommand("fleet:memory:reject", {
    description: "Fleet Memory patch 반려",
    handler: async (args, ctx) => {
      const [id, ...reasonParts] = args.trim().split(/\s+/);
      const meta = await rejectPatch(id, reasonParts.join(" ") || "rejected", resolveMemoryPaths(ctx.cwd));
      ctx.ui.notify(`Rejected ${meta.id}`, "info");
    },
  });

  pi.registerCommand("fleet:memory:drydock", {
    description: "Fleet Memory 정적 점검 실행",
    handler: async (_args, ctx) => {
      const report = await runDryDock(resolveMemoryPaths(ctx.cwd));
      ctx.ui.notify(`Drydock: ${report.ok ? "OK" : `${report.issues.length} issues`}`, report.ok ? "info" : "warning");
    },
  });
}
