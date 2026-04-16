import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { getKeybindAPI } from "../../core/keybind/bridge.js";
import { getSettingsAPI } from "../../core/settings/bridge.js";
import { PROVIDER_ID, setCliRuntimeContext, setCliSystemPrompt } from "../../core/agentclientprotocol/provider-types.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../core/hud/border-bridge.js";
import {
  appendAdmiralSystemPrompt,
  buildAcpSystemPrompt,
  buildAcpRuntimeContext,
  isWorldviewEnabled,
  setWorldviewEnabled,
} from "./prompts.js";
import { getAllProtocols, getActiveProtocol, setActiveProtocol } from "./protocols/index.js";
import { registerProtocolWidget, updateProtocolWidget } from "./widget.js";
import registerRequestDirective from "./request-directive.js";

interface AdmiralBootApi {
  onBeforeAgentStart(systemPrompt: string): { systemPrompt: string };
  onSessionStart(ctx: ExtensionContext): void;
  onSessionTree(): void;
}

export function bootAdmiral(pi: ExtensionAPI): AdmiralBootApi {
  const bootProtocol = getActiveProtocol();
  syncProtocolToHud(bootProtocol);
  registerAdmiralSettingsSection();
  registerRequestDirective(pi);
  registerProtocolKeybinds();
  registerAdmiralCommands(pi);

  return {
    onBeforeAgentStart(systemPrompt: string) {
      syncAcpRuntimeContext();
      return { systemPrompt: appendAdmiralSystemPrompt(systemPrompt) };
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

function syncAcpSystemPrompt(ctx: ExtensionContext): void {
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
  setCliRuntimeContext(buildAcpRuntimeContext());
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

function registerAdmiralCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:admiral:worldview", {
    description: "세계관(fleet metaphor) 프롬프트 토글 (on/off)",
    handler: async (_args, ctx) => {
      const current = isWorldviewEnabled();
      const next = !current;
      setWorldviewEnabled(next);
      ctx.ui.notify(
        `Fleet Worldview → ${next ? "ON" : "OFF"} (다음 턴부터 적용)`,
        "info",
      );
    },
  });
}
