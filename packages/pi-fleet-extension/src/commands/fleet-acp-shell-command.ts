import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../keybinds/core/bridge.js";
import { launchBridgeShell } from "../tui/acp-shell/handler.js";
import {
  BRIDGE_ACTION_ID,
  BRIDGE_COMMAND_ID,
  BRIDGE_DEFAULT_KEY,
  BRIDGE_EXTENSION_ID,
  BRIDGE_KEYBIND_CATEGORY,
} from "../tui/acp-shell/types.js";

export function bootBridge(pi: ExtensionAPI): void {
  registerBridgeCommand(pi);
  ensureBridgeKeybinds();
}

export function ensureBridgeKeybinds(): void {
  registerBridgeKeybind();
}

function registerBridgeCommand(pi: ExtensionAPI): void {
  pi.registerCommand(BRIDGE_COMMAND_ID, {
    description: "활성 ACP Model Provider를 오버레이 쉘로 실행",
    handler: async (_args, ctx) => {
      await launchBridgeShell(ctx);
    },
  });
}

function registerBridgeKeybind(): void {
  const keybind = getKeybindAPI();
  keybind.register({
    extension: BRIDGE_EXTENSION_ID,
    action: BRIDGE_ACTION_ID,
    defaultKey: BRIDGE_DEFAULT_KEY,
    description: "활성 ACP Model Provider bridge 실행",
    category: BRIDGE_KEYBIND_CATEGORY,
    handler: async (ctx) => {
      await launchBridgeShell(ctx);
    },
  });
}
