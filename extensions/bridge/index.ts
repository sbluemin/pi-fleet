import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../core/keybind/bridge.js";
import { launchBridgeShell } from "./handler.js";
import {
  BRIDGE_ACTION_ID,
  BRIDGE_COMMAND_ID,
  BRIDGE_DEFAULT_KEY,
  BRIDGE_EXTENSION_ID,
  BRIDGE_KEYBIND_CATEGORY,
} from "./types.js";

export default function registerBridgeExtension(pi: ExtensionAPI): void {
  registerBridgeKeybind();

  pi.registerCommand(BRIDGE_COMMAND_ID, {
    description: "활성 ACP Model Provider를 오버레이 쉘로 실행",
    handler: async (_args, ctx) => {
      await launchBridgeShell(ctx);
    },
  });

  pi.on("session_start", () => {
    registerBridgeKeybind();
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
