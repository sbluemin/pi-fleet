/**
 * unified-agent-direct — 다이렉트 모드 PI 확장 진입점
 *
 * SDK 초기화 + 세션 이벤트 + 4개 다이렉트 모드 등록
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ alt+1 → Claude     (에이전트 패널 독점 뷰)            │
 * │ alt+2 → Codex      (에이전트 패널 독점 뷰)            │
 * │ alt+3 → Gemini     (에이전트 패널 독점 뷰)            │
 * │ alt+0 → All        (에이전트 패널 3분할 뷰)           │
 * │ alt+t → Agent Popup(PTY 네이티브 팝업)               │
 * │ 같은 키 재입력 → 기본 모드 원복                        │
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+shift+m → 활성 CLI 모델/추론 설정 변경             │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { INFRA_KEYBIND_KEY } from "../infra-keybind/types.js";
import type { InfraKeybindAPI } from "../infra-keybind/types.js";
import type { CliType } from "@sbluemin/unified-agent";
import * as path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SDK imports
import { createSessionMapStore, migrateSessionMaps } from "../unified-agent-core/session-map";
import { cleanIdleClients } from "../unified-agent-core/client-pool";
import { executeWithPool } from "../unified-agent-core/executor";

// 에이전트 패널
import {
  refreshAgentPanelFooter,
  registerAgentPanelShortcut,
  setAgentPanelModelConfig,
  setAgentPanelSessionStore,
  startAgentStreaming,
  stopAgentStreaming,
  updateAgentCol,
  getAgentPanelCols,
} from "./agent-panel";
import type { AgentCol } from "./render/panel-renderer";

// 스트림 스토어
import {
  createRun,
  appendTextBlock,
  appendThoughtBlock,
  upsertToolBlock,
  updateRunStatus,
  finalizeRun,
  getVisibleRun,
} from "./streaming/stream-store";

// 프레임워크 + 상수
import {
  registerCustomDirectMode,
  notifyStatusUpdate,
  onStatusUpdate,
  getActiveModeId,
} from "./framework";
import {
  CLI_DISPLAY_NAMES,
  CLI_ORDER,
  CODEX_POPUP_KEY,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  DIRECT_MODE_KEYS,
} from "./constants";
import { createDirectStreamingRouter } from "./streaming/router";
import { attachStatusContext, refreshStatusNow } from "./status/index.js";
import { registerAgentTools } from "./tools/index";
import { crossReportPrompt } from "./tools/prompts";
import { buildAgentPopupCommand } from "./popup-command.js";

import type { DirectModeResult } from "./framework";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SHELL_POPUP_BRIDGE_KEY } from "../utils-interactive-shell/types.js";
import type { ShellPopupBridge } from "../utils-interactive-shell/types.js";

// SDK imports — 모델 설정
import {
  loadSelectedModels,
  saveSelectedModels,
  migrateSelectedModels,
  getAvailableModels,
  getEffortLevels,
  getDefaultBudgetTokens,
} from "../unified-agent-core/model-config";
import type { ModelSelection, SelectedModelsConfig } from "../unified-agent-core/types";

// ─── Per-CLI 모델 선택 ────────────────────────────────────

/**
 * 단일 CLI의 모델 + 추론 설정을 인터랙티브하게 선택합니다.
 * 취소 시 undefined를 반환합니다.
 */
async function selectModelForCli(
  cli: CliType,
  ctx: ExtensionContext,
  configDir: string,
): Promise<ModelSelection | undefined> {
  const cliName = CLI_DISPLAY_NAMES[cli] ?? cli;
  const previousSelection = loadSelectedModels(configDir);
  const prev = previousSelection[cli];

  let provider;
  try {
    provider = getAvailableModels(cli);
  } catch {
    ctx.ui.notify(`${cliName}: 모델 정보를 가져올 수 없습니다.`, "error");
    return undefined;
  }

  // 모델 선택
  const options = provider.models.map((m) => {
    const markers: string[] = [];
    if (m.modelId === provider.defaultModel) markers.push("default");
    if (m.modelId === prev?.model) markers.push("current");
    const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
    return `${m.modelId} — ${m.name}${suffix}`;
  });

  const choice = await ctx.ui.select(`${cliName} 모델 선택:`, options);
  if (choice === undefined) return undefined;

  const modelId = choice.split(" — ")[0]!.trim();
  const selection: ModelSelection = { model: modelId };

  // codex 전용: reasoning effort
  if (cli === "codex") {
    const effortLevels = getEffortLevels(cli);
    if (effortLevels && effortLevels.length > 0) {
      const defaultEffort = provider.reasoningEffort.supported
        ? (provider.reasoningEffort as { default: string }).default
        : undefined;

      const effortOptions = effortLevels.map((level) => {
        const markers: string[] = [];
        if (level === defaultEffort) markers.push("default");
        if (level === prev?.effort) markers.push("current");
        const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
        return `${level}${suffix}`;
      });

      const effortChoice = await ctx.ui.select("Codex reasoning effort:", effortOptions);
      if (effortChoice === undefined) return undefined;
      selection.effort = effortChoice.split(" [")[0]!.trim();
    }
  }

  // claude 전용: thinking (reasoning effort + budget_tokens)
  if (cli === "claude") {
    const effortLevels = getEffortLevels(cli);
    if (effortLevels && effortLevels.length > 0) {
      const defaultEffort = provider.reasoningEffort.supported
        ? (provider.reasoningEffort as { default: string }).default
        : undefined;

      const effortOptions = effortLevels.map((level) => {
        const markers: string[] = [];
        if (level === defaultEffort) markers.push("default");
        if (level === prev?.effort) markers.push("current");
        const suffix = markers.length > 0 ? ` [${markers.join(", ")}]` : "";
        return `${level}${suffix}`;
      });

      const effortChoice = await ctx.ui.select("Claude thinking level:", effortOptions);
      if (effortChoice === undefined) return undefined;
      selection.effort = effortChoice.split(" [")[0]!.trim();

      if (selection.effort !== "none") {
        const defaultBudget = getDefaultBudgetTokens(selection.effort);
        const currentBudget = prev?.budgetTokens;
        const placeholder = currentBudget
          ? `${currentBudget} (current)`
          : `${defaultBudget} (default for ${selection.effort})`;

        const budgetInput = await ctx.ui.input(
          `Claude budget_tokens (${selection.effort}):`,
          placeholder,
        );

        if (budgetInput !== undefined && budgetInput.trim()) {
          const parsed = parseInt(budgetInput.trim(), 10);
          if (!isNaN(parsed) && parsed > 0) {
            selection.budgetTokens = parsed;
          } else {
            selection.budgetTokens = defaultBudget;
            ctx.ui.notify(`유효하지 않은 입력. 기본값 ${defaultBudget} 사용.`, "warning");
          }
        } else {
          selection.budgetTokens = currentBudget ?? defaultBudget;
        }
      }
    }
  }

  return selection;
}

// ─── 확장 진입점 ─────────────────────────────────────────

export default function unifiedAgentDirectExtension(pi: ExtensionAPI) {
  const cliTypes = CLI_ORDER;
  const extensionDir = path.dirname(fileURLToPath(import.meta.url));
  // 레거시 마이그레이션 소스 (세션 맵 + 모델 설정)
  const legacySdkDir = path.resolve(extensionDir, "../unified-agent-core");

  // ── 세션 스토어 초기화 (이 확장 자체 디렉토리에 저장) ──
  const sessionDir = path.join(extensionDir, "session-maps");
  migrateSessionMaps(path.join(legacySdkDir, "session-maps"), sessionDir);
  const sessionStore = createSessionMapStore(sessionDir);

  // ── 모델 설정 마이그레이션 (레거시 SDK → 확장 디렉토리) ──
  migrateSelectedModels(legacySdkDir, extensionDir);

  // 에이전트 패널에 세션 스토어 주입
  setAgentPanelSessionStore(sessionStore);
  // 초기 모델 설정을 footer에 반영
  setAgentPanelModelConfig(loadSelectedModels(extensionDir));

  // ── 에이전트 패널 단축키 등록 ──
  registerAgentPanelShortcut();

  // ── 개별 에이전트 도구 등록 (claude, codex, gemini) ──
  registerAgentTools({ pi, configDir: extensionDir, sessionStore });

  // ── Per-CLI 모델 변경 단축키 ──
  const keybind = (globalThis as any)[INFRA_KEYBIND_KEY] as InfraKeybindAPI;
  keybind.register({
    extension: "unified-agent-direct",
    action: "model-change",
    defaultKey: "alt+shift+m",
    description: "활성 CLI 모델/추론 설정 변경",
    category: "Infra",
    handler: async (ctx) => {
      // 1. 대상 CLI 결정
      const activeModeId = getActiveModeId();
      let targetCli: CliType;

      if (activeModeId && cliTypes.includes(activeModeId as CliType)) {
        // 독점 뷰 (alt+1/2/3) → 해당 CLI 바로 진입
        targetCli = activeModeId as CliType;
      } else {
        // All 모드 / 비활성 → CLI 선택 UI 표시
        const cliOptions = cliTypes.map((cli) =>
          `${CLI_DISPLAY_NAMES[cli] ?? cli} (${DIRECT_MODE_KEYS[cli] ?? cli})`,
        );
        const choice = await ctx.ui.select("모델을 변경할 CLI 선택:", cliOptions);
        if (choice === undefined) return;
        targetCli = cliTypes[cliOptions.indexOf(choice)];
      }

      // 2. Per-CLI 모델 선택
      const selection = await selectModelForCli(targetCli, ctx, extensionDir);
      if (!selection) return;

      // 3. 기존 설정에 merge 저장 (다른 CLI 설정 보존)
      const existing = loadSelectedModels(extensionDir);
      existing[targetCli] = selection;
      saveSelectedModels(extensionDir, existing);
      cleanIdleClients();

      // 4. 알림 + 상태바 갱신
      const cliName = CLI_DISPLAY_NAMES[targetCli] ?? targetCli;
      let summary = `${cliName}=${selection.model}`;
      if (selection.effort) summary += ` effort=${selection.effort}`;
      if (selection.budgetTokens) summary += ` budget=${selection.budgetTokens}`;
      ctx.ui.notify(`모델 설정 저장: ${summary}`, "info");

      syncModelConfig();
      notifyStatusUpdate();
    },
  });

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

      if (bridge.isOpen()) {
        return;
      }

      const modeId = getActiveModeId();

      // 모드 비활성 시 기본 쉘 열기
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

      // 현재 활성 CLI의 세션 ID로 resume (없으면 신규 실행)
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

  // ── 세션 변경 핸들러 ──
  const onSessionChange = (ctx: import("@mariozechner/pi-coding-agent").ExtensionContext) => {
    sessionStore.restore(ctx.sessionManager.getSessionId());
    cleanIdleClients();
    refreshAgentPanelFooter(ctx);
    attachStatusContext(ctx);
  };

  pi.on("session_start", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_switch", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_fork", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_tree", (_event, ctx) => { onSessionChange(ctx); syncModelConfig(); });

  // ── Direct Mode 전용 세션 강제 저장 ──
  // pi 코어의 _persist()는 assistant 메시지가 없으면 디스크에 쓰지 않음.
  // Direct Mode만 사용하면 assistant 메시지가 생기지 않아 세션 파일이 아예 안 만들어짐.
  // session_shutdown 시점에 메모리의 엔트리를 직접 파일로 기록하여 /resume에서 접근 가능하게 함.
  //
  // pi 코어가 이미 flush한 경우(assistant 메시지가 있는 세션)에는 건너뛰되,
  // Direct Mode 전용 세션은 항상 최신 엔트리로 덮어씀.
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;

    // Direct Mode 대화(custom_message)가 있는지 확인
    const entries = ctx.sessionManager.getEntries();
    const hasDirectChat = entries.some(
      (e) => e.type === "custom_message",
    );
    if (!hasDirectChat) return;

    // assistant 메시지가 있으면 pi 코어의 _persist()가 이미 관리 → 건너뜀
    const hasAssistant = entries.some(
      (e) => e.type === "message" && (e as any).message?.role === "assistant",
    );
    if (hasAssistant) return;

    // 세션 파일 수동 생성/갱신 (항상 최신 엔트리로 덮어씀)
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

  // ── 모델 설정 → footer 동기화 ──
  function syncModelConfig() {
    setAgentPanelModelConfig(loadSelectedModels(extensionDir));
  }

  // 외부 확장에서 notifyStatusUpdate 호출 시 footer 갱신
  onStatusUpdate(() => { syncModelConfig(); });

  // ── 모델 선택 커맨드 ──
  pi.registerCommand("ua-models", {
    description: "서브에이전트별 모델 선택 (gemini → claude → codex)",
    handler: async (_args, ctx) => {
      const selectionOrder: CliType[] = ["gemini", "claude", "codex"];
      const selectedModels: SelectedModelsConfig = {};

      for (const cli of selectionOrder) {
        const selection = await selectModelForCli(cli, ctx, extensionDir);
        if (selection === undefined) {
          ctx.ui.notify("모델 선택이 취소되었습니다.", "warning");
          return;
        }
        selectedModels[cli] = selection;
      }

      // 저장
      saveSelectedModels(extensionDir, selectedModels);
      cleanIdleClients();

      // 요약 알림
      const summary = Object.entries(selectedModels).map(([k, v]) => {
        let s = `${k}=${v.model}`;
        if (v.effort) s += ` effort=${v.effort}`;
        if (v.budgetTokens) s += ` budget=${v.budgetTokens}`;
        return s;
      }).join(", ");
      ctx.ui.notify(`모델 선택 저장 완료: ${summary}`, "info");

      // 상태바 갱신 (자체 + 외부 확장)
      syncModelConfig();
      notifyStatusUpdate();
    },
  });

  pi.registerCommand("ua-status-refresh", {
    description: "Claude/Codex/Gemini 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });

  // ── 기본 3개 CLI 다이렉트 모드 등록 ──
  for (const cli of cliTypes) {
    const shortcutKey = DIRECT_MODE_KEYS[cli];
    if (!shortcutKey) continue;

    registerCustomDirectMode(pi, {
      id: cli,
      displayName: CLI_DISPLAY_NAMES[cli] ?? cli,
      shortcutKey,
      color: DIRECT_MODE_COLORS[cli] ?? "",
      bgColor: DIRECT_MODE_BG_COLORS[cli],
      bottomHint: ` ${shortcutKey} exit · alt+x cancel · alt+shift+m model `,
      showWorkingMessage: false,

      onExecute: async (
        request: string,
        ctx: ExtensionContext,
        helpers,
      ): Promise<DirectModeResult> => {
        const router = createDirectStreamingRouter(ctx, cli);

        router.start();

        try {
          const result = await executeWithPool({
            cli,
            request,
            cwd: ctx.cwd,
            configDir: extensionDir,
            sessionStore,
            signal: helpers.signal,
            onMessageChunk: (text) => router.onMessageChunk(text),
            onThoughtChunk: (text) => router.onThoughtChunk(text),
            onToolCall: (title, status, rawOutput) => router.onToolCall(title, status, rawOutput),
            onStatusChange: (status) => router.onStatusChange(status),
          });

          router.finish(result);

          const collected = router.getCollectedData();
          return {
            content: result.responseText || (result.status === "aborted" ? "(aborted)" : "(no output)"),
            details: {
              cli,
              sessionId: result.connectionInfo?.sessionId ?? undefined,
              error: result.status !== "done" ? true : undefined,
              thinking: collected.thinking || undefined,
              toolCalls: collected.toolCalls.length > 0 ? collected.toolCalls : undefined,
              blocks: collected.blocks.length > 0 ? collected.blocks : undefined,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          router.fail(message);
          throw error;
        } finally {
          router.stop();
        }
      },
    });
  }

  // ── All 모드 (3에이전트 동시 질의) ──
  registerAllMode(pi, extensionDir, sessionStore);
}

// ─── All 모드 헬퍼 ───────────────────────────────────────

/**
 * 하나의 에이전트에 질의합니다.
 * stream-store에 데이터를 기록하고, 패널 칼럼에 브릿지합니다.
 * 렌더링은 패널의 애니메이션 타이머가 자동 처리합니다.
 */
async function queryAgent(
  colIndex: number,
  request: string,
  configDir: string,
  sessionStore: import("../unified-agent-core/session-map").SessionMapStore,
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  const col = getAgentPanelCols()[colIndex];
  const cli = col.cli;

  // store에 새 run 생성 (startAgentStreaming → resetRuns에서 이미 생성됨, 하지만 안전)
  createRun(cli, "conn");
  updateAgentCol(colIndex, { status: "conn" });

  /** store → 패널 칼럼 브릿지 */
  function syncCol(): void {
    const run = getVisibleRun(cli);
    if (!run) return;
    updateAgentCol(colIndex, {
      status: run.status,
      text: run.text,
      thinking: run.thinking,
      toolCalls: run.toolCalls,
      blocks: run.blocks,
      sessionId: run.sessionId,
      error: run.error,
    });
  }

  const result = await executeWithPool({
    cli: cli as any,
    request,
    cwd,
    configDir,
    sessionStore,
    signal,
    onMessageChunk: (text) => {
      appendTextBlock(cli, text);
      syncCol();
    },
    onThoughtChunk: (text) => {
      appendThoughtBlock(cli, text);
      syncCol();
    },
    onToolCall: (title, status, rawOutput) => {
      upsertToolBlock(cli, title, status, rawOutput);
      syncCol();
    },
    onStatusChange: (s) => {
      updateRunStatus(cli, s);
      syncCol();
    },
  });

  // 최종 상태 반영
  const sessionId = result.connectionInfo.sessionId;
  if (result.status === "done") {
    finalizeRun(cli, "done", {
      sessionId,
      fallbackText: result.responseText || "(no output)",
      fallbackThinking: result.thoughtText,
    });
  } else if (result.status === "aborted") {
    finalizeRun(cli, "err", {
      sessionId,
      error: "aborted",
      fallbackText: "Aborted.",
      fallbackThinking: result.thoughtText,
    });
  } else {
    finalizeRun(cli, "err", {
      sessionId,
      error: result.error,
      fallbackText: `Error: ${result.error ?? "unknown"}`,
      fallbackThinking: result.thoughtText,
    });
  }

  syncCol();
}

/** 칼럼 결과를 마크다운 텍스트로 통합 */
function colsToMarkdown(cols: AgentCol[]): string {
  return cols.map((c) => {
    const nm = CLI_DISPLAY_NAMES[c.cli] ?? c.cli;
    const s = c.status === "done" ? "✓" : "✗";
    return `## ${s} ${nm}\n\n${c.text.trim() || "(no output)"}`;
  }).join("\n\n---\n\n");
}

/** All 다이렉트 모드 등록 */
function registerAllMode(
  pi: ExtensionAPI,
  configDir: string,
  sessionStore: import("../unified-agent-core/session-map").SessionMapStore,
) {
  // ── All 다이렉트 모드 등록 (다른 CLI와 동일한 패턴) ──
  registerCustomDirectMode(pi, {
    id: "all",
    displayName: "All",
    shortcutKey: "alt+0",
    color: DIRECT_MODE_COLORS["all"]!,
    bgColor: DIRECT_MODE_BG_COLORS["all"],
    bottomHint: " alt+0 exit · alt+x cancel · alt+shift+m model ",
    showWorkingMessage: false,

    onExecute: async (request, ctx, helpers) => {
      startAgentStreaming(ctx, { expand: true });

      const cols = getAgentPanelCols();
      await Promise.all(
        cols.map((_, i) => queryAgent(i, request, configDir, sessionStore, ctx.cwd, helpers.signal)),
      );

      stopAgentStreaming(ctx);

      const finalCols = getAgentPanelCols();
      const rawContent = colsToMarkdown(finalCols);

      // 모든 에이전트가 성공적으로 응답한 경우, PI가 교차 보고서를 자동 생성
      const doneCount = finalCols.filter((c) => c.status === "done").length;
      if (doneCount >= 2) {
        const prompt = crossReportPrompt(
          request,
          finalCols
            .filter((c) => c.status === "done")
            .map((c) => ({
              cli: c.cli,
              displayName: CLI_DISPLAY_NAMES[c.cli] ?? c.cli,
              text: c.text,
            })),
        );
        // executeDirectMode가 all-response 메시지를 전송한 후 실행되도록 지연
        // source="extension"이므로 다이렉트 모드 input 핸들러를 우회하여
        // PI의 현재 프로바이더/모델이 직접 교차 보고서를 생성
        setTimeout(() => {
          pi.sendUserMessage(prompt);
        }, 0);
      }

      return {
        content: rawContent,
        details: {
          cli: "all",
          columns: finalCols.map((c) => ({ cli: c.cli, status: c.status })),
        },
      };
    },
  });
}
