/**
 * fleet — 공용 상수
 *
 * Carrier 프레임워크 및 기본 구현에서 공유되는 상수입니다.
 */

// ─── CLI 표시 이름 ───────────────────────────────────────

export const CLI_DISPLAY_NAMES: Record<string, string> = {
  // cliType 키 (unified-agent CliType 기준)
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  // carrierId 키 (fleet 페르소나 기준)
  genesis: "Genesis",
  sentinel: "Sentinel",
  vanguard: "Vanguard",
};

// ─── ANSI 상수 ───────────────────────────────────────────

/** ANSI 리셋 시퀀스 */
export const ANSI_RESET = "\x1b[0m";

/** ANSI 이스케이프 시퀀스 제거용 정규식 */
export const ANSI_RE = /\x1b\[[0-9;]*m/g;

// ─── 사각형 프레임 문자 (둥근 코너) ─────────────────────

export const BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
} as const;

// ─── 애니메이션 상수 ─────────────────────────────────────

/** 처리 중 스피너 프레임 (Braille 패턴) */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** 애니메이션 갱신 간격 (ms) */
export const ANIM_INTERVAL_MS = 100;

/** 프로그레스 바 밝은 블록 크기 */
export const PROGRESS_BLOCK_SIZE = 6;

// ─── 미리보기 상수 ───────────────────────────────────────

/** 축소 뷰 응답 미리보기 줄 수 */
export const PREVIEW_LINES = 18;

/** 스트리밍 미리보기 줄 수 */
export const STREAMING_PREVIEW_LINES = 12;

// ─── Carrier 스타일 ──────────────────────────────────────

/** Carrier별 입력창 상하단 라인 색상 (ANSI 24-bit RGB) */
export const CARRIER_COLORS: Record<string, string> = {
  claude:        "\x1b[38;2;255;149;0m",      // 주황색
  codex:         "\x1b[38;2;169;169;169m",     // 밝은 회색
  gemini:        "\x1b[38;2;66;133;244m",      // 파란색
};

/** Carrier별 응답 배경색 (은은한 톤 — 다크 테마 기준) */
export const CARRIER_BG_COLORS: Record<string, string> = {
  claude:        "\x1b[48;2;40;25;8m",         // 따뜻한 어두운 주황
  codex:         "\x1b[48;2;35;35;35m",        // 약간 밝은 검정
  gemini:        "\x1b[48;2;15;22;42m",        // 차가운 어두운 파랑
};

// ─── 에이전트 패널 스타일 ────────────────────────────────

/** 에이전트 패널 기본 프레임색 (비활성 시) */
export const PANEL_COLOR = "\x1b[38;2;180;160;220m";

/** 에이전트 패널 dim 색상 (힌트, 보조 텍스트) */
export const PANEL_DIM_COLOR = "\x1b[38;2;160;150;180m";

/** Thinking 블록 색상 (라벤더) */
export const THINKING_COLOR = "\x1b[38;2;180;140;255m";

/** Tools 블록 색상 (틸/청록) */
export const TOOLS_COLOR = "\x1b[38;2;80;200;180m";

/** Sortie 도구 요약 색상 (기존 Squadron renderCall 색상 계승) */
export const SORTIE_SUMMARY_COLOR = TOOLS_COLOR;

/** Task Force 배지/도구 요약 색상 */
export const TASKFORCE_BADGE_COLOR = "\x1b[38;2;100;180;255m";

/** Squadron 배지/도구 요약 색상 */
export const SQUADRON_BADGE_COLOR = "\x1b[38;2;180;140;255m";

// ─── Claude Code 스타일 심볼 ─────────────────────────────

/** 메시지/도구 시작 인디케이터 (⏺) */
export const SYM_INDICATOR = "⏺";

/** 도구 결과 프리픽스 (⎿) */
export const SYM_RESULT = "⎿";

/** Thinking 블록 심볼 (◇) — TUI 패널 전용 */
export const SYM_THINKING = "◇";

// ─── 패널 높이 ──────────────────────────────────────────

/** 패널 본문 높이 기본값 (줄 수) */
export const DEFAULT_BODY_H = 10;

/** 패널 본문 높이 최솟값 */
export const MIN_BODY_H = 4;

/** 패널 본문 높이 최댓값 */
export const MAX_BODY_H = 50;

/** 높이 조절 1회당 증감량 */
export const BODY_H_STEP = 2;

// ─── Fleet Bridge 힌트 ──────────────────────────────────

/** Fleet Bridge 멀티컬럼 뷰 하단 힌트 */
export const PANEL_MULTI_COL_HINT = " ctrl+enter detail · alt+j/k · alt+p ";

/** Fleet Bridge 상세 뷰 하단 힌트 */
export const PANEL_DETAIL_HINT = " ctrl+enter back · alt+j/k · alt+p ";

/** 패널 높이 표시를 포함한 멀티컬럼 뷰 하단 힌트 */
export function formatPanelMultiColHint(bodyH?: number): string {
  return bodyH === undefined
    ? PANEL_MULTI_COL_HINT
    : `${PANEL_MULTI_COL_HINT}[h=${bodyH}]`;
}
