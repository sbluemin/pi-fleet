import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
  buildRuntimeContextPrompt,
  buildSystemPrompt,
  getActiveProtocol,
} from "@sbluemin/fleet-core/admiral";
import { cleanIdleClients } from "@sbluemin/fleet-core/agent/pool";
import { setCliRuntimeContext } from "@sbluemin/fleet-core/agent/provider-types";
import { onHostSessionChange } from "@sbluemin/fleet-core/agent/runtime";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";
import { attachStatusContext, detachStatusContext } from "../../provider/service-status-store.js";
import { ensureBridgeKeybinds } from "../../tui/fleet-bridge.js";
import { registerProtocolWidget } from "../../tui/admiral/widget.js";
import { setEditorBorderColor, setEditorRightLabel } from "../../tui/hud/border-bridge.js";
import { detachAgentPanelUi, refreshAgentPanel } from "../../tui/panel-lifecycle.js";
import { persistDirectChatIfEmpty } from "../fleet/direct-chat-session.js";
import { syncModelConfig } from "../../commands/carrier/model-ui.js";
import { getFleetRuntime, shutdownFleetRuntime } from "./fleet-boot.js";

export function wireFleetPiEvents(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    syncAcpRuntimeContext();
    if (process.env.PI_GRAND_FLEET_ROLE === "fleet") return;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt()}` };
  });

  pi.on("session_start", (_event, ctx) => {
    bindFleetHostSession(ctx);
    syncModelConfig();
    syncProtocolToHud(getActiveProtocol());
    registerAdmiralSettingsSection();
    registerProtocolWidget(ctx);
    ensureBridgeKeybinds();
  });

  pi.on("session_tree", (_event, ctx) => {
    bindFleetHostSession(ctx);
    syncModelConfig();
    registerAdmiralSettingsSection();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    detachAgentPanelUi();
    detachStatusContext();
    clearFleetAcpPrompts();
    persistDirectChatIfEmpty(ctx);
    await shutdownFleetRuntime();
  });
}

function bindFleetHostSession(ctx: ExtensionContext): void {
  onHostSessionChange(ctx.sessionManager.getSessionId());
  cleanIdleClients();
  refreshAgentPanel(ctx);
  attachStatusContext(ctx);
}

function clearFleetAcpPrompts(): void {
  setCliRuntimeContext(null);
}

function syncAcpRuntimeContext(): void {
  setCliRuntimeContext(buildRuntimeContextPrompt);
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
