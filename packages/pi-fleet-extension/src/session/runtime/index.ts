import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import {
  buildRuntimeContextPrompt,
  getActiveProtocol,
  getAllProtocols,
  setActiveProtocol,
} from "@sbluemin/fleet-core/admiral";
import { setCliRuntimeContext } from "@sbluemin/fleet-core/agent/provider-types";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";
import registerGrandFleet from "../grand-fleet/register.js";
import { getKeybindAPI } from "../../keybinds/core/bridge.js";
import {
  getFleetRuntime,
  initializeFleetRuntime,
  resolveFleetDataDir,
  restoreFleetPreRegistrationState,
  shouldBootFleet,
} from "./fleet-boot.js";
import { registerFleetCarriers } from "./fleet-carriers.js";
import { scheduleFleetBootReconciliation } from "./fleet-boot-reconciliation.js";
import registerBoot from "./boot/index.js";
import registerKeybindLifecycle from "./core-keybind-lifecycle.js";
import registerLogLifecycle from "./core-log-lifecycle.js";
import registerHudLifecycle from "../../tui/hud-lifecycle.js";
import { wireFleetPiEvents } from "./fleet-pi-events.js";
import registerShellLifecycle from "../../tui/shell/register.js";
import { updateProtocolWidget } from "../../tui/admiral/widget.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../tui/hud/border-bridge.js";
import registerRequestDirective from "../../tools/admiral/request-directive.js";

export interface FleetLifecycleRuntime {
  fleetEnabled: boolean;
}

export function registerLifecycle(pi: ExtensionAPI): FleetLifecycleRuntime {
  registerBoot(pi);
  registerKeybindLifecycle(pi);
  registerHudLifecycle(pi);
  registerShellLifecycle(pi);

  if (!shouldBootFleet()) {
    registerGrandFleet(pi);
    return { fleetEnabled: false };
  }

  const dataDir = resolveFleetDataDir();
  initializeFleetRuntime(dataDir);
  restoreFleetPreRegistrationState();
  registerLogLifecycle(pi);

  bootAdmiral(pi);
  registerFleetCarriers(pi);
  scheduleFleetBootReconciliation();
  wireFleetPiEvents(pi);
  registerGrandFleet(pi);

  return { fleetEnabled: true };
}

function bootAdmiral(pi: ExtensionAPI): void {
  const bootProtocol = getActiveProtocol();
  syncProtocolToHud(bootProtocol);
  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds();
}

function registerProtocolKeybinds(): void {
  const keybind = getKeybindAPI();

  for (const protocol of getAllProtocols()) {
    keybind.register({
      extension: "admiral",
      action: `protocol:${protocol.id}`,
      defaultKey: `alt+${protocol.slot}`,
      description: `프로토콜 전환: ${protocol.name}`,
      category: "Admiral Protocol",
      handler: (ctx: any) => {
        const current = getActiveProtocol();
        if (current.id === protocol.id) {
          return;
        }
        setActiveProtocol(protocol.id);
        syncProtocolToHud(protocol);
        setCliRuntimeContext(buildRuntimeContextPrompt);
        ctx.ui.notify(`Protocol → ${protocol.name}`, "info");
        updateProtocolWidget(ctx);
      },
    });
  }
}

function syncProtocolToHud(protocol: { color: string; shortLabel: string }): void {
  setEditorBorderColor(protocol.color);
  setEditorRightLabel(`${protocol.color}⚓ ${protocol.shortLabel}\x1b[0m`);
}

function registerAdmiralSettingsSection(): void {
  const settingsApi = getFleetRuntime().settings.settings;
  settingsApi?.registerSection({
    key: "admiral",
    displayName: "Admiral",
    getDisplayFields() {
      const enabled = isWorldviewEnabled();
      const activeProtocol = getActiveProtocol();
      return [
        { label: "Worldview", value: enabled ? "ON" : "OFF", color: enabled ? "accent" : "dim" },
        { label: "Protocol", value: activeProtocol.shortLabel, color: "accent" },
      ];
    },
  });
}
