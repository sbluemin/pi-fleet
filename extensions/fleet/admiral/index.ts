import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../../core/keybind/bridge.js";
import { getSettingsAPI } from "../../core/settings/bridge.js";
import { PROVIDER_ID, setCliRuntimeContext, setCliSystemPrompt } from "../../core/agentclientprotocol/provider-types.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../core/hud/border-bridge.js";
import { isWorldviewEnabled } from "../../metaphor/worldview.js";
import {
  buildAcpSystemPrompt,
  buildAcpRuntimeContext,
} from "./prompts.js";
import { getAllProtocols, getActiveProtocol, setActiveProtocol } from "./protocols/index.js";
import { registerProtocolWidget, updateProtocolWidget } from "./widget.js";
import registerRequestDirective from "./request-directive.js";

interface AdmiralBootApi {
  onBeforeAgentStart(): void;
  onSessionStart(ctx: ExtensionContext): void;
  onSessionTree(): void;
}

export function bootAdmiral(pi: ExtensionAPI): AdmiralBootApi {
  const bootProtocol = getActiveProtocol();
  syncProtocolToHud(bootProtocol);
  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds();

  return {
    onBeforeAgentStart() {
      syncAcpRuntimeContext();
    },
    onSessionStart(ctx: ExtensionContext) {
      syncProtocolToHud(getActiveProtocol());
      registerAdmiralSettingsSection();
      registerProtocolWidget(ctx);
      syncAcpSystemPrompt(ctx);
    },
    onSessionTree() {
      registerAdmiralSettingsSection();
    },
  };
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

/**
 * ACP 프로바이더용 시스템 프롬프트를 동기화한다.
 */
function syncAcpSystemPrompt(ctx: ExtensionContext): void {
  // grand-fleet/fleet 모드에서는 grand-fleet/fleet 확장이 setCliSystemPrompt를 단독으로
  // 호출하여 base + Grand Fleet context 합성본을 설정한다. 이 함수가 먼저
  // 호출되면 즉시 덮어써져 builder가 두 번 실행되므로 (낭비 + race 위험),
  // grand-fleet/fleet 모드에서는 호출 자체를 생략한다.
  if (process.env.PI_GRAND_FLEET_ROLE === "fleet") {
    syncAcpRuntimeContext();
    return;
  }

  const isAcp = ctx.model?.provider === PROVIDER_ID;
  if (isAcp) {
    setCliSystemPrompt(buildAcpSystemPrompt());
    syncAcpRuntimeContext();
    return;
  }

  setCliSystemPrompt(null);
  setCliRuntimeContext(null);
}

function syncAcpRuntimeContext(): void {
  // builder 함수 자체를 등록 — provider-stream이 매 턴 user request를 인자로 호출
  setCliRuntimeContext(buildAcpRuntimeContext);
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
