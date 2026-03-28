/**
 * unified-agent-direct — 다이렉트 모드 PI 확장 진입점
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

// 코어 에이전트
import { createSessionMapStore } from "./core/agent/session-map";
import { cleanIdleClients } from "./core/agent/client-pool";


// 에이전트 패널
import { refreshAgentPanelFooter, setAgentPanelSessionStore } from "./core/panel/lifecycle.js";
import { registerAgentPanelShortcut } from "./core/panel/shortcuts.js";

// 프레임워크
import { onStatusUpdate, getActiveModeId, notifyStatusUpdate } from "./modes/framework";
import { CLI_DISPLAY_NAMES, CODEX_POPUP_KEY, DIRECT_MODE_COLORS } from "./constants";
import { attachStatusContext, refreshStatusNow } from "./status/index.js";
import { renderServiceStatusToken } from "./status/ui.js";
import { exposeAgentApi, clearStreamWidgets, clearCompletedStreamWidgets } from "./core/orchestrator.js";
import { setServiceStatusRenderer } from "./core/panel/config.js";
import { registerAgentTools } from "./tools/index";
import { buildAgentPopupCommand } from "./shell/index.js";
import { getModeBannerLines } from "./core/panel/lifecycle.js";

// 외부 확장 브릿지 — infra-hud 에디터 모드 프로바이더
import { EDITOR_MODE_PROVIDER_KEY } from "../infra-hud/types.js";
import type { EditorModeProvider } from "../infra-hud/types.js";

// 외부 확장 브릿지
import { INFRA_KEYBIND_KEY } from "../infra-keybind/types.js";
import type { InfraKeybindAPI } from "../infra-keybind/types.js";
import { SHELL_POPUP_BRIDGE_KEY } from "../utils-interactive-shell/types.js";
import type { ShellPopupBridge } from "../utils-interactive-shell/types.js";

// 분해된 모듈
import { registerDirectModes } from "./modes/direct.js";
import { registerAllMode } from "./modes/all.js";
import { registerClaudeCodexMode } from "./modes/claude-codex.js";
import { registerModelCommands, syncModelConfig } from "./models/index.js";

// ─── 확장 진입점 ─────────────────────────────────────────

export default function unifiedAgentDirectExtension(pi: ExtensionAPI) {
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));

  // ── 세션 스토어 초기화 ──
  const sessionDir = path.join(extensionDir, "session-maps");
  const sessionStore = createSessionMapStore(sessionDir);

  // ── infra-hud 에디터 모드 프로바이더 주입 (역방향 의존 제거) ──
  (globalThis as any)[EDITOR_MODE_PROVIDER_KEY] = {
    getActiveModeId,
    getModeColor: (modeId: string) => DIRECT_MODE_COLORS[modeId] ?? null,
    getBannerLines: (width: number) => getModeBannerLines(width),
    onStatusUpdate,
  } satisfies EditorModeProvider;

  // ── 코어 와이어링 ──
  setAgentPanelSessionStore(sessionStore);
  exposeAgentApi({ configDir: extensionDir, sessionStore });

  // 서비스 상태 렌더러 주입 (status feature → core panel, 역방향 의존 방지)
  setServiceStatusRenderer((cli, snapshots, loading) =>
    renderServiceStatusToken(
      cli as import("./core/contracts.js").ProviderKey,
      snapshots,
      loading,
    ),
  );
  syncModelConfig(extensionDir);
  registerAgentPanelShortcut();
  registerAgentTools({ pi, configDir: extensionDir, sessionStore });
  registerDirectModes(pi, extensionDir, sessionStore);
  registerAllMode(pi, extensionDir, sessionStore);
  registerClaudeCodexMode(pi, extensionDir, sessionStore);
  registerModelCommands(pi, extensionDir, sessionStore, { getActiveModeId, notifyStatusUpdate });

  // ── 에이전트 팝업 단축키 ──
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "unified-agent-direct",
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

      const agentId = modeId;
      const sessionId = sessionStore.get(agentId as import("@sbluemin/unified-agent").CliType);
      const command = buildAgentPopupCommand({ agentId: agentId as import("@sbluemin/unified-agent").CliType, sessionId }, ctx, extensionDir);
      const title = CLI_DISPLAY_NAMES[agentId] ?? agentId;

      try {
        await bridge.open({ command, title, cwd: ctx.cwd });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`팝업 실행 실패: ${message}`, "error");
      }
    },
  });

  // ── 세션 이벤트 ──
  const onSessionChange = (ctx: ExtensionContext) => {
    sessionStore.restore(ctx.sessionManager.getSessionId());
    cleanIdleClients();
    clearStreamWidgets();
    refreshAgentPanelFooter(ctx);
    attachStatusContext(ctx);
  };

  // ── pi 호스트 응답 시작 시 완료된 스트림 위젯만 제거 (진행 중 위젯은 유지) ──
  pi.on("before_agent_start", (_event, _ctx) => {
    clearCompletedStreamWidgets();
  });

  pi.on("session_start", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(extensionDir); });
  pi.on("session_switch", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(extensionDir); });
  pi.on("session_fork", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(extensionDir); });
  pi.on("session_tree", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(extensionDir); });

  // ── Direct Mode 전용 세션 강제 저장 ──
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

  // ── 모델 설정 동기화 콜백 ──
  onStatusUpdate(() => { syncModelConfig(extensionDir); });

  // ── 상태 새로고침 커맨드 ──
  pi.registerCommand("fleet:agent:status", {
    description: "Claude/Codex/Gemini 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });
}
