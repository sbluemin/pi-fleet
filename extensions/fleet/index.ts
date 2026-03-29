/**
 * fleet — 다이렉트 모드 PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + 5개 다이렉트 모드 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+1 → Claude        (에이전트 패널 독점 뷰)         │
 * │ alt+2 → Codex         (에이전트 패널 독점 뷰)         │
 * │ alt+3 → Gemini        (에이전트 패널 독점 뷰)         │
 * │ alt+0 → All           (에이전트 패널 3분할 뷰)        │
 * │ alt+9 → Claude & Codex(에이전트 패널 2분할 뷰)        │
 * │ alt+t → Agent Popup   (PTY 네이티브 팝업)            │
 * │ 같은 키 재입력 → 기본 모드 원복                        │
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+shift+m → 활성 CLI 모델/추론 설정 변경             │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  initRuntime,
  onHostSessionChange,
  exposeAgentApi,
  clearStreamWidgets,
  clearCompletedStreamWidgets,
  refreshAgentPanelFooter,
  setServiceStatusRenderer,
  cleanIdleClients,
} from "./core/index.js";
import { registerAgentPanelShortcut } from "./core/panel/shortcuts.js";

import { onStatusUpdate, getActiveModeId, notifyStatusUpdate } from "./modes/framework";
import { CLI_DISPLAY_NAMES, CODEX_POPUP_KEY, DIRECT_MODE_COLORS } from "./constants";
import { attachStatusContext, refreshStatusNow } from "./status/index.js";
import { renderServiceStatusToken } from "./status/ui.js";
import { registerAgentTools } from "./tools/index";
import { buildAgentPopupCommand } from "./shell/index.js";
import { getModeBannerLines } from "./core/panel/lifecycle.js";

import { EDITOR_MODE_PROVIDER_KEY } from "../infra/hud/types.js";
import type { EditorModeProvider } from "../infra/hud/types.js";

import { INFRA_KEYBIND_KEY } from "../infra/keybind/types.js";
import type { InfraKeybindAPI } from "../infra/keybind/types.js";
import { SHELL_POPUP_BRIDGE_KEY } from "../infra/interactive-shell/types.js";
import type { ShellPopupBridge } from "../infra/interactive-shell/types.js";

import { registerDirectModes } from "./modes/direct.js";
import { registerAllMode } from "./modes/all.js";
import { registerClaudeCodexMode } from "./modes/claude-codex.js";
import { registerModelCommands, syncModelConfig } from "./models/index.js";

export default function unifiedAgentDirectExtension(pi: ExtensionAPI) {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));

  // ── Core 런타임 초기화 (영속 파일은 core/.data/ 하위에 저장) ──
  const dataDir = path.join(extensionDir, "core", ".data");
  initRuntime(dataDir);

  (globalThis as any)[EDITOR_MODE_PROVIDER_KEY] = {
    getActiveModeId,
    getModeColor: (modeId: string) => DIRECT_MODE_COLORS[modeId] ?? null,
    getBannerLines: (width: number) => getModeBannerLines(width),
    onStatusUpdate,
  } satisfies EditorModeProvider;

  exposeAgentApi();

  setServiceStatusRenderer((cli, snapshots, loading) =>
    renderServiceStatusToken(
      cli as import("./core/contracts.js").ProviderKey,
      snapshots,
      loading,
    ),
  );
  syncModelConfig();
  registerAgentPanelShortcut();
  registerAgentTools({ pi });
  registerDirectModes(pi);
  registerAllMode(pi);
  registerClaudeCodexMode(pi);
  registerModelCommands(pi, { getActiveModeId, notifyStatusUpdate });

  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "fleet",
    action: "agent-popup",
    defaultKey: CODEX_POPUP_KEY,
    description: "현재 에이전트 네이티브 팝업 열기",
    category: "Agent Panel",
    handler: async (ctx) => {
      const bridge = (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] as ShellPopupBridge | undefined;
      if (!bridge) {
        ctx.ui.notify("utils-interactive-shell 확장이 로드되지 않았습니다.", "warning");
        return;
      }
      if (bridge.isOpen()) return;

      const modeId = getActiveModeId();
      if (modeId !== "claude" && modeId !== "codex" && modeId !== "gemini") {
        const shell = process.env.SHELL || "/bin/zsh";
        try {
          await bridge.open({ command: shell, title: "Terminal", cwd: ctx.cwd });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`터미널 실행 실패: ${message}`, "error");
        }
        return;
      }

      const agentId = modeId as import("@sbluemin/unified-agent").CliType;
      const command = buildAgentPopupCommand({ agentId }, ctx);
      const title = CLI_DISPLAY_NAMES[agentId] ?? agentId;

      try {
        await bridge.open({ command, title, cwd: ctx.cwd });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`팝업 실행 실패: ${message}`, "error");
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

  pi.on("before_agent_start", (_event, _ctx) => {
    clearCompletedStreamWidgets();
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
    description: "Claude/Codex/Gemini 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });
}
