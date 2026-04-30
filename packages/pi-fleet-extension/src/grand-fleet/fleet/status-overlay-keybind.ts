import { getKeybindAPI } from "../../shell/keybinds/core/bridge.js";
import { openFleetStatusOverlay } from "./status-overlay.js";

let activeStatusPopup: Promise<void> | null = null;

export function registerFleetStatusOverlayKeybind(): void {
  const keybind = getKeybindAPI();
  keybind.register({
    extension: "grand-fleet",
    action: "status-overlay",
    defaultKey: "alt+g",
    description: "Grand Fleet Status 오버레이",
    category: "Grand Fleet",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      if (activeStatusPopup) return;

      activeStatusPopup = openFleetStatusOverlay(ctx);

      try {
        await activeStatusPopup;
      } finally {
        activeStatusPopup = null;
      }
    },
  });
}
