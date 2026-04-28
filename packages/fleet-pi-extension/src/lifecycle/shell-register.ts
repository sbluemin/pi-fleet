/**
 * core-shell — 확장 진입점
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createPopupBridge, createPopupController } from "../tui/shell/launcher.js";
import { SHELL_POPUP_BRIDGE_KEY } from "../tui/shell/types.js";

export default function interactiveShellExtension(pi: ExtensionAPI) {
  const controller = createPopupController();
  const bridge = createPopupBridge(controller);

  const registerBridge = () => {
    (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] = bridge;
  };

  pi.on("session_start", (_event, ctx) => {
    controller.setContext(ctx);
    registerBridge();
  });

  pi.on("session_shutdown", () => {
    const current = (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY];
    if (current === bridge) {
      delete (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY];
    }
  });

  registerBridge();
}
