import type { ReadonlyFooterDataProvider, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";

// ═══════════════════════════════════════════════════════════════════════════
// 색상 타입
// ═══════════════════════════════════════════════════════════════════════════

// pi 테마 색상 이름 또는 커스텀 hex 색상
export type ColorValue = ThemeColor | `#${string}`;

// 시맨틱 색상 이름
export type SemanticColor =
  | "pi"
  | "model"
  | "path"
  | "git"
  | "gitDirty"
  | "gitClean"
  | "thinking"
  | "thinkingHigh"
  | "context"
  | "contextWarn"
  | "contextError"
  | "cost"
  | "tokens"
  | "separator"
  | "border";

// 시맨틱 이름 → 실제 색상 매핑
export type ColorScheme = Partial<Record<SemanticColor, ColorValue>>;

// ═══════════════════════════════════════════════════════════════════════════
// 세그먼트 / 프리셋 타입
// ═══════════════════════════════════════════════════════════════════════════

export type StatusLineSegmentId =
  | "pi"
  | "model"
  | "path"
  | "git"
  | "subagents"
  | "token_in"
  | "token_out"
  | "token_total"
  | "cost"
  | "context_pct"
  | "context_total"
  | "time_spent"
  | "time"
  | "session"
  | "hostname"
  | "cache_read"
  | "cache_write"
  | "thinking"
  | "extension_statuses";

export type StatusLineSeparatorStyle =
  | "arrow"
  | "arrow-thin"
  | "slash"
  | "pipe"
  | "block"
  | "none"
  | "ascii"
  | "dot"
  | "chevron"
  | "star";

export type StatusLinePreset = "sbluemin";

export interface StatusLineSegmentOptions {
  pi?: { showUser?: boolean; label?: string };
  model?: { showThinkingLevel?: boolean };
  path?: {
    mode?: "basename" | "abbreviated" | "full";
    maxLength?: number;
  };
  git?: { showBranch?: boolean; showStaged?: boolean; showUnstaged?: boolean; showUntracked?: boolean };
  time?: { format?: "12h" | "24h"; showSeconds?: boolean };
}

export interface PresetDef {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments?: StatusLineSegmentId[];
  separator: StatusLineSeparatorStyle;
  segmentOptions?: StatusLineSegmentOptions;
  colors?: ColorScheme;
}

export interface SeparatorDef {
  left: string;
  right: string;
  endCaps?: {
    left: string;
    right: string;
    useBgAsFg: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Git / 사용량 / 세그먼트 컨텍스트
// ═══════════════════════════════════════════════════════════════════════════

export interface GitStatus {
  branch: string | null;
  staged: number;
  unstaged: number;
  untracked: number;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SegmentContext {
  model: { id: string; name?: string; reasoning?: boolean; contextWindow?: number } | undefined;
  thinkingLevel: string;
  sessionId: string | undefined;
  usageStats: UsageStats;
  contextPercent: number;
  contextWindow: number;
  autoCompactEnabled: boolean;
  usingSubscription: boolean;
  sessionStartTime: number;
  git: GitStatus;
  extensionStatuses: ReadonlyMap<string, string>;
  options: StatusLineSegmentOptions;
  theme: Theme;
  colors: ColorScheme;
}

export interface RenderedSegment {
  content: string;
  visible: boolean;
}

export interface StatusLineSegment {
  id: StatusLineSegmentId;
  render(ctx: SegmentContext): RenderedSegment;
}

// ═══════════════════════════════════════════════════════════════════════════
// 설정
// ═══════════════════════════════════════════════════════════════════════════

export interface HudCoreConfig {
  preset: StatusLinePreset;
}

// ═══════════════════════════════════════════════════════════════════════════
// 확장 간 공유 인터페이스
// ═══════════════════════════════════════════════════════════════════════════

/**
 * buildSegmentContext에 필요한 최소 상태 인터페이스.
 * 각 확장이 자신의 상태에서 이 인터페이스를 충족하여 전달한다.
 */
export interface SegmentStateProvider {
  footerDataRef: ReadonlyFooterDataProvider | null;
  getThinkingLevelFn: (() => string) | null;
  sessionStartTime: number;
}

/**
 * 에디터 렌더링에 필요한 모드 정보를 제공하는 인터페이스.
 *
 * infra-hud(인프라)가 계약을 정의하고,
 * 기능 확장(예: unified-agent-direct)이 구현하여 globalThis에 주입한다.
 * 이를 통해 인프라 → 기능 방향의 역방향 의존을 제거한다.
 */
export interface EditorModeProvider {
  /** 현재 활성 모드 ID (없으면 null) */
  getActiveModeId(): string | null;
  /** 모드의 ANSI 색상 문자열 (없으면 null) */
  getModeColor(modeId: string): string | null;
  /** 에디터 위에 표시할 배너 라인 */
  getBannerLines(width: number): string[];
  /** 상태 변경 콜백 등록 */
  onStatusUpdate(callback: () => void): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// 에디터 모드 프로바이더 (외부 확장이 주입하는 확장 포인트)
// ═══════════════════════════════════════════════════════════════════════════

/** globalThis 키 — EditorModeProvider 슬롯 */
export const EDITOR_MODE_PROVIDER_KEY = "__pi_infra_hud_mode_provider__";
