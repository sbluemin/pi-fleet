import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { collectCaptureSession } from "./capture.js";
import { runDryDock } from "./drydock.js";
import { approvePatch, listQueue, rejectPatch, resolveQueueSelection, showQueue } from "./patch.js";
import { ensureMemoryRoot, resolveMemoryPaths } from "./paths.js";
import { buildMemoryCaptureDirective } from "./prompts.js";
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
      if (items.length === 0) {
        ctx.ui.notify("Queue is empty. Use Fleet Memory capture staging to create a pending patch.", "info");
        return;
      }
      const ids = items.map((item) => item.id).join(", ");
      ctx.ui.notify(`Queue items (${items.length}): ${ids}. Next: /fleet:memory:show <patch_id>`, "info");
    },
  });

  pi.registerCommand("fleet:memory:show", {
    description: "Fleet Memory patch queue 항목 조회",
    handler: async (args, ctx) => {
      try {
        const paths = resolveMemoryPaths(ctx.cwd);
        const selection = await resolveQueueSelection(args.trim(), paths);
        const item = await showQueue(selection.id, paths);
        const autoSelected = selection.autoSelected ? " (auto-selected sole queue item)" : "";
        ctx.ui.notify(`Patch ${item.meta.id}: ${item.meta.status}${autoSelected}`, "info");
      } catch (error) {
        if (isExpectedQueueError(error)) {
          ctx.ui.notify(error.message, "warning");
          return;
        }
        throw error;
      }
    },
  });

  pi.registerCommand("fleet:memory:approve", {
    description: "Fleet Memory patch 승인",
    handler: async (args, ctx) => {
      const patchId = args.trim();
      if (!patchId) {
        const items = await listQueue(resolveMemoryPaths(ctx.cwd));
        const suffix = items.length > 0 ? ` Available patch IDs: ${items.map((item) => item.id).join(", ")}` : " Queue is empty.";
        ctx.ui.notify(`/fleet:memory:approve <patch_id> is required.${suffix}`, "warning");
        return;
      }
      try {
        const meta = await approvePatch(patchId, resolveMemoryPaths(ctx.cwd));
        ctx.ui.notify(`Approved ${meta.id}`, "info");
      } catch (error) {
        if (isExpectedQueueError(error)) {
          ctx.ui.notify(error.message, "warning");
          return;
        }
        throw error;
      }
    },
  });

  pi.registerCommand("fleet:memory:reject", {
    description: "Fleet Memory patch 반려",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      if (!trimmed) {
        const items = await listQueue(resolveMemoryPaths(ctx.cwd));
        const suffix = items.length > 0 ? ` Available patch IDs: ${items.map((item) => item.id).join(", ")}` : " Queue is empty.";
        ctx.ui.notify(`/fleet:memory:reject <patch_id> [reason] is required.${suffix}`, "warning");
        return;
      }
      const [id, ...reasonParts] = trimmed.split(/\s+/);
      try {
        const meta = await rejectPatch(id, reasonParts.join(" ") || "rejected", resolveMemoryPaths(ctx.cwd));
        ctx.ui.notify(`Rejected ${meta.id}`, "info");
      } catch (error) {
        if (isExpectedQueueError(error)) {
          ctx.ui.notify(error.message, "warning");
          return;
        }
        throw error;
      }
    },
  });

  pi.registerCommand("fleet:memory:drydock", {
    description: "Fleet Memory 정적 점검 실행",
    handler: async (_args, ctx) => {
      const report = await runDryDock(resolveMemoryPaths(ctx.cwd));
      ctx.ui.notify(`Drydock: ${report.ok ? "OK" : `${report.issues.length} issues`}`, report.ok ? "info" : "warning");
    },
  });

  pi.registerCommand("fleet:memory:capture", {
    description: "현재 세션 이력에서 Fleet Memory 캡처 staging 또는 preview 후속 흐름 시작",
    handler: async (_args, ctx) => {
      const session = collectCaptureSession(ctx);
      if (!session) {
        ctx.ui.notify("현재 세션에서 캡처할 대화/작업 이력이 없어 Fleet Memory preview를 시작할 수 없습니다.", "warning");
        return;
      }

      const choice = await ctx.ui.select("Fleet Memory capture:", [
        "의미 있는 지식 staging",
        "프리뷰 캡처 계획",
        "AAR 전용 프리뷰",
        "취소",
      ]);

      if (choice === undefined || choice === "취소") {
        ctx.ui.notify("Fleet Memory capture가 취소되었습니다.", "warning");
        return;
      }

      const directive = buildMemoryCaptureDirective({
        mode: choice === "의미 있는 지식 staging"
          ? "stage"
          : choice === "AAR 전용 프리뷰"
            ? "aar_only"
            : "preview",
        session,
      });

      if (typeof pi.sendUserMessage !== "function") {
        throw new Error("fleet:memory:capture requires PI sendUserMessage support");
      }

      pi.sendUserMessage(directive, { deliverAs: "followUp" });
      ctx.ui.notify(
        choice === "의미 있는 지식 staging"
          ? "Fleet Memory capture staging 지시를 Admiral 후속 턴에 전달했습니다."
          : "Fleet Memory capture preview를 Admiral 후속 지시로 전달했습니다.",
        "info",
      );
    },
  });
}

function isExpectedQueueError(error: unknown): error is Error {
  return error instanceof Error &&
    (error.message.includes("Patch ID is required") ||
      error.message.includes("Unknown patch ID") ||
      error.message.includes("Queue is empty"));
}
