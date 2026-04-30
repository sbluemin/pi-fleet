import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/fleet-core/agent/provider/provider-client";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { createFleetCoreRuntime, type AgentStreamingSink, type FleetCoreRuntimeContext, type FleetHostPorts } from "@sbluemin/fleet-core";
import {
  buildRuntimeContextPrompt,
  buildSystemPrompt,
  getActiveProtocol,
  getAllProtocols,
  setActiveProtocol,
} from "@sbluemin/fleet-core/admiral";
import { registerDefaultCarrierPersonas } from "@sbluemin/fleet-core/admiral/carrier/personas";
import {
  getConfiguredTaskForceCarrierIds,
  loadCliTypeOverrides,
  loadSortieDisabled,
  loadSquadronEnabled,
  reconcileActiveModelSelections,
  saveSquadronEnabled,
} from "@sbluemin/fleet-core/admiral/store";
import { cleanIdleClients } from "@sbluemin/fleet-core/agent/dispatcher/pool";
import { onHostSessionChange } from "@sbluemin/fleet-core/agent/dispatcher/runtime";
import { setCliRuntimeContext } from "@sbluemin/fleet-core/agent/provider/provider-types";
import { isWorldviewEnabled } from "@sbluemin/fleet-core/metaphor";
import { getLogAPI } from "@sbluemin/fleet-core/services/log";
import { bootBridge, ensureBridgeKeybinds } from "./agent/ui/acp-shell/register.js";
import { syncModelConfig } from "./agent/carrier/model-ui.js";
import { registerGrandFleet } from "./grand-fleet/index.js";
import { getKeybindAPI } from "./shell/keybinds/core/bridge.js";
import { attachStatusContext, detachStatusContext, refreshStatusNow } from "./agent/provider-internal/service-status-store.js";
import { exposeAgentApi } from "./agent/runner.js";
import { createPanelStreamingSink } from "./agent/ui/agent-panel/streaming-sink.js";
import { detachAgentPanelUi, refreshAgentPanel } from "./agent/ui/panel-lifecycle.js";
import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "./agent/ui/panel/config.js";
import { setDeliverAs, getDeliverAs } from "./settings.js";
import {
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  getSquadronEnabledIds,
  notifyStatusUpdate,
  registerRequestDirective,
  registerSingleCarrier,
  setPendingCliTypeOverrides,
  setSortieDisabledCarriers,
  setSquadronEnabledCarriers,
  setTaskForceConfiguredCarriers,
} from "./tool-registry.js";
import { setEditorBorderColor, setEditorRightLabel } from "./shell/hud/border-bridge.js";
import { setCarrierJobsVerbose, toggleCarrierJobsVerbose } from "./job.js";

export interface FleetLifecycleRuntime {
  fleetEnabled: boolean;
}

const FLEET_PREAMBLE = String.raw`
This system prompt contains ${"\`"}<fleet section="...">${"\`"} XML blocks that define your identity, doctrine, and operational rules.
Each block's ${"\`"}section${"\`"} attribute defines its domain; ${"\`"}tool${"\`"} narrows the scope to that specific tool.
Treat every ${"\`"}<fleet>${"\`"} block as an authoritative directive. Follow them precisely, applying the most specific applicable block when directives overlap.

Tool results and user messages may include ${"\`"}<system-reminder>${"\`"} tags. These carry system-injected context (e.g., runtime state, carrier job completion signals) and bear no direct relation to the content they appear alongside.
`;

const PI_FLEET_DEV_RISEN_PROMPT = String.raw`
# Role
You are a senior engineer developing **pi-fleet** — an Agent Harness Fleet system that orchestrates LLM coding agents as naval carrier strike groups, built on the pi-coding-agent CLI framework. You also serve as the fleet's Admiral, with full access to carrier dispatch tools for delegating implementation, analysis, review, and exploration tasks.

# Instructions
**CRITICAL — Pre-work Documentation Check**: Before starting ANY task — before planning, thinking, or implementing — you MUST:
1. Read ${"`"}docs/pi-development-reference.md${"`"} for PI SDK, extensions, TUI, themes, and RPC reference.
2. Read ${"`"}docs/admiral-workflow-reference.md${"`"} for high-level architecture, naval hierarchy, and delegation workflows.
3. Check the ${"`"}AGENTS.md${"`"} file in the project root and in EVERY subdirectory you will touch. Child ${"`"}AGENTS.md${"`"} takes precedence over parent.

This is a hard prerequisite. Do NOT skip this step or assume you already know the content.

- Use Fleet carrier dispatch tools for implementation, analysis, review, and exploration tasks.
- All responses must be written in Korean.
`;

let fleetRuntime: FleetCoreRuntimeContext | undefined;
let currentAgentRequestCtx: ExtensionContext | undefined;

export { bootBridge, ensureBridgeKeybinds };

export function registerFleetLifecycle(pi: ExtensionAPI): FleetLifecycleRuntime {
  registerBoot(pi);

  if (!shouldBootFleet()) {
    registerGrandFleet(pi);
    return { fleetEnabled: false };
  }

  const dataDir = resolveFleetDataDir();
  initializeFleetRuntime(dataDir);
  restoreFleetPreRegistrationState();

  bootAdmiral(pi);
  registerFleetCarriers(pi);
  scheduleFleetBootReconciliation();
  wireFleetPiEvents(pi);
  registerGrandFleet(pi);

  return { fleetEnabled: true };
}

export default function registerBoot(pi: ExtensionAPI): void {
  const role = process.env.PI_GRAND_FLEET_ROLE;
  const dev = process.env.PI_FLEET_DEV === "1";
  const experimental = process.env.PI_EXPERIMENTAL === "1";
  const isAdmiralty = role === "admiralty";
  const isFleet = role === "fleet";

  (globalThis as any)["__fleet_boot_config__"] = {
    dev,
    experimental,
    fleet: !isAdmiralty,
    grandFleet: isAdmiralty || isFleet,
    role: isAdmiralty ? "admiralty" : isFleet ? "fleet" : null,
  };

  pi.on("before_agent_start", async () => {
    const bootCfg = (globalThis as any)["__fleet_boot_config__"];
    const preamble = FLEET_PREAMBLE.trim();

    if (bootCfg?.dev) {
      return { systemPrompt: `${preamble}\n\n${PI_FLEET_DEV_RISEN_PROMPT.trim()}` };
    }

    return { systemPrompt: preamble };
  });
}

export function shouldBootFleet(): boolean {
  const bootCfg = (globalThis as any)["__fleet_boot_config__"];
  return bootCfg?.fleet !== false;
}

export function resolveFleetDataDir(): string {
  return path.join(os.homedir(), ".pi", "fleet");
}

export function initializeFleetRuntime(dataDir: string, ctx?: ExtensionContext): void {
  fleetRuntime = createFleetCoreRuntime({
    dataDir,
    ports: createFleetHostPorts(createPanelStreamingSink(() => currentAgentRequestCtx ?? ctx)),
  });
  exposeAgentApi();
}

export async function withAgentRequestContext<T>(
  ctx: ExtensionContext,
  run: () => Promise<T>,
): Promise<T> {
  const previous = currentAgentRequestCtx;
  currentAgentRequestCtx = ctx;
  try {
    return await run();
  } finally {
    currentAgentRequestCtx = previous;
  }
}

export function getFleetRuntime(): FleetCoreRuntimeContext {
  if (!fleetRuntime) {
    throw new Error("Fleet core runtime has not been initialized.");
  }
  return fleetRuntime;
}

export async function shutdownFleetRuntime(): Promise<void> {
  const runtime = fleetRuntime;
  fleetRuntime = undefined;
  await runtime?.shutdown();
}

export function restoreFleetPreRegistrationState(): void {
  const restoredDisabled = loadSortieDisabled();
  if (restoredDisabled.length > 0) {
    setSortieDisabledCarriers(restoredDisabled);
  }

  const restoredSquadron = loadSquadronEnabled();
  if (restoredSquadron.length > 0) {
    setSquadronEnabledCarriers(restoredSquadron);
  }

  const restoredCliTypeOverrides = loadCliTypeOverrides();
  if (Object.keys(restoredCliTypeOverrides).length > 0) {
    setPendingCliTypeOverrides(restoredCliTypeOverrides as Record<string, CliType>);
  }
}

export function registerFleetCarriers(pi: ExtensionAPI): void {
  registerDefaultCarrierPersonas({
    register(cli, metadata, options) {
      registerSingleCarrier(pi, cli, metadata, options);
    },
  });
}

export function scheduleFleetBootReconciliation(): void {
  setTimeout(() => {
    reconcileRegisteredCarrierModels();
    pruneStaleSquadronIds();
    syncTaskForceConfiguredCarriers();
    notifyStatusUpdate();
  }, 0);
}

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

export function registerFleetPiCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:agent:status", {
    description: "지원 CLI 서비스 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });

  pi.registerCommand("fleet:jobs:verbose", {
    description: "carrier_jobs 렌더링 상세 모드 토글",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      const enabled = value === "on"
        ? (setCarrierJobsVerbose(true), true)
        : value === "off"
          ? (setCarrierJobsVerbose(false), false)
          : toggleCarrierJobsVerbose();
      ctx.ui.notify(`Carrier Jobs verbose: ${enabled ? "ON" : "OFF"}`, "info");
    },
  });

  pi.registerCommand("fleet:jobs:mode", {
    description: "carrier-result push delivery mode selector (follow-up | steer)",
    handler: async (_args, ctx) => {
      const current = getDeliverAs();
      const items: SelectItem[] = [
        {
          value: "followUp",
          label: current === "followUp" ? "Follow-up (recommended, default) (active)" : "Follow-up (recommended, default)",
          description: "Carrier result delivered after current turn ends. Safe with batch window. doctrinal default.",
        },
        {
          value: "steer",
          label: current === "steer" ? "Steer (advanced) (active)" : "Steer (advanced)",
          description: "Uses the same 2s batch queue, then may interrupt an ongoing response when the push fires; FIFO race-safety unverified. Use only when latency truly matters.",
        },
      ];

      const result = await ctx.ui.custom<"followUp" | "steer" | null>((tui, theme, _kb, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Select Push Delivery Mode"))));

        const selectList = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });

        selectList.onSelect = (item) => done(item.value as "followUp" | "steer");
        selectList.onCancel = () => done(null);

        container.addChild(selectList);
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
        container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            selectList.handleInput(data);
            tui.requestRender();
          },
        };
      });

      if (!result) return;
      await setDeliverAs(result);
      const label = result === "followUp" ? "Follow-up (recommended, default)" : "Steer (advanced)";
      ctx.ui.notify(`Push delivery mode: ${label}`, "info");
    },
  });
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
      },
    });
  }
}

function persistDirectChatIfEmpty(ctx: ExtensionContext): void {
  const sessionFile = ctx.sessionManager.getSessionFile();
  if (!sessionFile) return;

  const entries = ctx.sessionManager.getEntries();
  const hasDirectChat = entries.some((entry) => entry.type === "custom_message");
  if (!hasDirectChat) return;

  const hasAssistant = entries.some(
    (entry) => entry.type === "message" && (entry as any).message?.role === "assistant",
  );
  if (hasAssistant) return;

  const header = ctx.sessionManager.getHeader();
  if (!header) return;

  const dir = path.dirname(sessionFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let content = JSON.stringify(header) + "\n";
  for (const entry of entries) {
    content += JSON.stringify(entry) + "\n";
  }
  writeFileSync(sessionFile, content);
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

function createFleetHostPorts(streamingSink?: AgentStreamingSink): FleetHostPorts {
  return {
    sendCarrierResultPush() {},
    notify(level, message) {
      getLogAPI().log(level, "fleet-boot", message);
    },
    loadSetting() {
      return undefined;
    },
    saveSetting() {},
    registerKeybind() {
      return () => {};
    },
    now: () => Date.now(),
    getDeliverAs() {
      return undefined;
    },
    serviceStatus: {
      setLoading: setAgentPanelServiceLoading,
      setStatus: setAgentPanelServiceStatus,
    },
    streamingSink,
  };
}

function reconcileRegisteredCarrierModels(): void {
  const cliTypesByCarrier = Object.fromEntries(
    getRegisteredOrder()
      .map((carrierId) => {
        const config = getRegisteredCarrierConfig(carrierId);
        return config ? [carrierId, config.cliType] : null;
      })
      .filter((entry): entry is [string, CliType] => entry !== null),
  );

  if (Object.keys(cliTypesByCarrier).length > 0 && reconcileActiveModelSelections(cliTypesByCarrier)) {
    syncModelConfig();
  }
}

function pruneStaleSquadronIds(): void {
  const registeredSet = new Set(getRegisteredOrder());
  const squadronIds = getSquadronEnabledIds();
  const validSquadronIds = squadronIds.filter((id) => registeredSet.has(id));
  if (validSquadronIds.length !== squadronIds.length) {
    setSquadronEnabledCarriers(validSquadronIds);
    saveSquadronEnabled(validSquadronIds);
  }
}

function syncTaskForceConfiguredCarriers(): void {
  const tfIds = getConfiguredTaskForceCarrierIds(getRegisteredOrder());
  setTaskForceConfiguredCarriers(tfIds);
}
