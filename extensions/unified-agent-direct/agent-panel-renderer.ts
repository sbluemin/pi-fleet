/**
 * unified-agent-direct — 에이전트 패널 렌더러
 *
 * activeMode에 따라 동적 레이아웃을 제공합니다:
 * - "claude"/"codex"/"gemini" → 1칼럼 독점 뷰 (전체 폭, thinking/tools 상세)
 * - "all" 또는 null → 3칼럼 뷰 (기존, compact 표시)
 * 프레임 색상은 activeMode에 맞게 동적 변경됩니다.
 */

import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
  ANSI_RESET,
  BORDER,
  SPINNER_FRAMES,
  CLI_DISPLAY_NAMES,
  DIRECT_MODE_COLORS,
  DIRECT_MODE_BG_COLORS,
  DIRECT_MODE_KEYS,
  PANEL_COLOR,
  PANEL_DIM_COLOR,
  THINKING_COLOR,
  TOOLS_COLOR,
} from "./constants";

// ─── 에이전트 칼럼 타입 ──────────────────────────────────

export interface AgentCol {
  cli: string;
  sessionId?: string;
  text: string;
  thinking: string;
  toolCalls: { title: string; status: string }[];
  status: "wait" | "conn" | "stream" | "done" | "err";
  error?: string;
  scroll: number;
}

// ─── 레이아웃 상수 ───────────────────────────────────────

/** 본문 높이 (줄 수) */
const BODY_H = 10;

/** 칼럼 CLI 순서 */
const COL_CLIS = ["claude", "codex", "gemini"];

// ─── 렌더링 헬퍼 ────────────────────────────────────────

/** 상태별 아이콘 */
export function sIcon(status: string, frame: number, cli?: string): string {
  if (status === "wait") return PANEL_DIM_COLOR + "○" + ANSI_RESET;
  if (status === "conn" || status === "stream")
    return (DIRECT_MODE_COLORS[cli ?? ""] ?? PANEL_COLOR) + SPINNER_FRAMES[frame % SPINNER_FRAMES.length] + ANSI_RESET;
  if (status === "done") return "\x1b[38;2;100;200;100m✓" + ANSI_RESET;
  return "\x1b[38;2;255;80;80m✗" + ANSI_RESET;
}

/** 텍스트를 줄 단위로 분리 + 칼럼 폭에 맞게 하드 wrap */
function wrapLines(text: string, maxW: number): string[] {
  if (!text || maxW <= 0) return [];
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (visibleWidth(raw) <= maxW) {
      out.push(raw);
      continue;
    }
    let buf = "";
    let bw = 0;
    for (const ch of raw) {
      const cw = visibleWidth(ch);
      if (bw + cw > maxW) {
        out.push(buf);
        buf = ch;
        bw = cw;
      } else {
        buf += ch;
        bw += cw;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

/** 콘텐츠 라인 배열을 하드 wrap */
function wrapAllLines(lines: string[], maxW: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!line) {
      out.push("");
      continue;
    }
    out.push(...wrapLines(line, maxW));
  }
  return out;
}

/** 셀 내용을 고정 폭으로 우측 공백 패딩 */
function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - visibleWidth(s)));
}

function centerText(text: string, width: number): string {
  const fitted = visibleWidth(text) > width ? truncateToWidth(text, width) : text;
  const remaining = Math.max(0, width - visibleWidth(fitted));
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return " ".repeat(left) + fitted + " ".repeat(right);
}

function shortSessionId(sessionId?: string, length = 8): string | undefined {
  if (length <= 0) return undefined;
  if (!sessionId) return "new";
  return sessionId.slice(0, length);
}

function buildHeaderLabel(
  col: AgentCol,
  frame: number,
  options?: {
    dimName?: boolean;
    compact?: boolean;
    sessionLength?: number;
  },
): string {
  const fullName = CLI_DISPLAY_NAMES[col.cli] ?? col.cli;
  const name = options?.compact ? fullName.slice(0, 3) : fullName;
  const nameColor = options?.dimName ? PANEL_DIM_COLOR : (DIRECT_MODE_COLORS[col.cli] ?? PANEL_COLOR);
  const sessionText = shortSessionId(col.sessionId, options?.sessionLength ?? 8);
  const sessionSuffix = sessionText ? `${PANEL_DIM_COLOR} · ${sessionText}${ANSI_RESET}` : "";

  const isStreaming = col.status === "conn" || col.status === "stream";
  if (isStreaming && !options?.dimName) {
    // 스트리밍 중: 스피너 아이콘 + 이름에 파도 그라데이션
    const rgb = MODE_RGB[col.cli] ?? [180, 160, 220];
    return `${sIcon(col.status, frame, col.cli)} ${waveText(name, rgb, frame, 0, { speed: 0.5 })}${ANSI_RESET}${sessionSuffix}`;
  }

  return `${sIcon(col.status, frame, col.cli)} ${nameColor}${name}${ANSI_RESET}${sessionSuffix}`;
}

function pickHeaderLabel(
  col: AgentCol,
  frame: number,
  maxWidth: number,
  options?: { dimName?: boolean },
): string {
  const candidates = [
    buildHeaderLabel(col, frame, { ...options, sessionLength: 8 }),
    buildHeaderLabel(col, frame, { ...options, sessionLength: 6 }),
    buildHeaderLabel(col, frame, { ...options, compact: true, sessionLength: 6 }),
    buildHeaderLabel(col, frame, { ...options, compact: true, sessionLength: 4 }),
    buildHeaderLabel(col, frame, { ...options, compact: true, sessionLength: 0 }),
  ];

  return candidates.find((candidate) => visibleWidth(candidate) <= maxWidth) ?? candidates.at(-1)!;
}

function pickExclusiveHeader(
  cols: AgentCol[],
  activeIndex: number,
  frame: number,
  width: number,
): string {
  const active = cols[activeIndex];
  const others = cols.filter((_, index) => index !== activeIndex);
  const separator = `${PANEL_DIM_COLOR}   ${ANSI_RESET}`;
  const separatorCompact = `${PANEL_DIM_COLOR} │ ${ANSI_RESET}`;
  const activeFull = pickHeaderLabel(active, frame, width);
  const activeCompact = pickHeaderLabel(active, frame, width, { dimName: false });

  const fullJoined = [
    activeFull,
    ...others.map((col) => pickHeaderLabel(col, frame, width, { dimName: true })),
  ].join(separator);

  const compactJoined = [
    activeCompact,
    ...others.map((col) => pickHeaderLabel(col, frame, width, { dimName: true })),
  ].join(separatorCompact);

  const activeOnly = [
    activeFull,
    buildHeaderLabel(active, frame, { sessionLength: 6 }),
    buildHeaderLabel(active, frame, { sessionLength: 0 }),
  ];

  const candidates = [fullJoined, compactJoined, ...activeOnly];
  return candidates.find((candidate) => visibleWidth(candidate) <= width) ?? activeOnly.at(-1)!;
}

/** 대기/연결 중 플레이스홀더 텍스트 */
function placeholder(col: AgentCol, frame: number): string {
  const n = CLI_DISPLAY_NAMES[col.cli] ?? col.cli;
  if (col.status === "wait") return `${n} 대기 중...`;
  if (col.status === "conn") return `${n} 연결 중${".".repeat((frame % 3) + 1)}`;
  if (col.status === "err") return `Error: ${col.error ?? "unknown"}`;
  return "";
}

/** 칼럼 콘텐츠 빌드 결과 (라인 + 라인별 색상) */
interface ColContentResult {
  lines: string[];
  /** 각 라인에 대응하는 ANSI 색상 prefix (빈 문자열 = 기본 색상) */
  colors: string[];
}

/**
 * 칼럼의 thinking + 도구 호출 + 응답을 통합 콘텐츠로 빌드합니다.
 * 각 라인에 대응하는 색상 정보를 함께 반환합니다.
 * @param compact - true이면 thinking/도구를 한 줄로 축약
 */
function buildColContent(col: AgentCol, frame: number, compact: boolean): ColContentResult {
  const lines: string[] = [];
  const colors: string[] = [];

  if (col.thinking) {
    if (compact || col.text) {
      const first = col.thinking.split("\n").find((l) => l.trim()) ?? "";
      const preview = first.length > 55 ? first.slice(0, 52) + "..." : first;
      lines.push(`◇ ${preview}`);
      colors.push(THINKING_COLOR);
    } else {
      lines.push("◇ thinking");
      colors.push(THINKING_COLOR);
      for (const l of col.thinking.split("\n")) {
        lines.push(`  ${l}`);
        colors.push(THINKING_COLOR);
      }
    }
  }

  if (col.toolCalls.length > 0) {
    if (compact) {
      const done = col.toolCalls.filter((tc) => tc.status === "completed").length;
      lines.push(`◆ ${col.toolCalls.length} tools (${done}✓)`);
      colors.push(TOOLS_COLOR);
    } else {
      lines.push("◆ tools");
      colors.push(TOOLS_COLOR);
      for (const tc of col.toolCalls) {
        const icon = tc.status === "completed" ? "✓" : tc.status === "error" ? "✗" : "▶";
        lines.push(`  ${icon} ${tc.title}`);
        colors.push(TOOLS_COLOR);
      }
    }
  }

  if (lines.length > 0 && col.text) {
    lines.push("");
    colors.push("");
  }

  if (col.text) {
    for (const l of col.text.split("\n")) {
      lines.push(l);
      colors.push("");
    }
  } else if (col.status === "wait" || col.status === "conn") {
    lines.push(placeholder(col, frame));
    colors.push("");
  } else if (col.status === "err" && !col.thinking) {
    lines.push(placeholder(col, frame));
    colors.push("");
  }

  return { lines, colors };
}

/** wrapAllLines와 동일하되 색상 배열을 동기화하여 확장합니다. */
function wrapAllLinesColored(lines: string[], colors: string[], maxW: number): ColContentResult {
  const outLines: string[] = [];
  const outColors: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const color = colors[i] ?? "";
    if (!line) {
      outLines.push("");
      outColors.push(color);
      continue;
    }
    const wrapped = wrapLines(line, maxW);
    for (const w of wrapped) {
      outLines.push(w);
      outColors.push(color);
    }
  }
  return { lines: outLines, colors: outColors };
}

// ─── 공통 보더 헬퍼 ─────────────────────────────────────

/** 세로 보더 렌더링 (diag = x + row) */
function vBorder(FC: string, wave: WaveConfig | undefined, diag: number): string {
  if (wave) return sweepColorChar(BORDER.vertical, wave.rgb, sweepFactor(diag, wave));
  return FC + BORDER.vertical;
}

/** 수평 보더 렌더링 (row 기준, 각 문자의 diag = startX + charIdx + row) */
function hBorder(text: string, FC: string, wave: WaveConfig | undefined, row: number, startX = 0): string {
  if (wave) {
    let result = "";
    let x = startX;
    for (const ch of text) {
      result += sweepColorChar(ch, wave.rgb, sweepFactor(x + row, wave));
      x++;
    }
    return result;
  }
  return FC + text;
}

/** 상단 보더 렌더링 (row = 0) */
function renderTopBorder(w: number, FC: string, wave?: WaveConfig): string {
  const title = " ◈ Agent Panel ";
  const tW = visibleWidth(title);
  const topFill = Math.max(0, w - 2 - tW);
  const topL = Math.floor(topFill / 2);
  const topR = topFill - topL;
  const full = BORDER.topLeft + BORDER.horizontal.repeat(topL) + title + BORDER.horizontal.repeat(topR) + BORDER.topRight;
  return hBorder(full, FC, wave, 0) + ANSI_RESET;
}

/** 하단 보더 렌더링 */
function renderBottomBorder(w: number, FC: string, bottomHint: string, wave: WaveConfig | undefined, row: number): string {
  const hW = visibleWidth(bottomHint);
  const botFill = Math.max(0, w - 2 - hW);
  const botL = Math.floor(botFill / 2);
  const botR = botFill - botL;
  const leftPart = BORDER.bottomLeft + BORDER.horizontal.repeat(botL);
  const rightPart = BORDER.horizontal.repeat(botR) + BORDER.bottomRight;
  const rightStartX = visibleWidth(leftPart) + hW;
  return (
    hBorder(leftPart, FC, wave, row) + ANSI_RESET +
    PANEL_DIM_COLOR + bottomHint + ANSI_RESET +
    hBorder(rightPart, FC, wave, row, rightStartX) + ANSI_RESET
  );
}

// ─── 1칼럼 독점 뷰 ─────────────────────────────────────

/**
 * 특정 CLI의 독점 뷰를 렌더링합니다.
 * 전체 폭을 사용하고, thinking/tools를 상세 표시합니다.
 * 헤더 우측에 나머지 에이전트의 상태를 요약합니다.
 */
function renderExclusive(
  w: number,
  cols: AgentCol[],
  frame: number,
  FC: string,
  bottomHint: string,
  activeIndex: number,
  wave?: WaveConfig,
): string[] {
  const col = cols[activeIndex];
  const iw = Math.max(15, w - 2);
  const R: string[] = [];
  let ri = 0;

  R.push(renderTopBorder(w, FC, wave));
  ri++;

  // ── 헤더: 독점 CLI + 나머지 상태 요약 (가운데 정렬) ──
  const headerLine = pickExclusiveHeader(cols, activeIndex, frame, iw);
  R.push(
    vBorder(FC, wave, ri) + ANSI_RESET +
    centerText(headerLine, iw) +
    vBorder(FC, wave, w - 1 + ri) + ANSI_RESET,
  );
  ri++;

  // ── 구분선 ──
  R.push(hBorder("├" + BORDER.horizontal.repeat(iw) + "┤", FC, wave, ri) + ANSI_RESET);
  ri++;

  // ── 본문 (compact=false → thinking/tools 상세, 영역별 색상) ──
  const contentW = iw - 2;
  const content = buildColContent(col, frame, false);
  const wrapped = wrapAllLinesColored(content.lines, content.colors, contentW);

  for (let row = 0; row < BODY_H; row++) {
    const startLine = Math.max(0, wrapped.lines.length - BODY_H);
    const lineIdx = startLine + row;
    const line = wrapped.lines[lineIdx] ?? "";
    const lineColor = wrapped.colors[lineIdx] ?? "";
    const coloredLine = lineColor ? lineColor + line + ANSI_RESET : line;
    R.push(
      vBorder(FC, wave, ri) + ANSI_RESET +
      " " + pad(coloredLine, iw - 1) +
      vBorder(FC, wave, w - 1 + ri) + ANSI_RESET,
    );
    ri++;
  }

  R.push(renderBottomBorder(w, FC, bottomHint, wave, ri));
  return R;
}

// ─── 3칼럼 뷰 ──────────────────────────────────────────

/** 3칼럼 동시 뷰를 렌더링합니다 (all 모드 또는 기본). */
function renderMultiCol(
  w: number,
  cols: AgentCol[],
  frame: number,
  FC: string,
  bottomHint: string,
  wave?: WaveConfig,
  activeMode?: string | null,
): string[] {
  const iw = Math.max(15, w - 4);
  const c0 = Math.floor(iw / 3);
  const c1 = c0;
  const c2 = iw - c0 - c1;
  const cw = [c0, c1, c2];
  // 내부 세로 보더의 x 위치 (왼쪽 보더=0, 첫번째 구분=1+c0, 두번째 구분=2+c0+c1, 오른쪽=w-1)
  const vx = [0, 1 + c0, 2 + c0 + c1, w - 1];

  const R: string[] = [];
  let ri = 0;

  R.push(renderTopBorder(w, FC, wave));
  ri++;

  // ── 칼럼 헤더 (가운데 정렬) ──
  const hdrCells = cols.map((col, i) => {
    const label = pickHeaderLabel(col, frame, cw[i]);
    return centerText(label, cw[i]);
  });
  {
    let line = vBorder(FC, wave, vx[0] + ri) + ANSI_RESET;
    for (let i = 0; i < hdrCells.length; i++) {
      line += hdrCells[i];
      line += vBorder(FC, wave, vx[i + 1] + ri) + ANSI_RESET;
    }
    R.push(line);
  }
  ri++;

  // ── 구분선 ──
  const sepStr = "├" + cw.map((c) => BORDER.horizontal.repeat(c)).join("┼") + "┤";
  R.push(hBorder(sepStr, FC, wave, ri) + ANSI_RESET);
  ri++;

  // ── 본문 (auto-tail, 영역별 색상) ──
  const wrappedCols = cols.map((col, i) => {
    const contentW = cw[i] - 2;
    const content = buildColContent(col, frame, true);
    return wrapAllLinesColored(content.lines, content.colors, contentW);
  });

  for (let row = 0; row < BODY_H; row++) {
    const cells = cols.map((_col, i) => {
      const { lines, colors } = wrappedCols[i];
      const startLine = Math.max(0, lines.length - BODY_H);
      const lineIdx = startLine + row;
      const line = lines[lineIdx] ?? "";
      const lineColor = colors[lineIdx] ?? "";
      const coloredLine = lineColor ? lineColor + line + ANSI_RESET : line;
      return " " + pad(coloredLine, cw[i] - 1);
    });
    let line = vBorder(FC, wave, vx[0] + ri) + ANSI_RESET;
    for (let i = 0; i < cells.length; i++) {
      line += cells[i];
      line += vBorder(FC, wave, vx[i + 1] + ri) + ANSI_RESET;
    }
    R.push(line);
    ri++;
  }

  R.push(renderBottomBorder(w, FC, bottomHint, wave, ri));
  return R;
}

// ─── 메인 렌더러 ────────────────────────────────────────

/**
 * 에이전트 패널의 메인 뷰를 렌더링합니다.
 *
 * activeMode에 따라 동적 레이아웃:
 * - "claude"/"codex"/"gemini" → 1칼럼 독점 뷰 (전체 폭, 상세 표시)
 * - "all"/null → 3칼럼 뷰 (compact 표시)
 * 스트리밍 중이면 보더 와이어프레임에 파도 애니메이션 적용.
 */
export function renderPanelFull(
  w: number,
  cols: AgentCol[],
  frame: number,
  frameColor: string,
  bottomHint: string,
  activeMode: string | null,
): string[] {
  const FC = frameColor || PANEL_COLOR;
  const activeIndex = activeMode ? COL_CLIS.indexOf(activeMode) : -1;

  // 패널 높이: top(1) + header(1) + sep(1) + body(BODY_H) + bottom(1)
  const panelH = 3 + BODY_H + 1;
  const totalDiag = (w - 1) + (panelH - 1);

  // 스트리밍 중이면 보더에 대각선 스위프 애니메이션 적용
  const isStreaming = cols.some((col) => col.status === "conn" || col.status === "stream");
  const wave: WaveConfig | undefined = isStreaming
    ? { rgb: MODE_RGB[activeMode ?? ""] ?? [180, 160, 220], frame, totalDiag, bandWidth: 12 }
    : undefined;

  if (activeIndex >= 0) {
    return renderExclusive(w, cols, frame, FC, bottomHint, activeIndex, wave);
  }

  return renderMultiCol(w, cols, frame, FC, bottomHint, wave, activeMode);
}


// ─── 모드 배너 렌더러 ───────────────────────────────────

/** 모드별 시그니처 RGB (파도 그라데이션 애니메이션용) */
export const MODE_RGB: Record<string, [number, number, number]> = {
  claude: [255, 149, 0],
  codex:  [169, 169, 169],
  gemini: [66, 133, 244],
  all:    [255, 120, 120],
};

/**
 * 파도 그라데이션 애니메이션을 문자별로 적용합니다.
 * sin 파형으로 원래 색상 → 흰색 방향으로 밝아지는 파도 효과를 만듭니다.
 * ANSI_RESET을 포함하지 않으므로 호출부에서 관리합니다.
 */
export function waveText(
  text: string,
  rgb: [number, number, number],
  frame: number,
  startOffset = 0,
  options?: { speed?: number; allowDim?: boolean },
): string {
  const [r, g, b] = rgb;
  const speed = options?.speed ?? 0.35;
  const allowDim = options?.allowDim ?? false;
  let result = "";
  let idx = startOffset;

  for (const ch of text) {
    const phase = idx * 0.4 - frame * speed;
    const raw = Math.sin(phase);

    if (allowDim) {
      // 패널용: 좁은 밝은 피크 + 넓은 은은한 어둠 (스캐닝 라이트)
      // pow로 피크를 날카롭게, 기본 상태를 살짝 어둡게
      const bright = Math.pow(Math.max(0, raw), 3) * 0.4;   // 좁고 날카로운 하이라이트
      const dim = Math.min(0, raw) * 0.25;                   // 은은한 어둠
      const factor = bright + dim;
      const cr = Math.min(255, Math.max(0, Math.round(
        factor >= 0 ? r + (255 - r) * factor : r + r * factor,
      )));
      const cg = Math.min(255, Math.max(0, Math.round(
        factor >= 0 ? g + (255 - g) * factor : g + g * factor,
      )));
      const cb = Math.min(255, Math.max(0, Math.round(
        factor >= 0 ? b + (255 - b) * factor : b + b * factor,
      )));
      result += `\x1b[38;2;${cr};${cg};${cb}m${ch}`;
    } else {
      // 배너/footer용: 부드럽게 밝아지는 효과만
      const wave = Math.max(0, raw);
      const boost = wave * 0.5;
      const cr = Math.min(255, Math.round(r + (255 - r) * boost));
      const cg = Math.min(255, Math.round(g + (255 - g) * boost));
      const cb = Math.min(255, Math.round(b + (255 - b) * boost));
      result += `\x1b[38;2;${cr};${cg};${cb}m${ch}`;
    }
    idx++;
  }

  return result;
}

/** 대각선 스위프 애니메이션 설정 (왼쪽 위 → 오른쪽 아래) */
interface WaveConfig {
  rgb: [number, number, number];
  frame: number;
  /** 대각선 최대값 (w - 1 + panelH - 1) */
  totalDiag: number;
  /** 밝은 띠의 폭 (대각선 단위) */
  bandWidth: number;
}

/** 대각선 위치 기반 밝기 계수 반환 (-0.2 ~ +0.5) */
function sweepFactor(diag: number, cfg: WaveConfig): number {
  const cycle = cfg.totalDiag + cfg.bandWidth;
  const sweepPos = (cfg.frame * 4.0) % cycle - cfg.bandWidth * 0.3;
  const dist = diag - sweepPos;

  if (dist >= 0 && dist <= cfg.bandWidth) {
    // 밝은 띠 내부: 가우시안 프로파일 (중심이 가장 밝음)
    const t = (dist / cfg.bandWidth - 0.5) * 3;
    return Math.exp(-t * t) * 0.5;
  }
  return -0.2; // 띠 밖: 은은하게 어둡게
}

/** 단일 문자에 스위프 색상 적용 */
function sweepColorChar(ch: string, rgb: [number, number, number], factor: number): string {
  const [r, g, b] = rgb;
  const cr = Math.min(255, Math.max(0, Math.round(
    factor >= 0 ? r + (255 - r) * factor : r + r * factor,
  )));
  const cg = Math.min(255, Math.max(0, Math.round(
    factor >= 0 ? g + (255 - g) * factor : g + g * factor,
  )));
  const cb = Math.min(255, Math.max(0, Math.round(
    factor >= 0 ? b + (255 - b) * factor : b + b * factor,
  )));
  return `\x1b[38;2;${cr};${cg};${cb}m${ch}`;
}

/**
 * 다이렉트 모드 활성 시 한 줄 배너를 렌더링합니다.
 * 패널이 접힌 상태(expanded=false)에서 activeMode가 있을 때 aboveEditor에 표시됩니다.
 *
 * 레이아웃: [BG] {모드 활성화 문구}(왼쪽) .... {단축키 힌트}(우측) [RESET]
 * 스트리밍 중이면 왼쪽 텍스트에 파도 그라데이션 애니메이션 적용.
 */
export function renderModeBanner(
  w: number,
  activeMode: string,
  frame: number,
  cols: AgentCol[],
): string[] {
  const fg = DIRECT_MODE_COLORS[activeMode] ?? PANEL_COLOR;
  const bg = DIRECT_MODE_BG_COLORS[activeMode] ?? "";
  const name = CLI_DISPLAY_NAMES[activeMode] ?? activeMode;
  const exitKey = DIRECT_MODE_KEYS[activeMode] ?? "";
  const rgb = MODE_RGB[activeMode] ?? [180, 160, 220];

  // 스트리밍 중인 칼럼 감지 (All 모드면 아무 칼럼)
  const streamingCol = cols.find((col) =>
    (activeMode === "all" || col.cli === activeMode) &&
    (col.status === "conn" || col.status === "stream"),
  );

  // 중앙: 모드명 (스트리밍 시 스피너 + 진행 상태)
  let centerPlain: string;
  if (streamingCol) {
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    const parts: string[] = [];
    if (streamingCol.toolCalls.length > 0) parts.push(`${streamingCol.toolCalls.length}T`);
    const lineCount = streamingCol.text.trim() ? streamingCol.text.split("\n").length : 0;
    if (lineCount > 0) parts.push(`${lineCount}L`);
    const progress = parts.length > 0 ? parts.join("·") : "running";
    centerPlain = `${spinner} ${name} ${progress}`;
  } else {
    centerPlain = `◈ ${name} mode activated`;
  }

  // 우측: 단축키 힌트
  const rightText = ` ${exitKey} exit · alt+p panel `;

  // 전체 폭 기준 가운데 정렬, 우측 힌트와 겹치면 폴백
  const centerW = visibleWidth(centerPlain);
  const rightW = visibleWidth(rightText);
  let padLeft = Math.floor((w - centerW) / 2);
  let padRight = w - padLeft - centerW - rightW;

  if (padRight < 0) {
    const availableW = Math.max(0, w - rightW);
    const totalPad = Math.max(0, availableW - centerW);
    padLeft = Math.floor(totalPad / 2);
    padRight = totalPad - padLeft;
  }

  // 스트리밍 중이면 파도 그라데이션, 아니면 정적 색상
  const coloredCenter = streamingCol
    ? waveText(centerPlain, rgb, frame)
    : fg + centerPlain;

  const line =
    bg +
    " ".repeat(padLeft) +
    coloredCenter +
    ANSI_RESET + bg +
    " ".repeat(padRight) +
    PANEL_DIM_COLOR + rightText +
    ANSI_RESET;

  return [line];
}

// ─── Compact 상태바 렌더러 ──────────────────────────────

/**
 * 컴팩트 상태바를 렌더링합니다 (1줄).
 * 패널 접힘 + 스트리밍 중에 aboveEditor에 표시.
 */
export function renderPanelCompact(w: number, cols: AgentCol[], frame: number): string[] {
  const parts: string[] = [PANEL_COLOR + "◈ Agents" + ANSI_RESET];

  for (const col of cols) {
    const nm = CLI_DISPLAY_NAMES[col.cli] ?? col.cli;
    const icon = sIcon(col.status, frame, col.cli);
    const clr = DIRECT_MODE_COLORS[col.cli] ?? "";

    let info = "";
    if (col.status === "stream") {
      const lines = col.text.split("\n").length;
      info = ` ${lines}L`;
    } else if (col.status === "done") {
      const chars = col.text.length;
      info = chars < 1024 ? ` ${chars}c` : ` ${(chars / 1024).toFixed(1)}K`;
    } else if (col.status === "err") {
      info = " err";
    }

    parts.push(icon + " " + clr + nm + ANSI_RESET + (info ? PANEL_DIM_COLOR + info + ANSI_RESET : ""));
  }

  const line = parts.join("  ");
  const vw = visibleWidth(line);
  return [vw <= w ? line : line.slice(0, w)];
}
