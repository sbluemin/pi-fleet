import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { approvePatch, listQueue, rejectPatch, showQueue } from "../patch.js";
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
        return textResult({ ok: true, action, items: await listQueue(paths) });
      }
      if (action === "show") {
        return textResult({ ok: true, action, item: await showQueue(String(params.patch_id ?? ""), paths) });
      }
      if (action === "approve") {
        return textResult({ ok: true, action, meta: await approvePatch(String(params.patch_id ?? ""), paths) });
      }
      if (action === "reject") {
        return textResult({
          ok: true,
          action,
          meta: await rejectPatch(String(params.patch_id ?? ""), String(params.reason ?? "rejected"), paths),
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
