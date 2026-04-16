import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../../core/keybind/bridge.js";
import { launchBridgeShell } from "./handler.js";
import {
  BRIDGE_ACTION_ID,
  BRIDGE_COMMAND_ID,
  BRIDGE_DEFAULT_KEY,
  BRIDGE_EXTENSION_ID,
  BRIDGE_KEYBIND_CATEGORY,
} from "./types.js";

interface BridgeBootApi {
  onSessionStart(ctx: ExtensionContext): void;
}

export function bootBridge(pi: ExtensionAPI): BridgeBootApi {
  registerBridgeCommand(pi);
  registerBridgeKeybind();

  return {
    onSessionStart(_ctx: ExtensionContext) {
      registerBridgeKeybind();
    },
  };
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
