import { registerToolPromptManifest } from "../../admiral/tool-prompt-manifest/index.js";
import { runDryDock } from "../drydock.js";
import { resolveMemoryPaths } from "../paths.js";
import {
  MEMORY_DRYDOCK_DESCRIPTION,
  MEMORY_DRYDOCK_MANIFEST,
  buildMemoryDryDockSchema,
} from "../prompts.js";

export function buildDryDockToolConfig() {
  registerToolPromptManifest(MEMORY_DRYDOCK_MANIFEST);

  return {
    name: "memory_drydock",
    label: "Memory Drydock",
    description: MEMORY_DRYDOCK_DESCRIPTION,
    promptSnippet: MEMORY_DRYDOCK_MANIFEST.promptSnippet,
    promptGuidelines: [...MEMORY_DRYDOCK_MANIFEST.usageGuidelines],
    parameters: buildMemoryDryDockSchema(),
    async execute(
      _id: string,
      _params: Record<string, unknown>,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: { cwd: string },
    ) {
      const report = await runDryDock(resolveMemoryPaths(ctx.cwd));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
        details: {},
      };
    },
  };
}
