/**
 * core-shell — 확장 진입점
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { isShellPopupOpen, openShellPopup, setShellPopupContext } from "./launcher.js";
import { SHELL_POPUP_BRIDGE_KEY } from "./types.js";

export default function interactiveShellExtension(pi: ExtensionAPI) {
  const service = {
    open: openShellPopup,
    isOpen: isShellPopupOpen,
  };

  const registerBridge = () => {
    (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] = service;
  };

  pi.on("session_start", (_event, ctx) => {
    setShellPopupContext(ctx);
    registerBridge();
  });

  pi.on("session_shutdown", () => {
    const current = (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY];
    if (current === service) {
      delete (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY];
    }
  });

  registerBridge();
}
