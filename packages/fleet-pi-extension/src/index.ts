import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerCommands } from "./commands/index.js";
import { mountConfigBridge } from "./config-bridge/index.js";
import { registerKeybinds } from "./keybinds/index.js";
import { registerLifecycle } from "./lifecycle/index.js";
import { mountSessionBridge } from "./session-bridge/index.js";
import { mountTuiSurfaces } from "./tui/index.js";
import { registerTools } from "./tools/index.js";

export default function fleetPiExtension(pi: ExtensionAPI): void {
  mountConfigBridge(pi);
  const runtime = registerLifecycle(pi);
  registerKeybinds(pi, runtime.fleetEnabled);
  mountTuiSurfaces(pi, runtime.fleetEnabled);
  registerCommands(pi, runtime.fleetEnabled);
  registerTools(pi, runtime.fleetEnabled);
  mountSessionBridge(pi);
}
