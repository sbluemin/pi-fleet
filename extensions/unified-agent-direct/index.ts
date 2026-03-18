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
 * │ 같은 키 재입력 → 기본 모드 원복                        │
 * │ alt+p → 에이전트 패널 토글                            │
 * │ alt+shift+m → 활성 CLI 모델/추론 설정 변경             │
 * └──────────────────────────────────────────────────────┘
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CliType } from "@sbluemin/unified-agent";
import * as path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// SDK imports
import { initSessionMap, restoreSessionMap } from "../unified-agent-core/session-map";
import { cleanIdleClients } from "../unified-agent-core/client-pool";
import { executeWithPool } from "../unified-agent-core/executor";

// 에이전트 패널
import {
  refreshAgentPanelFooter,
  registerAgentPanelShortcut,
  setAgentPanelModelConfig,
  startAgentStreaming,
  stopAgentStreaming,
  updateAgentCol,
  getAgentPanelCols,
} from "./agent-panel";
import type { AgentCol } from "./agent-panel-renderer";

// 프레임워크 + 상수
import { registerCustomDirectMode, notifyStatusUpdate, onStatusUpdate, getActiveModeId } from "./framework";
import {
  CLI_DISPLAY_NAMES,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  DIRECT_MODE_KEYS,
} from "./constants";
import { createDirectStreamingRouter } from "./direct-streaming-router";
import { attachStatusContext, refreshStatusNow } from "./status/index.js";

import type { DirectModeResult } from "./framework";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// SDK imports — 모델 설정
import {
  loadSelectedModels,
  saveSelectedModels,
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
  sdkDir: string,
): Promise<ModelSelection | undefined> {
  const cliName = CLI_DISPLAY_NAMES[cli] ?? cli;
  const previousSelection = loadSelectedModels(sdkDir);
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

  // codex 전용: direct 모드 + reasoning effort
  if (cli === "codex") {
    const directOptions = [
      `ACP — 기본 프로토콜${prev?.direct !== true ? " [current]" : ""}`,
      `Direct — ACP 우회, JSONL 직접 실행${prev?.direct === true ? " [current]" : ""}`,
    ];
    const directChoice = await ctx.ui.select("Codex 연결 모드:", directOptions);
    if (directChoice === undefined) return undefined;
    selection.direct = directChoice.startsWith("Direct");

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
  const cliTypes: CliType[] = ["claude", "codex", "gemini"];
  // 설정/세션 데이터는 SDK 디렉토리에 공유 저장 (확장 간 configDir 통일)
  const sdkDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../unified-agent-core");

  // ── SDK 초기화 ──
  initSessionMap(sdkDir);
  // 초기 모델 설정을 footer에 반영
  setAgentPanelModelConfig(loadSelectedModels(sdkDir));

  // ── 에이전트 패널 단축키 등록 ──
  registerAgentPanelShortcut(pi);

  // ── Per-CLI 모델 변경 단축키 ──
  pi.registerShortcut("alt+shift+m", {
    description: "활성 CLI 모델/추론 설정 변경",
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
      const selection = await selectModelForCli(targetCli, ctx, sdkDir);
      if (!selection) return;

      // 3. 기존 설정에 merge 저장 (다른 CLI 설정 보존)
      const existing = loadSelectedModels(sdkDir);
      existing[targetCli] = selection;
      saveSelectedModels(sdkDir, existing);
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

  // ── 세션 변경 핸들러 ──
  const onSessionChange = async (ctx: import("@mariozechner/pi-coding-agent").ExtensionContext) => {
    restoreSessionMap(ctx.sessionManager.getSessionId());
    cleanIdleClients();
    refreshAgentPanelFooter(ctx);
    await attachStatusContext(ctx);
  };

  pi.on("session_start", async (_event, ctx) => { await onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_switch", async (_event, ctx) => { await onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_fork", async (_event, ctx) => { await onSessionChange(ctx); syncModelConfig(); });
  pi.on("session_tree", async (_event, ctx) => { await onSessionChange(ctx); syncModelConfig(); });

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
    setAgentPanelModelConfig(loadSelectedModels(sdkDir));
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
        const selection = await selectModelForCli(cli, ctx, sdkDir);
        if (selection === undefined) {
          ctx.ui.notify("모델 선택이 취소되었습니다.", "warning");
          return;
        }
        selectedModels[cli] = selection;
      }

      // 저장
      saveSelectedModels(sdkDir, selectedModels);
      cleanIdleClients();

      // 요약 알림
      const summary = Object.entries(selectedModels).map(([k, v]) => {
        let s = `${k}=${v.model}`;
        if (v.direct) s += " (direct)";
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
            configDir: sdkDir,
            signal: helpers.signal,
            onMessageChunk: (text) => router.onMessageChunk(text),
            onThoughtChunk: (text) => router.onThoughtChunk(text),
            onToolCall: (title, status) => router.onToolCall(title, status),
            onStatusChange: (status) => router.onStatusChange(status),
          });

          router.finish(result);

          return {
            content: result.responseText || (result.status === "aborted" ? "(aborted)" : "(no output)"),
            details: {
              cli,
              sessionId: result.connectionInfo?.sessionId ?? undefined,
              error: result.status !== "done" ? true : undefined,
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
  registerAllMode(pi, sdkDir);
}

// ─── All 모드 헬퍼 ───────────────────────────────────────

/**
 * 하나의 에이전트에 질의합니다.
 * 에이전트 패널 API를 통해 칼럼 데이터를 업데이트하며,
 * 렌더링은 패널의 애니메이션 타이머가 자동 처리합니다.
 */
async function queryAgent(
  colIndex: number,
  request: string,
  sdkDir: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  updateAgentCol(colIndex, { status: "conn" });

  const col = getAgentPanelCols()[colIndex];
  const result = await executeWithPool({
    cli: col.cli as any,
    request,
    cwd,
    configDir: sdkDir,
    signal,
    onMessageChunk: (text) => {
      const c = getAgentPanelCols()[colIndex];
      updateAgentCol(colIndex, { text: c.text + text, status: "stream" });
    },
    onThoughtChunk: (text) => {
      const c = getAgentPanelCols()[colIndex];
      updateAgentCol(colIndex, { thinking: c.thinking + text });
    },
    onStatusChange: (s) => {
      if (s === "running") updateAgentCol(colIndex, { status: "stream" });
    },
  });

  const finalCol = getAgentPanelCols()[colIndex];
  const sessionId = result.connectionInfo.sessionId ?? finalCol.sessionId;
  if (result.status === "done") {
    updateAgentCol(colIndex, {
      status: "done",
      sessionId,
      text: finalCol.text.trim() ? finalCol.text : "(no output)",
    });
  } else if (result.status === "aborted") {
    updateAgentCol(colIndex, {
      status: "err",
      sessionId,
      error: "aborted",
      text: finalCol.text || "Aborted.",
    });
  } else {
    updateAgentCol(colIndex, {
      status: "err",
      sessionId,
      error: result.error,
      text: finalCol.text || `Error: ${result.error ?? "unknown"}`,
    });
  }
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
function registerAllMode(pi: ExtensionAPI, sdkDir: string) {
  // ── All 다이렉트 모드 등록 (다른 CLI와 동일한 패턴) ──
  registerCustomDirectMode(pi, {
    id: "all",
    displayName: "All",
    shortcutKey: "alt+0",
    color: DIRECT_MODE_COLORS["all"]!,
    bgColor: DIRECT_MODE_BG_COLORS["all"],
    bottomHint: " alt+0 exit · alt+x cancel · alt+shift+m model ",

    onExecute: async (request, ctx, helpers) => {
      startAgentStreaming(ctx, { expand: true });

      const cols = getAgentPanelCols();
      await Promise.all(
        cols.map((_, i) => queryAgent(i, request, sdkDir, ctx.cwd, helpers.signal)),
      );

      stopAgentStreaming(ctx);

      const finalCols = getAgentPanelCols();
      return {
        content: colsToMarkdown(finalCols),
        details: {
          cli: "all",
          columns: finalCols.map((c) => ({ cli: c.cli, status: c.status })),
        },
      };
    },
  });
}
