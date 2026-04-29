import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { cleanIdleClients } from "@sbluemin/fleet-core/agent/pool";
import { setCliRuntimeContext } from "@sbluemin/fleet-core/agent/provider-types";
import { onHostSessionChange } from "@sbluemin/fleet-core/agent/runtime";
import { attachStatusContext, detachStatusContext } from "../../provider/service-status-store.js";
import {
  mountAdmiralProtocolWidget,
  registerAdmiralSettings,
  syncAdmiralAcpRuntimeContext,
  syncAdmiralProtocolHud,
  buildSystemPrompt,
} from "../admiral/runtime.js";
import { ensureBridgeKeybinds } from "../../tui/fleet-bridge.js";
import { detachAgentPanelUi, refreshAgentPanel } from "../../tui/panel-lifecycle.js";
import { persistDirectChatIfEmpty } from "../../session/fleet/direct-chat-session.js";
import { syncModelConfig } from "../../commands/carrier/model-ui.js";
import { shutdownFleetRuntime } from "./fleet-boot.js";

export function wireFleetPiEvents(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event) => {
    syncAdmiralAcpRuntimeContext();
    if (process.env.PI_GRAND_FLEET_ROLE === "fleet") return;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildSystemPrompt()}` };
  });

  pi.on("session_start", (_event, ctx) => {
    bindFleetHostSession(ctx);
    syncModelConfig();
    syncAdmiralProtocolHud();
    registerAdmiralSettings();
    mountAdmiralProtocolWidget(ctx);
    ensureBridgeKeybinds();
  });

  pi.on("session_tree", (_event, ctx) => {
    bindFleetHostSession(ctx);
    syncModelConfig();
    registerAdmiralSettings();
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
