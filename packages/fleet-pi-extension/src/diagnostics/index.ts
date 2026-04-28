import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { buildDummyArithToolConfig } from "./dummy-arith/tool.js";

export default function registerDiagnostics(pi: ExtensionAPI) {
  if (process.env.PI_DIAGNOSTICS_ENABLED !== "1") {
    return;
  }

  pi.registerTool(buildDummyArithToolConfig() as any);
}
