import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  buildRuntimeContextPrompt,
  buildSystemPrompt,
  getActiveProtocol,
  getAllProtocols,
  setActiveProtocol,
} from "@sbluemin/fleet-core/admiral";

import { setCliRuntimeContext } from "@sbluemin/fleet-core/agent/provider-types";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";
import { getKeybindAPI } from "../config/keybind/bridge.js";
import { getSettingsAPI } from "../config/settings/bridge.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../tui/hud/border-bridge.js";
import { registerProtocolWidget, updateProtocolWidget } from "../../tui/admiral/widget.js";
import registerRequestDirective from "../../tools/admiral/request-directive.js";

export { buildSystemPrompt };

export function bootAdmiral(pi: ExtensionAPI): void {
  const bootProtocol = getActiveProtocol();
  syncProtocolToHud(bootProtocol);
  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds();
}

export function syncAdmiralAcpRuntimeContext(): void {
  syncAcpRuntimeContext();
}

export function syncAdmiralProtocolHud(): void {
  syncProtocolToHud(getActiveProtocol());
}

export function registerAdmiralSettings(): void {
  registerAdmiralSettingsSection();
}

export function mountAdmiralProtocolWidget(ctx: ExtensionContext): void {
  registerProtocolWidget(ctx);
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
        syncAcpRuntimeContext();
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

function syncAcpRuntimeContext(): void {
  setCliRuntimeContext(buildRuntimeContextPrompt);
}

function registerAdmiralSettingsSection(): void {
  const settingsApi = getSettingsAPI();
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
