import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerCommands } from "./commands/index.js";
import { mountConfigBridge } from "./bindings/config/index.js";
import { prepareKeybindBridgeForExtensionLoad } from "./bindings/config/keybind/bridge.js";
import { registerKeybinds } from "./keybinds/index.js";
import { registerLifecycle } from "./bindings/runtime/index.js";
import { registerProvider } from "./provider/index.js";
import { mountTuiSurfaces } from "./tui/index.js";
import { registerTools } from "./tools/index.js";

export default function fleetPiExtension(pi: ExtensionAPI): void {
  prepareKeybindBridgeForExtensionLoad();
  mountConfigBridge(pi);
  const runtime = registerLifecycle(pi);
  registerKeybinds(pi, runtime.fleetEnabled);
  mountTuiSurfaces(pi, runtime.fleetEnabled);
  registerCommands(pi, runtime.fleetEnabled);
  registerTools(pi, runtime.fleetEnabled);
  registerProvider(pi);
}
