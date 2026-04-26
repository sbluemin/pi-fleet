import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../../core/keybind/bridge.js";
import { getSettingsAPI } from "../../core/settings/bridge.js";
import { setCliRuntimeContext } from "../../core/agentclientprotocol/provider-types.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../core/hud/border-bridge.js";
import { isWorldviewEnabled } from "../../metaphor/worldview.js";
import {
  buildRuntimeContextPrompt,
} from "./prompts.js";
import { getAllProtocols, getActiveProtocol, setActiveProtocol } from "./protocols/index.js";
import { registerProtocolWidget, updateProtocolWidget } from "./widget.js";
import registerRequestDirective from "./request-directive.js";

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
  // builder 함수 자체를 등록 — provider-stream이 매 턴 user request를 인자로 호출
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
