/**
 * core-hud/editor.ts — 커스텀 에디터, footer, 위젯 설정
 *
 * 커스텀 에디터 팩토리, 상태바 렌더링, footer 등록, 위젯 등록을 담당한다.
 * footer를 직접 등록하여 footerDataRef를 확보하므로 globalThis 간접 참조가 없다.
 */

import type { ReadonlyFooterDataProvider, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import type { HudEditorState } from "./index.js";
import type { EditorModeProvider, SegmentStateProvider } from "./types.js";
import { EDITOR_MODE_PROVIDER_KEY } from "./types.js";
import { ansi, getFgAnsiCode } from "./colors.js";
import { getPreset } from "./presets.js";
import { buildSegmentContext } from "./context.js";
import { computeResponsiveLayout } from "./layout.js";
import { WELCOME_GLOBAL_KEY } from "../welcome/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Footer 설정
// ═══════════════════════════════════════════════════════════════════════════

/** footer 상태 전용 status key (문자열 계약) */
const UA_DIRECT_FOOTER_STATUS_KEY = "ua-direct-footer";

/** 세션 요약 footer status key — summarize 확장에서 사용 */
export const SUMMARY_FOOTER_STATUS_KEY = "summary-footer";

/** Footer 등록 — ua-direct 상태 표시 + footerData/tui 참조를 state에 저장 */
export function setupFooter(ctx: any, state: HudEditorState): void {
  if (!ctx.hasUI) return;

  ctx.ui.setFooter((tui: any, _theme: Theme, footerData: ReadonlyFooterDataProvider) => {
    state.footerDataRef = footerData;
    state.tuiRef = tui;

    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        const statuses = footerData.getExtensionStatuses();
        const result: string[] = [];

        // ua-direct-footer 행 (기존 동작 유지)
        const uaStatus = statuses.get(UA_DIRECT_FOOTER_STATUS_KEY)?.trimEnd();
        if (uaStatus) {
          const lines = uaStatus.split("\n");
          result.push(...lines.map(line => centerLine(line, width)));
        }

        // 세션 요약 — 무조건 맨 마지막 행
        const summaryStatus = statuses.get(SUMMARY_FOOTER_STATUS_KEY)?.trimEnd();
        if (summaryStatus) {
          result.push(centerLine(summaryStatus, width));
        }

        return result;
      },
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 커스텀 에디터 설정
// ═══════════════════════════════════════════════════════════════════════════

/** 커스텀 에디터 팩토리 + HUD + 위젯 등록 */
export function setupCustomEditor(ctx: any, state: HudEditorState): void {
  import("@mariozechner/pi-coding-agent").then(({ CustomEditor }) => {
    let autocompleteFixed = false;

    const editorFactory = (tui: any, editorTheme: any, keybindings: any) => {
      const editor = new CustomEditor(tui, editorTheme, keybindings);
      state.currentEditor = editor;

      const originalHandleInput = editor.handleInput.bind(editor);
      editor.handleInput = (data: string) => {
        if (!autocompleteFixed && !(editor as any).autocompleteProvider) {
          autocompleteFixed = true;
          ctx.ui.setEditorComponent(editorFactory);
          state.currentEditor?.handleInput(data);
          return;
        }
        // 타이핑 시작 → welcome 디스미스 (core-welcome globalThis 경유)
        setTimeout(() => dismissWelcomeViaGlobal(), 0);
        originalHandleInput(data);
      };

      const originalRender = editor.render.bind(editor);

      // 오버라이드: 상태 바 + 테두리 + 프롬프트 접두사 + 자동완성
      editor.render = (width: number): string[] => {
        if (width < 10) {
          return originalRender(width);
        }

        // 활성 UA 모드 색상 (없으면 null → 기본 색상 유지)
        const modeProvider = getModeProvider();
        const modeId = modeProvider?.getActiveModeId() ?? null;
        const modeFg = modeId ? (modeProvider?.getModeColor(modeId) ?? null) : null;

        // 테두리: 모드 FG 색상 우선, 없으면 기본 sep 색상
        const bc = (s: string) => `${modeFg ?? getFgAnsiCode("sep")}${s}${ansi.reset}`;
        // 프롬프트 `>`: 모드 FG 색상 우선, 없으면 기본 회색
        const prompt = `${modeFg ?? ansi.getFgAnsi(200, 200, 200)}>${ansi.reset}`;

        const promptPrefix = ` ${prompt} `;
        const contPrefix = "   ";
        const contentWidth = Math.max(1, width - 3);
        const lines = originalRender(contentWidth);

        if (lines.length === 0 || !state.currentCtx) return lines;

        // 하단 테두리 찾기 (자동완성 항목은 그 아래)
        let bottomBorderIndex = lines.length - 1;
        for (let i = lines.length - 1; i >= 1; i--) {
          const stripped = lines[i]?.replace(/\x1b\[[0-9;]*m/g, "") || "";
          if (stripped.length > 0 && /^─{3,}/.test(stripped)) {
            bottomBorderIndex = i;
            break;
          }
        }

        const result: string[] = [];

        // UA 모드 배너 (활성 모드가 있을 때 — 테두리 위)
        const bannerLines = modeProvider?.getBannerLines(width) ?? [];
        if (bannerLines.length > 0) {
          result.push(...bannerLines);
        }

        // 상단 테두리
        result.push(" " + bc("─".repeat(width - 2)));

        // 콘텐츠 줄: 첫 줄 "> " 프롬프트, 이후 들여쓰기
        for (let i = 1; i < bottomBorderIndex; i++) {
          const prefix = i === 1 ? promptPrefix : contPrefix;
          result.push(`${prefix}${lines[i] || ""}`);
        }

        // 빈 에디터면 프롬프트만 표시
        if (bottomBorderIndex === 1) {
          result.push(`${promptPrefix}${" ".repeat(contentWidth)}`);
        }

        // 하단 테두리
        result.push(" " + bc("─".repeat(width - 2)));

        // 자동완성 항목
        for (let i = bottomBorderIndex + 1; i < lines.length; i++) {
          result.push(lines[i] || "");
        }

        return result;
      };

      return editor;
    };

    ctx.ui.setEditorComponent(editorFactory);

    // 모드 전환 시 에디터 리렌더 요청 (배경색 즉시 반영)
    getModeProvider()?.onStatusUpdate(() => {
      state.tuiRef?.requestRender();
    });

    // 상태바 + Secondary row 위젯 (belowEditor, footer 위)
    ctx.ui.setWidget("hud-editor-secondary", (_tui: any, theme: Theme) => {
      return {
        dispose() {},
        invalidate() {},
        render(width: number): string[] {
          if (!state.currentCtx) return [];
          const layout = getResponsiveLayout(width, theme, state);
          const lines: string[] = [];

          // 상태바 (중앙 정렬)
          if (layout.topContent) {
            lines.push(centerLine(layout.topContent, width));
          }

          // 오버플로우 세그먼트
          if (layout.secondaryContent) {
            lines.push(centerLine(layout.secondaryContent, width));
          }

          return lines;
        },
      };
    }, { placement: "belowEditor" });

    // 확장 상태 알림 위젯 (에디터 위)
    ctx.ui.setWidget("hud-editor-status", () => {
      return {
        dispose() {},
        invalidate() {},
        render(width: number): string[] {
          if (!state.currentCtx) return [];

          const statuses = state.footerDataRef?.getExtensionStatuses();
          if (!statuses || statuses.size === 0) return [];

          const notifications: string[] = [];
          for (const value of statuses.values()) {
            if (value && value.trimStart().startsWith('[')) {
              const lineContent = ` ${value}`;
              const contentWidth = visibleWidth(lineContent);
              if (contentWidth <= width) {
                notifications.push(lineContent);
              }
            }
          }

          return notifications;
        },
      };
    }, { placement: "aboveEditor" });

  });
}

// ═══════════════════════════════════════════════════════════════════════════
// globalThis 접근 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

function dismissWelcomeViaGlobal(): void {
  (globalThis as any)[WELCOME_GLOBAL_KEY]?.dismiss?.();
}

/** globalThis에서 EditorModeProvider를 가져온다 (주입 전이면 undefined). */
function getModeProvider(): EditorModeProvider | undefined {
  return (globalThis as any)[EDITOR_MODE_PROVIDER_KEY] as EditorModeProvider | undefined;
}

function centerLine(line: string, width: number): string {
  const visLen = visibleWidth(line);
  const pad = Math.max(0, Math.floor((width - visLen) / 2));
  return truncateToWidth(" ".repeat(pad) + line, width);
}

// ═══════════════════════════════════════════════════════════════════════════
// 레이아웃 캐시
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 캐시된 반응형 레이아웃을 반환하거나 새로 계산.
 * 같은 렌더 사이클(50ms 이내) 내에서 동일 너비면 캐시 재사용.
 */
function getResponsiveLayout(
  width: number,
  theme: Theme,
  state: HudEditorState,
): { topContent: string; secondaryContent: string } {
  const now = Date.now();
  const cache = state.layoutCache;

  if (cache.result && cache.width === width && now - cache.timestamp < 50) {
    return cache.result;
  }

  const presetDef = getPreset(state.config.preset);

  const provider: SegmentStateProvider = {
    footerDataRef: state.footerDataRef,
    getThinkingLevelFn: state.getThinkingLevelFn,
    sessionStartTime: state.sessionStartTime,
  };

  const segmentCtx = buildSegmentContext(state.currentCtx, theme, provider, state.config);

  cache.width = width;
  cache.result = computeResponsiveLayout(segmentCtx, presetDef, width);
  cache.timestamp = now;

  return cache.result;
}
