/**
 * fleet — Carrier PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + N개 Carrier 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+{slot} → 해당 Carrier (에이전트 패널 독점 뷰)    │
 * │ alt+t → Carrier Bridge (PTY 네이티브 브리지)         │
 * │ 같은 키 재입력 → 기본 모드 원복                        │
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+shift+m → 활성 Carrier 모델/추론 설정 변경         │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  onStatusUpdate,
  getActiveCarrierId,
  getRegisteredCarrierConfig,
  resolveCarrierColor,
} from "./carrier/framework.js";
import { initRuntime, onHostSessionChange } from "./internal/agent/runtime.js";
import { cleanIdleClients } from "./internal/agent/client-pool.js";
import { registerModelCommands, syncModelConfig } from "./internal/agent/model-ui.js";
import { exposeAgentApi, clearStreamWidgets, clearCompletedStreamWidgets } from "./operation-runner.js";
import { refreshAgentPanelFooter, getModeBannerLines } from "./internal/panel/lifecycle.js";
import { registerAgentPanelShortcut } from "./internal/panel/shortcuts.js";
import { buildBridgeCommand } from "./carrier/launch.js";
import { attachStatusContext, refreshStatusNow } from "./internal/service-status/store.js";
import { CARRIER_BRIDGE_KEY } from "./constants";
import { registerCaptains } from "./captains/index.js";
import { appendAdmiralSystemPrompt } from "./prompts.js";

import { EDITOR_MODE_PROVIDER_KEY } from "../dock/hud/types.js";
import type { EditorModeProvider } from "../dock/hud/types.js";

import { INFRA_KEYBIND_KEY } from "../dock/keybind/types.js";
import type { InfraKeybindAPI } from "../dock/keybind/types.js";
import { SHELL_POPUP_BRIDGE_KEY } from "../dock/shell/types.js";
import type { ShellPopupBridge } from "../dock/shell/types.js";

export type { CollectedStreamData } from "./internal/contracts.js";

export { runAgentRequest } from "./operation-runner.js";

export {
  getModelConfig,
  updateModelSelection,
  updateAllModelSelections,
} from "./internal/agent/runtime.js";

export {
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "./internal/agent/model-config.js";
export type {
  ModelSelection,
  SelectedModelsConfig,
} from "./internal/agent/model-config.js";

export type { AgentStatus } from "./internal/agent/types.js";

export { syncModelConfig, registerModelCommands } from "./internal/agent/model-ui.js";

export {
  registerCarrier,
  activateCarrier,
  deactivateCarrier,
  getActiveCarrierId,
  getRegisteredOrder,
  getRegisteredCarrierConfig,
  onStatusUpdate,
  notifyStatusUpdate,
  resolveCarrierColor,
  resolveCarrierBgColor,
  resolveCarrierRgb,
  resolveCarrierDisplayName,
  resolveCarrierCliDisplayName,
} from "./carrier/framework.js";

export type {
  CarrierConfig,
  CarrierHelpers,
  CarrierResult,
} from "./carrier/framework.js";

export { registerSingleCarrier } from "./carrier/register.js";
export type { SingleCarrierOptions } from "./carrier/register.js";

export default function unifiedAgentDirectExtension(pi: ExtensionAPI) {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));

  // ── Fleet 런타임 초기화 (영속 파일은 .data/ 하위에 저장) ──
  const dataDir = path.join(extensionDir, ".data");
  initRuntime(dataDir);

  (globalThis as any)[EDITOR_MODE_PROVIDER_KEY] = {
    getActiveModeId: getActiveCarrierId,
    getModeColor: (modeId: string) => resolveCarrierColor(modeId) || null,
    getBannerLines: (width: number) => getModeBannerLines(width),
    onStatusUpdate,
  } satisfies EditorModeProvider;

  exposeAgentApi();

  registerCaptains(pi);
  syncModelConfig();
  registerAgentPanelShortcut();
  registerModelCommands(pi);

  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "fleet",
    action: "carrier-bridge",
    defaultKey: CARRIER_BRIDGE_KEY,
    description: "현재 carrier 네이티브 브리지 열기",
    category: "Fleet Bridge",
    handler: async (ctx) => {
      const bridge = (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] as ShellPopupBridge | undefined;
      if (!bridge) {
        ctx.ui.notify("utils-shell 확장이 로드되지 않았습니다.", "warning");
        return;
      }
      if (bridge.isOpen()) return;

      const modeId = getActiveCarrierId();
      const carrierConfig = modeId ? getRegisteredCarrierConfig(modeId) : undefined;
      if (!carrierConfig) {
        const shell = process.env.SHELL || "/bin/zsh";
        try {
          await bridge.open({ command: shell, title: "Terminal", cwd: ctx.cwd });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`터미널 실행 실패: ${message}`, "error");
        }
        return;
      }

      const command = buildBridgeCommand(modeId!, carrierConfig.cliType);
      const title = carrierConfig.displayName;

      try {
        await bridge.open({ command, title, cwd: ctx.cwd });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`브리지 실행 실패: ${message}`, "error");
      }
    },
  });

  const onSessionChange = (ctx: ExtensionContext) => {
    onHostSessionChange(ctx.sessionManager.getSessionId());
    cleanIdleClients();
    clearStreamWidgets();
    refreshAgentPanelFooter(ctx);
    attachStatusContext(ctx);
  };

  pi.on("before_agent_start", (event, _ctx) => {
    clearCompletedStreamWidgets();
    return {
      systemPrompt: appendAdmiralSystemPrompt(event.systemPrompt),
    };
  });

  pi.on("session_start", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_switch", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_fork", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_tree", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;

    const entries = ctx.sessionManager.getEntries();
    const hasDirectChat = entries.some((e) => e.type === "custom_message");
    if (!hasDirectChat) return;

    const hasAssistant = entries.some(
      (e) => e.type === "message" && (e as any).message?.role === "assistant",
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
  });

  onStatusUpdate(() => { syncModelConfig(); });

  pi.registerCommand("fleet:agent:status", {
    description: "지원 CLI 서비스 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });
}
