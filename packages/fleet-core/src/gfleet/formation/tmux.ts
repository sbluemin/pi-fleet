/**
 * formation/tmux.ts — tmux CLI 래퍼
 */
import { execFile } from "node:child_process";

import { agentLog } from "../../agent/log-port.js";

type TmuxWindowInfo = {
  dead: boolean;
  currentCommand: string;
  name: string;
  paneId: string;
};

const LOG_SOURCE = "grand-fleet";
const TMUX_TIMEOUT_MS = 10_000;
const TMUX_WINDOW_FORMAT = "#{window_name}\t#{pane_pid}\t#{pane_dead}\t#{pane_current_command}";

/** tmux 명령 실행 래퍼 */
function tmux(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "tmux",
      args,
      { timeout: TMUX_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(`tmux ${args.join(" ")} 실패: ${stderr || err.message}`),
          );
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

/** tmux 설치 여부 확인 */
export async function checkTmuxAvailable(): Promise<boolean> {
  try {
    await tmux("-V");
    agentLog("debug", "tmux 가용 여부: true", { source: LOG_SOURCE });
    return true;
  } catch {
    agentLog("debug", "tmux 가용 여부: false", { source: LOG_SOURCE });
    return false;
  }
}

/** tmux 세션 생성 */
export async function createSession(sessionName: string): Promise<void> {
  agentLog("debug", `tmux 세션 생성: ${sessionName}`, { source: LOG_SOURCE });
  await tmux("new-session", "-d", "-s", sessionName, "-x", "200", "-y", "50");
}

/** tmux 세션 존재 여부 확인 */
export async function hasSession(sessionName: string): Promise<boolean> {
  try {
    await tmux("has-session", "-t", sessionName);
    return true;
  } catch {
    return false;
  }
}

/** tmux 세션을 보장한다. */
export async function ensureSession(sessionName: string): Promise<void> {
  if (await hasSession(sessionName)) {
    return;
  }

  await createSession(sessionName);
}

/** tmux 윈도우 생성 */
export async function createWindow(
  sessionName: string,
  windowName: string,
): Promise<void> {
  agentLog("debug", `tmux 윈도우 생성: ${windowName}`, { source: LOG_SOURCE });
  await tmux("new-window", "-t", sessionName, "-n", windowName);
}

/** tmux 윈도우에 명령 전송 */
export async function sendCommand(
  sessionName: string,
  windowName: string,
  command: string,
): Promise<void> {
  agentLog("debug", `tmux 명령 전송: ${windowName}`, { source: LOG_SOURCE });
  await tmux("send-keys", "-t", `${sessionName}:${windowName}`, command, "Enter");
}

/** tmux 윈도우 종료 */
export async function killWindow(
  sessionName: string,
  windowName: string,
): Promise<void> {
  try {
    await tmux("kill-window", "-t", `${sessionName}:${windowName}`);
  } catch {
    // 이미 종료된 경우 무시
  }
}

/** tmux 세션 종료 */
export async function killSession(sessionName: string): Promise<void> {
  agentLog("debug", `tmux 세션 종료: ${sessionName}`, { source: LOG_SOURCE });
  try {
    await tmux("kill-session", "-t", sessionName);
  } catch {
    // 이미 종료된 경우 무시
  }
}

/** tmux 윈도우 목록 조회 */
export async function listWindows(
  sessionName: string,
): Promise<TmuxWindowInfo[]> {
  try {
    const output = await tmux(
      "list-windows",
      "-t",
      sessionName,
      "-F",
      TMUX_WINDOW_FORMAT,
    );

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", paneId = "", dead = "0", currentCommand = ""] = line.split("\t");
        return {
          name,
          paneId,
          dead: dead === "1",
          currentCommand,
        };
      });
  } catch {
    return [];
  }
}

/** tmux 윈도우 조회 */
export async function getWindow(
  sessionName: string,
  windowName: string,
): Promise<TmuxWindowInfo | null> {
  const windows = await listWindows(sessionName);
  return windows.find((window) => window.name === windowName) ?? null;
}

/** 세션 내 윈도우 존재 여부 확인 */
export async function hasWindow(
  sessionName: string,
  windowName: string,
): Promise<boolean> {
  return (await getWindow(sessionName, windowName)) !== null;
}

/** 현재 tmux 세션 내부에서 실행 중인지 감지 */
export function isInsideTmux(): boolean {
  const result = !!process.env.TMUX;
  agentLog("debug", `tmux 내부 실행: ${result}`, { source: LOG_SOURCE });
  return result;
}

/** 현재 tmux 세션 이름을 반환 */
export async function getCurrentSessionName(): Promise<string> {
  const name = await tmux("display-message", "-p", "#S");
  agentLog("debug", `현재 tmux 세션: ${name}`, { source: LOG_SOURCE });
  return name;
}

/** 현재 윈도우 이름을 변경 */
export async function renameCurrentWindow(name: string): Promise<void> {
  agentLog("debug", `현재 윈도우 이름 변경: ${name}`, { source: LOG_SOURCE });
  await tmux("rename-window", name);
}

/** 자동 윈도우 이름 변경을 비활성화 (셸이 이름을 덮어쓰는 것 방지) */
export async function disableAutoRename(): Promise<void> {
  await tmux("set-option", "-w", "automatic-rename", "off");
  await tmux("set-option", "-w", "allow-rename", "off");
}

/** Grand Fleet 전용 상태바 테마를 적용 */
export async function applyGrandFleetTheme(fleetCount: number): Promise<void> {
  agentLog("debug", "Grand Fleet 상태바 테마 적용", { source: LOG_SOURCE });

  // 색상 정의
  const bg = "colour75";       // 연한 파란색
  const fg = "colour232";      // 거의 검정
  const accentBg = "colour69"; // 진한 파란색
  const accentFg = "colour255"; // 흰색
  const winBg = "colour236";   // 비활성 윈도우 배경 (어두운 회색)
  const winFg = "colour252";   // 비활성 윈도우 텍스트
  const activeBg = bg;         // 활성 윈도우 배경
  const activeFg = fg;         // 활성 윈도우 텍스트

  // 상태바 기본
  await tmux("set-option", "-g", "status-style", `bg=${winBg},fg=${winFg}`);
  await tmux("set-option", "-g", "status-position", "top");

  // 왼쪽: Grand Fleet 뱃지
  await tmux(
    "set-option", "-g", "status-left",
    `#[bg=${accentBg},fg=${accentFg},bold]  ⚓ Grand Fleet #[bg=${bg},fg=${accentBg}]#[bg=${bg},fg=${fg}]  ${fleetCount} fleets  #[fg=${bg},bg=${winBg}] `,
  );
  await tmux("set-option", "-g", "status-left-length", "40");

  // 오른쪽: 최소 정보만
  await tmux(
    "set-option", "-g", "status-right",
    `#[fg=${bg},bg=${winBg}]#[bg=${bg},fg=${fg}]  %H:%M  #[bg=${accentBg},fg=${bg}]#[bg=${accentBg},fg=${accentFg},bold]  #S  `,
  );
  await tmux("set-option", "-g", "status-right-length", "30");

  // 윈도우 목록 (비활성)
  await tmux(
    "set-option", "-g", "window-status-format",
    `#[fg=${winBg},bg=${winBg}] #[fg=${winFg}] #I  #W #[fg=${winBg}] `,
  );

  // 윈도우 목록 (활성)
  await tmux(
    "set-option", "-g", "window-status-current-format",
    `#[fg=${winBg},bg=${activeBg}]#[fg=${activeFg},bg=${activeBg},bold]  #I  #W  #[fg=${activeBg},bg=${winBg}]`,
  );

  // 구분자 제거
  await tmux("set-option", "-g", "window-status-separator", "");

  // 메시지 스타일
  await tmux("set-option", "-g", "message-style", `bg=${bg},fg=${fg}`);

  // pane 테두리
  await tmux("set-option", "-g", "pane-active-border-style", `fg=${bg}`);
  await tmux("set-option", "-g", "pane-border-style", "fg=colour240");
}

/** 현재 세션에 새 윈도우를 생성하고 명령을 실행 */
export async function createWindowInCurrentSession(
  windowName: string,
  command: string,
): Promise<void> {
  agentLog("debug", `현재 세션에 윈도우 생성: ${windowName}`, { source: LOG_SOURCE });
  // -d: 포커스를 새 윈도우로 이동하지 않음
  await tmux("new-window", "-d", "-n", windowName, "bash", "-c", command);
}

/** 특정 세션에 명령 실행용 윈도우를 생성한다. */
export async function createCommandWindow(
  sessionName: string,
  windowName: string,
  command: string,
): Promise<void> {
  agentLog("debug", `명령 윈도우 생성: ${sessionName}:${windowName}`, { source: LOG_SOURCE });
  await tmux("new-window", "-d", "-t", sessionName, "-n", windowName, "bash", "-lc", command);
}
