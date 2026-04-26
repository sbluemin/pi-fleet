import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { cleanIdleClients } from "../core/agentclientprotocol/pool.js";
import { setCliRuntimeContext, setCliSystemPrompt } from "../core/agentclientprotocol/provider-types.js";
import { onHostSessionChange } from "../core/agentclientprotocol/runtime.js";
import { attachStatusContext, detachStatusContext } from "../core/agentclientprotocol/service-status/store.js";
import {
  mountAdmiralProtocolWidget,
  registerAdmiralSettings,
  syncAdmiralAcpRuntimeContext,
  syncAdmiralAcpSystemPrompt,
  syncAdmiralProtocolHud,
} from "./admiral/index.js";
import { ensureBridgeKeybinds } from "./bridge/index.js";
import { detachAgentPanelUi, refreshAgentPanel } from "./bridge/panel/lifecycle.js";
import { persistDirectChatIfEmpty } from "./bridge/streaming/direct-chat-session.js";
import { syncModelConfig } from "./shipyard/carrier/model-ui.js";

export function wireFleetPiEvents(pi: ExtensionAPI): void {
  pi.on("before_agent_start", () => {
    syncAdmiralAcpRuntimeContext();
  });

  pi.on("session_start", (_event, ctx) => {
    bindFleetHostSession(ctx);
    syncModelConfig();
    syncAdmiralProtocolHud();
    registerAdmiralSettings();
    mountAdmiralProtocolWidget(ctx);
    syncAdmiralAcpSystemPrompt(ctx);
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
  });
}

function bindFleetHostSession(ctx: ExtensionContext): void {
  onHostSessionChange(ctx.sessionManager.getSessionId());
  cleanIdleClients();
  refreshAgentPanel(ctx);
  attachStatusContext(ctx);
}

function clearFleetAcpPrompts(): void {
  setCliSystemPrompt(null);
  setCliRuntimeContext(null);
}
