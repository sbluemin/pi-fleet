import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { FleetSettingsServices } from "@sbluemin/fleet-core";

import { getKeybindAPI } from "./shell/keybinds/core/bridge.js";
import { getFleetRuntime } from "./fleet.js";
import { SettingsOverlay } from "./shell/overlays/settings-overlay.js";

export interface FleetPushModeSettings {
  deliverAs?: "followUp" | "steer";
}

const SECTION_KEY = "fleet-push-mode";

let activePopup: Promise<void> | null = null;

export function registerSettings(_ctx: ExtensionAPI): void {
  registerSettingsOverlayKeybind();
  registerPushModeSettingsSection();
}

export function loadSettings(): FleetPushModeSettings {
  try {
    return getSettingsServices().settings.load<FleetPushModeSettings>(SECTION_KEY);
  } catch {
    return {};
  }
}

export function saveSettings(settings: FleetPushModeSettings): void {
  getSettingsServices().settings.save(SECTION_KEY, settings);
}

export function getDeliverAs(): "followUp" | "steer" {
  const deliverAs = loadSettings().deliverAs;
  return deliverAs === "steer" ? "steer" : "followUp";
}

export async function setDeliverAs(value: "followUp" | "steer"): Promise<void> {
  saveSettings({ deliverAs: value });
}

function registerSettingsOverlayKeybind(): void {
  const keybind = getKeybindAPI();
  keybind.register({
    extension: "core-settings",
    action: "popup",
    defaultKey: "alt+/",
    description: "설정 오버레이 팝업 표시",
    category: "Core",
    handler: async (ctx) => {
      await openSettingsPopup(ctx);
    },
  });
}

function registerPushModeSettingsSection(): void {
  const settingsApi = getSettingsServicesOrNull()?.settings;
  settingsApi?.registerSection({
    key: SECTION_KEY,
    displayName: "Push Mode",
    getDisplayFields() {
      const deliverAs = getDeliverAs();
      return [
        {
          label: "Deliver As",
          value: deliverAs === "followUp" ? "Follow-up" : "Steer",
          color: deliverAs === "followUp" ? "accent" : "warning",
        },
      ];
    },
  });
}

async function openSettingsPopup(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  if (activePopup) return;

  const sections = getSettingsServicesOrNull()?.settings.getSections() ?? [];

  activePopup = ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) =>
      new SettingsOverlay(theme, sections, done),
    {
      overlay: true,
      overlayOptions: {
        width: "50%",
        maxHeight: "50%",
        anchor: "center",
        margin: 1,
      },
    },
  );

  try {
    await activePopup;
  } finally {
    activePopup = null;
  }
}

function getSettingsServices(): FleetSettingsServices {
  return getFleetRuntime().settings;
}

function getSettingsServicesOrNull(): FleetSettingsServices | null {
  try {
    return getSettingsServices();
  } catch {
    return null;
  }
}
