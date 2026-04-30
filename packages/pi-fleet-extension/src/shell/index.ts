import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerHudCommand from "./commands/hud-command.js";
import registerKeybindPopupCommand from "./commands/keybind-command.js";
import registerWelcomeUpdateCommand from "./commands/welcome-update.js";
import { prepareKeybindBridgeForExtensionLoad } from "./keybinds/core/bridge.js";
import registerCoreKeybinds, { reregisterCoreKeybinds } from "./keybinds/core-keybind-register.js";
import registerHudLifecycle from "./hud-lifecycle.js";
import registerShellLifecycle from "./tui/shell/register.js";
import registerWelcome from "./welcome/register.js";

export function registerShell(ctx: ExtensionAPI): void {
  prepareKeybindBridgeForExtensionLoad();
  ctx.on("session_start", (event) => {
    if (event.reason === "startup") return;
    reregisterCoreKeybinds(ctx);
  });
  registerHudLifecycle(ctx);
  registerShellLifecycle(ctx);
  registerCoreKeybinds(ctx);
  registerWelcome(ctx);
  registerHudCommand(ctx);
  registerKeybindPopupCommand(ctx);
  registerWelcomeUpdateCommand(ctx);
}
