/**
 * fleet/carrier/taskforce-config-overlay.ts — Task Force 백엔드별 모델 설정 오버레이
 *
 * 특정 캐리어의 Task Force 모델/effort 설정을 편집하는 인터랙티브 오버레이입니다.
 * Component + Focusable 인터페이스를 구현하여 ctx.ui.custom() overlay로 렌더링합니다.
 *
 * 내비게이션: ↑↓ 백엔드 선택, Enter 모델 편집, R 리셋, Esc 닫기
 */

import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { Key, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ProviderInfo } from "../store.js";
import {
  TASKFORCE_CLI_TYPES,
  type TaskForceCliType,
} from "../taskforce/types.js";
import { notifyTaskForceConfigChange } from "./framework.js";
import { CARRIER_BG_COLORS } from "../../constants.js";

// ─── 타입 ────────────────────────────────────────────────

/** 백엔드 한 줄 표시 데이터 */
interface BackendEntry {
  cliType: TaskForceCliType;
  displayName: string;
  color: string;
  model: string;
  effort: string | null;
  /** false = origin(기본값), true = 커스텀 설정 존재 */
  isCustom: boolean;
}

/** 콜백 인터페이스 */
export interface TaskForceOverlayCallbacks {
  getAvailableModels: (cliType: string) => ProviderInfo;
  getEffortLevels: (cliType: string) => string[] | null;
  getDefaultBudgetTokens: (effort: string) => number;
  /** 백엔드별 현재 설정 반환 (origin 포함) */
  getBackendConfig: (cliType: string) => { model: string; effort: string | null; isCustom: boolean };
  /** 백엔드 설정 저장 */
  updateBackendConfig: (
    cliType: string,
    selection: { model: string; effort?: string; budgetTokens?: number },
  ) => Promise<void>;
  /** 백엔드 설정 초기화 (origin으로) */
  resetBackendConfig: (cliType: string) => void;
}

type OverlayMode = "browse" | "model" | "effort" | "saving";

// ─── 상수 ────────────────────────────────────────────────

const ANSI_RESET = "\x1b[0m";
const ANSI_DIM = "\x1b[38;2;120;120;120m";
const ANSI_ACCENT = "\x1b[38;2;100;180;255m";

const CLI_COLORS: Record<string, string> = {
  claude: "\x1b[38;2;255;149;0m",
  codex: "\x1b[38;2;169;169;169m",
  gemini: "\x1b[38;2;66;133;244m",
};

const CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
};

// ─── 컴포넌트 ────────────────────────────────────────────

export class TaskForceConfigOverlay implements Component, Focusable {
  focused = false;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly carrierDisplayName: string;
  private readonly callbacks: TaskForceOverlayCallbacks;
  private readonly done: () => void;

  private selectedIndex = 0;
  private mode: OverlayMode = "browse";
  private editCursor = 0;
  private pendingModelId: string | null = null;
  private feedbackMessage: string | null = null;

  constructor(
    tui: TUI,
    theme: Theme,
    _carrierId: string,
    carrierDisplayName: string,
    callbacks: TaskForceOverlayCallbacks,
    done: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.carrierDisplayName = carrierDisplayName;
    this.callbacks = callbacks;
    this.done = done;
  }

  handleInput(data: string): void {
    if (this.mode === "saving") return;

    if (matchesKey(data, Key.escape)) {
      if (this.mode === "browse") {
        this.done();
      } else {
        this.cancelEdit();
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      if (this.mode === "browse") {
        this.moveSelection(-1);
      } else {
        this.moveEditCursor(-1);
      }
      return;
    }

    if (matchesKey(data, Key.down)) {
      if (this.mode === "browse") {
        this.moveSelection(1);
      } else {
        this.moveEditCursor(1);
      }
      return;
    }

    // R 키: 선택된 백엔드 설정 리셋 (browse 모드)
    if (this.mode === "browse" && data === "r") {
      this.resetSelectedBackend();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.mode === "browse") {
        this.startModelEdit();
      } else if (this.mode === "model") {
        this.confirmModelEdit();
      } else if (this.mode === "effort") {
        this.confirmEffortEdit();
      }
    }
  }

  render(width: number): string[] {
    width = Math.max(40, width);

    const border = (s: string) => this.theme.fg("border", s);
    const dim = (s: string) => this.theme.fg("dim", s);
    const innerWidth = width - 4;

    /** 한 행 렌더링. bgColor가 주어지면 border 안쪽 전체에 배경색을 적용합니다. */
    const row = (content: string, bgColor?: string) => {
      const contentWidth = visibleWidth(content);
      // 배경색 래핑: content 내 ANSI 리셋마다 배경색을 재삽입하여 전체 행에 색상 유지
      const wrapBg = (inner: string) =>
        bgColor
          ? bgColor + " " + inner.replaceAll(ANSI_RESET, ANSI_RESET + bgColor) + " " + ANSI_RESET
          : undefined;
      if (contentWidth > innerWidth) {
        let visible = 0;
        let cutIdx = 0;
        for (let i = 0; i < content.length; i++) {
          if (content[i] === "\x1b") {
            const end = content.indexOf("m", i);
            if (end !== -1) { i = end; continue; }
          }
          visible++;
          if (visible >= innerWidth - 1) { cutIdx = i + 1; break; }
        }
        const truncated = content.slice(0, cutIdx) + ANSI_RESET + dim("\u2026");
        const truncPad = Math.max(0, innerWidth - visibleWidth(truncated));
        const bg = wrapBg(truncated + " ".repeat(truncPad));
        if (bg) return border("\u2502") + bg + border("\u2502");
        return border("\u2502 ") + truncated + " ".repeat(truncPad) + border(" \u2502");
      }
      const pad = Math.max(0, innerWidth - contentWidth);
      const bg = wrapBg(content + " ".repeat(pad));
      if (bg) return border("\u2502") + bg + border("\u2502");
      return border("\u2502 ") + content + " ".repeat(pad) + border(" \u2502");
    };

    const emptyRow = () => row("");
    const separator = () => border("├" + "─".repeat(width - 2) + "┤");

    // ── 제목 ──
    const title = ` Task Force Config — ${this.carrierDisplayName} `;
    const titleLen = title.length;
    const sideLen = Math.max(0, Math.floor((width - 2 - titleLen) / 2));
    const rightLen = Math.max(0, width - 2 - sideLen - titleLen);
    const topBorder = border("╭" + "─".repeat(sideLen) + title + "─".repeat(rightLen) + "╮");

    const lines: string[] = [];
    lines.push(topBorder);
    lines.push(emptyRow());

    // ── 백엔드 행 ──
    const entries = this.buildBackendEntries();

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const isSelected = i === this.selectedIndex;

      const selectedPrefix = isSelected
        ? `${entry.color}▸${ANSI_RESET}`
        : " ";

      const modelStr = entry.isCustom ? entry.model : dim(entry.model);
      const effortStr = entry.effort
        ? ` ${dim("·")} ${entry.isCustom ? entry.effort : dim(entry.effort)}`
        : "";
      const configTag = entry.isCustom
        ? `  ${ANSI_ACCENT}(custom)${ANSI_RESET}`
        : `  ${ANSI_DIM}(origin)${ANSI_RESET}`;

      const content = `  ${selectedPrefix} ${entry.color}${entry.displayName}${ANSI_RESET}  ${modelStr}${effortStr}${configTag}`;
      lines.push(row(content, isSelected ? CARRIER_BG_COLORS[entry.cliType] : undefined));

      // 모델 드롭다운 (선택된 행, model 편집 모드)
      if (isSelected && this.mode === "model") {
        const models = this.callbacks.getAvailableModels(entry.cliType).models;
        for (let j = 0; j < models.length; j++) {
          const model = models[j]!;
          const cursor = j === this.editCursor ? `${entry.color}▸${ANSI_RESET}` : " ";
          const marker = model.modelId === entry.model ? "●" : "○";
          lines.push(row(`      ${cursor} ${marker} ${model.modelId}  ${dim(model.name)}`));
        }
      }

      // effort 드롭다운 (선택된 행, effort 편집 모드)
      if (isSelected && this.mode === "effort") {
        const effortLevels = this.callbacks.getEffortLevels(entry.cliType) ?? [];
        for (let j = 0; j < effortLevels.length; j++) {
          const level = effortLevels[j]!;
          const cursor = j === this.editCursor ? `${entry.color}▸${ANSI_RESET}` : " ";
          const marker = level === (entry.effort ?? "") ? "●" : "○";
          lines.push(row(`      ${cursor} ${marker} ${level}`));
        }
      }
    }

    lines.push(emptyRow());

    if (this.feedbackMessage) {
      const feedbackColor = this.feedbackMessage.startsWith("저장 실패") ? "warning" : "accent";
      lines.push(row(this.theme.fg(feedbackColor, this.feedbackMessage)));
      lines.push(emptyRow());
    }

    lines.push(separator());
    lines.push(row(dim(this.getFooterHint())));
    lines.push(border("╰" + "─".repeat(width - 2) + "╯"));

    return lines;
  }

  invalidate(): void {
    // render마다 최신 데이터를 직접 조회하므로 별도 캐시 없음
  }

  dispose(): void {
    // 정리할 리소스 없음
  }

  // ─── 내부 헬퍼 ──────────────────────────────────────────

  private buildBackendEntries(): BackendEntry[] {
    return TASKFORCE_CLI_TYPES.map((cliType) => {
      const config = this.callbacks.getBackendConfig(cliType);
      return {
        cliType,
        displayName: CLI_DISPLAY_NAMES[cliType] ?? cliType,
        color: CLI_COLORS[cliType] ?? "",
        model: config.model,
        effort: config.effort,
        isCustom: config.isCustom,
      };
    });
  }

  private getSelectedEntry(): BackendEntry | null {
    const entries = this.buildBackendEntries();
    return entries[this.selectedIndex] ?? null;
  }

  private moveSelection(delta: number): void {
    const total = TASKFORCE_CLI_TYPES.length;
    this.selectedIndex = (this.selectedIndex + delta + total) % total;
    this.feedbackMessage = null;
  }

  private moveEditCursor(delta: number): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    const options = this.getEditOptions(entry);
    if (options.length === 0) return;
    this.editCursor = (this.editCursor + delta + options.length) % options.length;
    this.feedbackMessage = null;
  }

  private getEditOptions(entry: BackendEntry): Array<{ value: string }> {
    if (this.mode === "model") {
      return this.callbacks.getAvailableModels(entry.cliType).models.map((m) => ({ value: m.modelId }));
    }
    if (this.mode === "effort") {
      return (this.callbacks.getEffortLevels(entry.cliType) ?? []).map((level) => ({ value: level }));
    }
    return [];
  }

  private startModelEdit(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    const models = this.callbacks.getAvailableModels(entry.cliType).models;
    if (models.length === 0) {
      this.feedbackMessage = `${entry.displayName}: 선택 가능한 모델이 없습니다.`;
      return;
    }

    this.mode = "model";
    this.pendingModelId = null;
    this.editCursor = Math.max(0, models.findIndex((m) => m.modelId === entry.model));
    this.feedbackMessage = null;
  }

  private confirmModelEdit(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    const models = this.callbacks.getAvailableModels(entry.cliType).models;
    const selectedModel = models[this.editCursor];
    if (!selectedModel) return;

    this.pendingModelId = selectedModel.modelId;

    const effortLevels = this.callbacks.getEffortLevels(entry.cliType);
    if (!effortLevels || effortLevels.length === 0) {
      // effort 미지원 (Gemini 등) — 모델만 저장
      void this.commitSelection(entry, { model: selectedModel.modelId });
      return;
    }

    // effort 선택으로 전환
    const currentEffort = entry.effort ?? effortLevels[0] ?? "";
    this.mode = "effort";
    this.editCursor = Math.max(0, effortLevels.findIndex((l) => l === currentEffort));
  }

  private confirmEffortEdit(): void {
    const entry = this.getSelectedEntry();
    if (!entry || !this.pendingModelId) return;

    const effortLevels = this.callbacks.getEffortLevels(entry.cliType) ?? [];
    const selectedEffort = effortLevels[this.editCursor];
    if (!selectedEffort) return;

    const selection: { model: string; effort?: string; budgetTokens?: number } = {
      model: this.pendingModelId,
      effort: selectedEffort,
    };

    if (entry.cliType === "claude" && selectedEffort !== "none") {
      selection.budgetTokens = this.callbacks.getDefaultBudgetTokens(selectedEffort);
    }

    void this.commitSelection(entry, selection);
  }

  private resetSelectedBackend(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    if (!entry.isCustom) {
      this.feedbackMessage = `${entry.displayName}은 이미 origin 설정입니다.`;
      this.tui.requestRender();
      return;
    }

    this.callbacks.resetBackendConfig(entry.cliType);
    notifyTaskForceConfigChange();
    this.feedbackMessage = `${entry.displayName} 설정을 origin으로 초기화했습니다.`;
    this.tui.requestRender();
  }

  private cancelEdit(): void {
    this.resetEditState();
    this.feedbackMessage = null;
  }

  private async commitSelection(
    entry: BackendEntry,
    selection: { model: string; effort?: string; budgetTokens?: number },
  ): Promise<void> {
    const cliType = toTaskForceCliType(entry.cliType);
    if (!cliType) {
      this.failSelection(`지원하지 않는 backend입니다 (${entry.cliType}).`);
      return;
    }

    const modelIds = new Set(this.callbacks.getAvailableModels(cliType).models.map((model) => model.modelId));
    if (!modelIds.has(selection.model)) {
      this.failSelection(`${entry.displayName} 모델 선택이 유효하지 않습니다.`);
      return;
    }

    const effortLevels = this.callbacks.getEffortLevels(cliType);
    if (effortLevels && selection.effort && !effortLevels.includes(selection.effort)) {
      this.failSelection(`${entry.displayName} effort 선택이 유효하지 않습니다.`);
      return;
    }

    if (!effortLevels) {
      delete selection.effort;
      delete selection.budgetTokens;
    } else if (cliType !== "claude") {
      delete selection.budgetTokens;
    }

    this.mode = "saving";
    this.tui.requestRender();

    try {
      await this.callbacks.updateBackendConfig(cliType, selection);
      notifyTaskForceConfigChange();
      this.feedbackMessage = `${entry.displayName} 설정을 저장했습니다.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.feedbackMessage = `저장 실패: ${message}`;
    } finally {
      this.resetEditState();
      this.tui.requestRender();
    }
  }

  private failSelection(message: string): void {
    this.feedbackMessage = `저장 실패: ${message}`;
    this.resetEditState();
    this.tui.requestRender();
  }

  private getFooterHint(): string {
    if (this.mode === "saving") return "저장 중...";
    if (this.mode === "browse") return "↑↓ select  Enter edit  R reset  Esc close";
    return "↑↓ select  Enter confirm  Esc cancel";
  }

  private resetEditState(): void {
    this.mode = "browse";
    this.pendingModelId = null;
    this.editCursor = 0;
  }
}

function toTaskForceCliType(value: string): TaskForceCliType | null {
  return (TASKFORCE_CLI_TYPES as readonly string[]).includes(value) ? value as TaskForceCliType : null;
}
