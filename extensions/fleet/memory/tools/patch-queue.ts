import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { approvePatch, listQueue, rejectPatch, resolveQueueSelection, showQueue } from "../patch.js";
import { resolveMemoryPaths } from "../paths.js";
import {
  MEMORY_PATCH_QUEUE_DESCRIPTION,
  MEMORY_PATCH_QUEUE_MANIFEST,
  buildMemoryPatchQueueSchema,
} from "../prompts.js";

export function buildPatchQueueToolConfig() {
  registerToolPromptManifest(MEMORY_PATCH_QUEUE_MANIFEST);

  return {
    name: "memory_patch_queue",
    label: "Memory Patch Queue",
    description: MEMORY_PATCH_QUEUE_DESCRIPTION,
    promptSnippet: MEMORY_PATCH_QUEUE_MANIFEST.promptSnippet,
    promptGuidelines: [...MEMORY_PATCH_QUEUE_MANIFEST.usageGuidelines],
    parameters: buildMemoryPatchQueueSchema(),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const paths = resolveMemoryPaths(ctx.cwd);
      const action = String(params.action ?? "list");

      if (action === "list") {
        const items = await listQueue(paths);
        return textResult({
          ok: true,
          action,
          items,
          next_action: items.length > 0 ? `Use patch_id from: ${items.map((item) => item.id).join(", ")}` : "Queue is empty.",
        });
      }
      if (action === "show") {
        const selection = await resolveQueueSelection(String(params.patch_id ?? ""), paths);
        return textResult({ ok: true, action, item: await showQueue(selection.id, paths), auto_selected: selection.autoSelected });
      }
      if (action === "approve") {
        const patchId = String(params.patch_id ?? "").trim();
        if (!patchId) {
          throw new Error(buildMissingPatchIdError("approve", await listQueue(paths)));
        }
        return textResult({ ok: true, action, meta: await approvePatch(patchId, paths) });
      }
      if (action === "reject") {
        const patchId = String(params.patch_id ?? "").trim();
        if (!patchId) {
          throw new Error(buildMissingPatchIdError("reject", await listQueue(paths)));
        }
        return textResult({
          ok: true,
          action,
          meta: await rejectPatch(patchId, String(params.reason ?? "rejected"), paths),
        });
      }
      return textResult({ ok: false, action, error: "unsupported action" });
    },
  };
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: {},
  };
}

function buildMissingPatchIdError(action: "approve" | "reject", items: Array<{ id: string }>): string {
  if (items.length === 0) {
    return `memory_patch_queue ${action} requires patch_id. Queue is empty.`;
  }
  return `memory_patch_queue ${action} requires patch_id. Available patch IDs: ${items.map((item) => item.id).join(", ")}`;
}
