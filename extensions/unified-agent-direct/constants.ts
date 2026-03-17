/**
 * unified-agent-direct — 공용 상수
 *
 * 다이렉트 모드 프레임워크 및 기본 구현에서 공유되는 상수입니다.
 */

// ─── CLI 표시 이름 ───────────────────────────────────────

export const CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  all: "All",
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

// ─── 다이렉트 모드 스타일 ────────────────────────────────

/** 모드별 입력창 상하단 라인 색상 (ANSI 24-bit RGB) */
export const DIRECT_MODE_COLORS: Record<string, string> = {
  claude: "\x1b[38;2;255;149;0m",      // 주황색
  codex:  "\x1b[38;2;169;169;169m",     // 밝은 회색
  gemini: "\x1b[38;2;66;133;244m",      // 파란색
  all:    "\x1b[38;2;255;120;120m",     // 연한 레드
};

/** 모드별 응답 배경색 (은은한 톤 — 다크 테마 기준) */
export const DIRECT_MODE_BG_COLORS: Record<string, string> = {
  claude: "\x1b[48;2;40;25;8m",         // 따뜻한 어두운 주황
  codex:  "\x1b[48;2;35;35;35m",        // 약간 밝은 검정
  gemini: "\x1b[48;2;15;22;42m",        // 차가운 어두운 파랑
  all:    "\x1b[48;2;40;15;15m",        // 어두운 레드 톤
};

/** 모드별 토글 단축키 (alt = macOS Option 키) */
export const DIRECT_MODE_KEYS: Record<string, string> = {
  claude: "alt+1",
  codex:  "alt+2",
  gemini: "alt+3",
  all:    "alt+0",
};

// ─── 에이전트 패널 스타일 ────────────────────────────────

/** 에이전트 패널 기본 프레임색 (비활성 시) */
export const PANEL_COLOR = "\x1b[38;2;180;160;220m";

/** 에이전트 패널 dim 색상 (힌트, 보조 텍스트) */
export const PANEL_DIM_COLOR = "\x1b[38;2;100;90;120m";
