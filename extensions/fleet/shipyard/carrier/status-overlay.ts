/**
 * status-overlay.ts — 캐리어 함대 현황 오버레이 컴포넌트
 *
 * Alt+O로 호출되며, 등록된 모든 캐리어의 모델·추론 설정을 표시/편집합니다.
 * Component + Focusable 인터페이스를 구현하여 ctx.ui.custom() overlay로 렌더링합니다.
 *
 * 그룹 헤더 우측에 service-status 결과를 표시합니다.
 * 매 render() 호출마다 getSnapshots()를 통해 최신 상태를 반영합니다.
 */

import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { Key, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { HealthStatus, ProviderKey, ServiceSnapshot } from "../../../core/agent/types.js";
import { CARRIER_BG_COLORS } from "../../constants.js";

type CarrierCliType = ProviderKey;

/** 캐리어 한 줄 표시 데이터 */
export interface CarrierStatusEntry {
  /** 고유 캐리어 식별자 */
  carrierId: string;
  /** 슬롯 번호 (1-8) */
  slot: number;
  /** CLI 타입 (claude/codex/gemini) */
  cliType: CarrierCliType;
  /** 표시 이름 (e.g., 'Genesis') */
  displayName: string;
  /** ANSI 색상 코드 */
  color: string;
  /** CLI 표시 이름 (e.g., 'Claude') */
  cliDisplayName: string;
  /** 현재 모델 ID */
  model: string;
  /** 기본 모델 여부 (설정된 모델이 없을 때 true) */
  isDefault: boolean;
  /** 추론 레벨 (e.g., 'low', 'medium', 'high') */
  effort: string | null;
  /** thinking budget (Claude 전용) */
  budgetTokens: number | null;
  /** 함선 역할 한줄 요약 (e.g., 'Chief Architect') */
  role: string | null;
  /** carrier 설명 전문 */
  roleDescription: string | null;
  /** sortie 가용 여부 (false면 sortie 위임 불가, direct 모드는 가능) */
  isSortieEnabled: boolean;
}

/** CLI 타입별 그룹 */
export interface CarrierStatusGroup {
  /** 그룹 헤더 (e.g., 'Claude') */
  header: string;
  /** 그룹 색상 */
  color: string;
  /** 프로바이더 키 (service-status 조회용) */
  providerKey: ProviderKey;
  /** 소속 캐리어 목록 */
  entries: CarrierStatusEntry[];
}

/** 서비스 스냅샷 공급 함수 타입 */
export type ServiceSnapshotGetter = () => ServiceSnapshot[];

export interface CarrierOverlayCallbacks {
  getAvailableModels: (cliType: CarrierCliType) => {
    defaultModel: string;
    models: Array<{ modelId: string; name: string }>;
    reasoningEffort: { supported: boolean; levels?: string[]; default?: string };
  };
  getEffortLevels: (cliType: CarrierCliType) => string[] | null;
  getDefaultBudgetTokens: (effort: string) => number;
  updateModelSelection: (
    carrierId: string,
    selection: { model: string; effort?: string; budgetTokens?: number },
  ) => Promise<void>;
  onModelUpdated: () => void;
  /** sortie 가용 상태 토글 (없으면 토글 기능 비활성) */
  toggleSortieEnabled?: (carrierId: string) => void;
  /** Task Force 설정 오버레이 열기 (없으면 T키 비활성) */
  openTaskForce?: (carrierId: string) => void;
  /** 해당 캐리어에 커스텀 TF 설정이 있는지 여부 */
  hasTaskForceConfig?: (carrierId: string) => boolean;
  /** cliType 동적 변경 (없으면 c키 비활성) */
  updateCliType?: (carrierId: string, newCliType: string) => void;
  /** 소스레벨 기본 cliType 조회 */
  getDefaultCliType?: (carrierId: string) => string;
}

type OverlayMode = "browse" | "model" | "effort" | "cliType" | "saving";

interface FlatCarrierEntry {
  group: CarrierStatusGroup;
  entry: CarrierStatusEntry;
}

const ANSI_RESET = "\x1b[0m";
/** sortie 비활성 캐리어용 dim 색상 */
const ANSI_DIM = "\x1b[38;2;100;100;100m";
/** 라벨 컬럼 너비 */
const SLOT_WIDTH = 4;
const NAME_WIDTH = 12;

/** 서비스 상태 약색 텍스트 */
const STATUS_TEXT: Record<HealthStatus, string> = {
  operational: "OP",
  partial_outage: "DEG",
  major_outage: "OUT",
  maintenance: "MNT",
  unknown: "UNK",
};

/** 서비스 상태 ANSI 색상 */
const STATUS_COLORS: Record<HealthStatus, string> = {
  operational: "\x1b[38;2;80;200;120m",
  partial_outage: "\x1b[38;2;220;180;50m",
  major_outage: "\x1b[38;2;220;80;80m",
  maintenance: "\x1b[38;2;200;170;60m",
  unknown: "\x1b[38;2;120;120;120m",
};

export class CarrierStatusOverlay implements Component, Focusable {
  focused = false;

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly groups: CarrierStatusGroup[];
  private readonly getSnapshots: ServiceSnapshotGetter;
  private readonly callbacks: CarrierOverlayCallbacks;
  private readonly done: () => void;

  private selectedIndex = 0;
  private expandedCarrierId: string | null = null;
  private mode: OverlayMode = "browse";
  private editCursor = 0;
  private pendingModelId: string | null = null;
  private feedbackMessage: string | null = null;

  constructor(
    tui: TUI,
    theme: Theme,
    groups: CarrierStatusGroup[],
    getSnapshots: ServiceSnapshotGetter,
    callbacks: CarrierOverlayCallbacks,
    done: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.groups = groups;
    this.getSnapshots = getSnapshots;
    this.callbacks = callbacks;
    this.done = done;
    this.selectedIndex = Math.max(0, Math.min(this.getFlatEntries().length - 1, 0));
  }

  handleInput(data: string): void {
    if (this.mode === "saving") {
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, Key.alt("o"))) {
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

    if (this.mode === "browse" && matchesKey(data, Key.tab)) {
      this.toggleDetails();
      return;
    }

    // `t` 키: Task Force 설정 오버레이 열기
    if (this.mode === "browse" && data === "t") {
      this.handleTaskForce();
      return;
    }

    // `c` 키: cliType 변경 모드 진입
    if (this.mode === "browse" && data === "c") {
      this.startCliTypeEdit();
      return;
    }

    // `d` 키: sortie 가용 상태 토글
    if (this.mode === "browse" && data === "d") {
      this.toggleSortieState();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.mode === "browse") {
        this.startModelEdit();
      } else if (this.mode === "model") {
        this.confirmModelEdit();
      } else if (this.mode === "effort") {
        this.confirmEffortEdit();
      } else if (this.mode === "cliType") {
        this.confirmCliTypeEdit();
      }
    }
  }

  render(width: number): string[] {
    width = Math.max(40, width);

    const border = (s: string) => this.theme.fg("border", s);
    const dim = (s: string) => this.theme.fg("dim", s);

    const innerWidth = width - 4;
    const flatEntries = this.getFlatEntries();

    // ── 헬퍼 ──

    /** 좌우 border 안에 콘텐츠를 넣은 한 줄 (폭 초과 시 잘라냄) */
    /** 한 행 렌더링. bgColor가 주어지면 border 안쪽 전체에 배경색을 적용합니다. */
    const row = (content: string, bgColor?: string) => {
      const contentWidth = visibleWidth(content);
      // 배경색 래핑: content 내 ANSI 리셋마다 배경색을 재삽입하여 전체 행에 색상 유지
      const wrapBg = (inner: string) =>
        bgColor
          ? bgColor + " " + inner.replaceAll(ANSI_RESET, ANSI_RESET + bgColor) + " " + ANSI_RESET
          : undefined;
      if (contentWidth > innerWidth) {
        // ANSI 시퀀스를 보존하며 표시 폭 기준으로 잘라냄
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

    /** 구분선 (├───┤) */
    const separator = () => border("├" + "─".repeat(width - 2) + "┤");

    // ── 제목 행 ──

    const title = " Carrier Status ";
    const titleLen = title.length;
    const sideLen = Math.max(0, Math.floor((width - 2 - titleLen) / 2));
    const rightLen = Math.max(0, width - 2 - sideLen - titleLen);
    const topBorder = border("╭" + "─".repeat(sideLen) + title + "─".repeat(rightLen) + "╮");

    // ── 조립 ──

    const lines: string[] = [];
    lines.push(topBorder);
    lines.push(emptyRow());

    // 매 render마다 최신 스냅샷 조회 (백그라운드 갱신 반영)
    const snapshots = this.getSnapshots();

    for (let gi = 0; gi < this.groups.length; gi++) {
      const group = this.groups[gi];

      // 그룹 헤더 + 서비스 상태
      const snapshot = snapshots.find((s) => s.provider === group.providerKey);
      const statusToken = snapshot
        ? `  ${STATUS_COLORS[snapshot.status]}${STATUS_TEXT[snapshot.status]}${ANSI_RESET}`
        : dim("  ...");
      lines.push(row(`  ${group.color}◇${ANSI_RESET} ${group.color}${group.header}${ANSI_RESET}${statusToken}`));
      lines.push(emptyRow());

      // 캐리어 행들 (1캐리어 = 1라인)
      for (const entry of group.entries) {
        const flatIndex = flatEntries.findIndex((item) => item.entry.carrierId === entry.carrierId);
        const isSelected = flatIndex === this.selectedIndex;
        const slotStr = `#${entry.slot}`;
        const slotPad = " ".repeat(Math.max(0, SLOT_WIDTH - slotStr.length));

        // cliType이 defaultCliType과 다르면 이름 뒤에 ~cliType 표시
        const defaultCli = this.callbacks.getDefaultCliType?.(entry.carrierId);
        const cliOverrideSuffix = defaultCli && entry.cliType !== defaultCli
          ? `${ANSI_DIM}~${entry.cliType}${ANSI_RESET}`
          : "";
        const nameVisualWidth = entry.displayName.length + (defaultCli && entry.cliType !== defaultCli ? 1 + entry.cliType.length : 0);
        const namePad = " ".repeat(Math.max(0, NAME_WIDTH - nameVisualWidth));
        // sortie 비활성 캐리어: 이름·모델·역할 모두 dim 처리하여 비활성 상태를 직관적으로 전달
        const isDisabled = !entry.isSortieEnabled;
        const nameColor = isDisabled ? ANSI_DIM : entry.color;
        const coloredName = `${nameColor}${entry.displayName}${ANSI_RESET}`;

        // 모델 표시 (기본 모델이면 dim, 비활성이면 항상 dim)
        const modelStr = (entry.isDefault || isDisabled)
          ? dim(entry.model)
          : entry.model;

        // effort 표시
        const effortStr = entry.effort
          ? dim(" · ") + (isDisabled ? dim(entry.effort) : entry.effort)
          : "";

        // sortie 비활성 태그
        const sortieTag = isDisabled
          ? `  \x1b[38;2;255;80;80m✕ sortie off${ANSI_RESET}`
          : "";

        // Task Force 커스텀 설정 태그
        const tfTag = this.callbacks.hasTaskForceConfig?.(entry.carrierId)
          ? `  \x1b[38;2;100;180;255m[TF]${ANSI_RESET}`
          : "";

        // 역할 (있으면 모델·effort 뒤에 dim 괄호로 표시)
        const roleStr = entry.role ? dim(`  (${entry.role})`) : "";
        const selectedPrefix = isSelected
          ? `${isDisabled ? ANSI_DIM : entry.color}▸${ANSI_RESET}`
          : " ";

        const content = `  ${selectedPrefix} ${dim(slotStr)}${slotPad}${coloredName}${cliOverrideSuffix}${namePad}${modelStr}${effortStr}${roleStr}${sortieTag}${tfTag}`;
        lines.push(row(content, isSelected ? CARRIER_BG_COLORS[entry.cliType] : undefined));

        if (isSelected && this.mode !== "browse" && this.mode !== "saving") {
          const currentValue = this.mode === "cliType"
            ? entry.cliType
            : this.mode === "model"
              ? entry.model
              : entry.effort ?? this.getDefaultEffort(entry.cliType);
          const options = this.getEditOptions(entry);

          for (let i = 0; i < options.length; i++) {
            const option = options[i]!;
            const cursor = i === this.editCursor ? `${entry.color}▸${ANSI_RESET}` : " ";
            const marker = option.value === currentValue ? "●" : "○";
            const line = `      ${cursor} ${marker} ${option.label}`;
            lines.push(row(line));
          }
        }

        if (isSelected && this.expandedCarrierId === entry.carrierId) {
          const detailRows = this.buildDetailRows(entry, innerWidth);
          for (const detailRow of detailRows) {
            lines.push(row(detailRow));
          }
        }
      }

      // 그룹 간 빈 줄 (마지막 그룹 제외)
      if (gi < this.groups.length - 1) {
        lines.push(emptyRow());
      }
    }

    // 그룹이 하나도 없을 때
    if (this.groups.length === 0) {
      lines.push(row(dim("등록된 캐리어가 없습니다.")));
    }

    lines.push(emptyRow());

    if (this.feedbackMessage) {
      const feedbackColor = this.feedbackMessage.startsWith("저장 실패") ? "warning" : "accent";
      lines.push(row(this.theme.fg(feedbackColor, this.feedbackMessage)));
      lines.push(emptyRow());
    }

    // 하단
    lines.push(separator());
    lines.push(row(dim(this.getFooterHint())));
    lines.push(border("╰" + "─".repeat(width - 2) + "╯"));

    return lines;
  }

  invalidate(): void {
    // 매 render에서 최신 groups/snapshots를 직접 참조하므로 별도 캐시가 없습니다.
  }

  dispose(): void {
    // 정리할 리소스 없음
  }

  private getFlatEntries(): FlatCarrierEntry[] {
    return this.groups.flatMap((group) => group.entries.map((entry) => ({ group, entry })));
  }

  private getSelectedEntry(): CarrierStatusEntry | null {
    const flatEntries = this.getFlatEntries();
    if (flatEntries.length === 0) return null;
    return flatEntries[this.selectedIndex]?.entry ?? null;
  }

  private moveSelection(delta: number): void {
    const flatEntries = this.getFlatEntries();
    if (flatEntries.length === 0) return;
    const total = flatEntries.length;
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

  private toggleDetails(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    this.expandedCarrierId = this.expandedCarrierId === entry.carrierId ? null : entry.carrierId;
    this.feedbackMessage = null;
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
    this.editCursor = Math.max(0, models.findIndex((model) => model.modelId === entry.model));
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
      void this.commitSelection(entry, { model: selectedModel.modelId });
      return;
    }

    const currentEffort = entry.effort ?? this.getDefaultEffort(entry.cliType);
    this.mode = "effort";
    this.editCursor = Math.max(0, effortLevels.findIndex((level) => level === currentEffort));
  }

  private confirmEffortEdit(): void {
    const entry = this.getSelectedEntry();
    if (!entry || !this.pendingModelId) return;

    const effortLevels = this.callbacks.getEffortLevels(entry.cliType) ?? [];
    const selectedEffort = effortLevels[this.editCursor];
    if (!selectedEffort) return;

    const selection: { model: string; effort?: string; budgetTokens?: number } = {
      model: this.pendingModelId,
    };

    selection.effort = selectedEffort;
    if (entry.cliType === "claude" && selectedEffort !== "none") {
      selection.budgetTokens = this.callbacks.getDefaultBudgetTokens(selectedEffort);
    }

    void this.commitSelection(entry, selection);
  }

  private handleTaskForce(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    if (!this.callbacks.openTaskForce) return;
    this.callbacks.openTaskForce(entry.carrierId);
  }

  private toggleSortieState(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    if (!this.callbacks.toggleSortieEnabled) return;

    this.callbacks.toggleSortieEnabled(entry.carrierId);
    // UI 상태 즉시 반영
    entry.isSortieEnabled = !entry.isSortieEnabled;
    this.feedbackMessage = entry.isSortieEnabled
      ? `${entry.displayName} sortie 활성화됨`
      : `${entry.displayName} sortie 비활성화됨`;
    this.tui.requestRender();
  }

  private startCliTypeEdit(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;
    if (!this.callbacks.updateCliType) return;

    this.mode = "cliType";
    const options = this.getEditOptions(entry);
    this.editCursor = Math.max(0, options.findIndex((o) => o.value === entry.cliType));
    this.feedbackMessage = null;
  }

  private confirmCliTypeEdit(): void {
    const entry = this.getSelectedEntry();
    if (!entry) return;

    const options = this.getEditOptions(entry);
    const selected = options[this.editCursor];
    if (!selected) return;

    if (selected.value !== entry.cliType) {
      this.callbacks.updateCliType!(entry.carrierId, selected.value);
      entry.cliType = selected.value as CarrierCliType;
      this.feedbackMessage = `${entry.displayName} CLI → ${selected.value}`;
    }

    this.mode = "browse";
    this.editCursor = 0;
    this.tui.requestRender();
  }

  private cancelEdit(): void {
    this.mode = "browse";
    this.pendingModelId = null;
    this.editCursor = 0;
    this.feedbackMessage = null;
  }

  private getEditOptions(entry: CarrierStatusEntry): Array<{ value: string; label: string }> {
    if (this.mode === "model") {
      return this.callbacks.getAvailableModels(entry.cliType).models.map((model) => ({
        value: model.modelId,
        label: `${model.modelId} · ${model.name}`,
      }));
    }

    if (this.mode === "effort") {
      return (this.callbacks.getEffortLevels(entry.cliType) ?? []).map((level) => ({
        value: level,
        label: level,
      }));
    }

    if (this.mode === "cliType") {
      const defaultCli = this.callbacks.getDefaultCliType?.(entry.carrierId) ?? entry.cliType;
      return (["claude", "codex", "gemini"] as const).map((cli) => ({
        value: cli,
        label: cli !== defaultCli ? `${cli} (default: ${defaultCli})` : cli,
      }));
    }

    return [];
  }

  private getDefaultEffort(cliType: CarrierCliType): string | null {
    const provider = this.callbacks.getAvailableModels(cliType);
    return provider.reasoningEffort.default ?? null;
  }

  private buildDetailRows(entry: CarrierStatusEntry, innerWidth: number): string[] {
    const provider = this.callbacks.getAvailableModels(entry.cliType);
    const modelLabel = provider.models.find((model) => model.modelId === entry.model)?.name ?? entry.model;
    const description = entry.roleDescription ?? "-";
    const labelWidth = 8;
    const valueWidth = Math.max(10, innerWidth - 10 - labelWidth);
    const lines: string[] = [];

    const detailLine = (label: string, value: string) => {
      const paddedLabel = label.padEnd(labelWidth, " ");
      lines.push(`      ${this.theme.fg("dim", paddedLabel)} ${value}`);
    };

    detailLine("model", `${modelLabel} [${entry.model}]`);
    detailLine("cli", `${entry.cliDisplayName} (${entry.cliType})`);
    detailLine("role", entry.role ?? "-");
    if (entry.cliType === "claude") {
      detailLine("budget", entry.budgetTokens != null ? String(entry.budgetTokens) : "-");
    }

    const wrappedDescription = this.wrapText(description, valueWidth);
    for (let i = 0; i < wrappedDescription.length; i++) {
      const label = i === 0 ? "desc" : "";
      detailLine(label, wrappedDescription[i]!);
    }

    return lines;
  }

  private wrapText(text: string, maxWidth: number): string[] {
    if (!text.trim()) return ["-"];

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (visibleWidth(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = word;
        continue;
      }

      lines.push(word.slice(0, maxWidth));
    }

    if (current) lines.push(current);
    return lines;
  }

  private getFooterHint(): string {
    if (this.mode === "saving") {
      return "저장 중...";
    }

    if (this.mode === "browse") {
      return "↑↓ select  Enter edit  c cli  T task force  d sortie toggle  Tab detail  Esc close";
    }

    return "↑↓ select  Enter confirm  Esc cancel";
  }

  private async commitSelection(
    entry: CarrierStatusEntry,
    selection: { model: string; effort?: string; budgetTokens?: number },
  ): Promise<void> {
    const previous = {
      model: entry.model,
      isDefault: entry.isDefault,
      effort: entry.effort,
      budgetTokens: entry.budgetTokens,
    };

    this.mode = "saving";
    this.applySelection(entry, selection);

    try {
      await this.callbacks.updateModelSelection(entry.carrierId, selection);
      this.callbacks.onModelUpdated();
      this.feedbackMessage = `${entry.displayName} 모델 설정을 저장했습니다.`;
    } catch (error) {
      entry.model = previous.model;
      entry.isDefault = previous.isDefault;
      entry.effort = previous.effort;
      entry.budgetTokens = previous.budgetTokens;
      const message = error instanceof Error ? error.message : String(error);
      this.feedbackMessage = `저장 실패: ${message}`;
    } finally {
      this.mode = "browse";
      this.pendingModelId = null;
      this.editCursor = 0;
      this.tui.requestRender();
    }
  }

  private applySelection(
    entry: CarrierStatusEntry,
    selection: { model: string; effort?: string; budgetTokens?: number },
  ): void {
    entry.model = selection.model;
    entry.isDefault = false;
    entry.effort = selection.effort ?? null;
    entry.budgetTokens = selection.budgetTokens ?? null;
  }
}
