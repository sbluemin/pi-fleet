import { getKeybindAPI } from "../../core/keybind/bridge.js";
import { openAdmiraltyStatusOverlay } from "./status-overlay.js";

let activeStatusPopup: Promise<void> | null = null;

export function registerAdmiraltyStatusOverlayKeybind(): void {
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

      activeStatusPopup = openAdmiraltyStatusOverlay(ctx);

      try {
        await activeStatusPopup;
      } finally {
        activeStatusPopup = null;
      }
    },
  });
}
