/**
 * unified-agent-core — 세션 매핑 관리
 *
 * pi-coding-agent의 세션 UUID와 각 CLI별 서브에이전트 sessionId를
 * 매핑하여 영속적으로 관리합니다.
 *
 * PI API 타입(ExtensionContext)을 사용하지 않으며,
 * piSessionId를 문자열로 직접 받습니다.
 *
 * 데이터는 configDir/session-maps/<uuid>.json에 저장됩니다.
 *
 * ⚠️ pi는 각 확장을 별도 번들로 로드하므로 모듈 레벨 변수는
 *    확장 간에 공유되지 않습니다. globalThis를 통해 상태를 공유합니다.
 */

import type { CliType } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 상수 ──────────────────────────────────────────────

/** 세션 매핑 파일 저장 디렉토리 (configDir 기준) */
const SESSION_MAPS_DIR = "session-maps";

/** globalThis 키 */
const STATE_KEY = "__pi_unified_agent_session_map__";

// ─── globalThis 공유 상태 ──────────────────────────────

/** CLI별 서브에이전트 sessionId 매핑 */
type SessionMap = Partial<Record<CliType, string>>;

/** 공유 상태 인터페이스 */
interface SessionMapState {
  /** 현재 활성 매핑 (메모리 캐시) */
  currentMap: SessionMap;
  /** 현재 세션의 매핑 파일 경로 */
  mapFilePath: string | null;
  /** 설정 디렉토리 경로 */
  configDirRef: string;
}

/** globalThis 기반 공유 상태를 반환합니다. */
function getState(): SessionMapState {
  let s = (globalThis as any)[STATE_KEY] as SessionMapState | undefined;
  if (!s) {
    s = { currentMap: {}, mapFilePath: null, configDirRef: "" };
    (globalThis as any)[STATE_KEY] = s;
  }
  return s;
}

// ─── 초기화 ────────────────────────────────────────────

/**
 * 설정 디렉토리 경로를 설정합니다.
 * 확장 초기화 시 1회 호출합니다.
 * 여러 확장에서 호출해도 globalThis로 공유되므로 안전합니다 (idempotent).
 */
export function initSessionMap(configDir: string): void {
  getState().configDirRef = configDir;
}

// ─── 복원 ──────────────────────────────────────────────

/**
 * 세션 시작/전환/분기 시 기존 매핑을 복원합니다.
 * pi 세션의 UUID를 문자열로 받아 매핑 파일을 로드합니다.
 */
export function restoreSessionMap(piSessionId: string): void {
  const state = getState();
  state.currentMap = {};
  state.mapFilePath = null;

  if (!piSessionId || !state.configDirRef) return;

  state.mapFilePath = path.join(state.configDirRef, SESSION_MAPS_DIR, `${piSessionId}.json`);
  try {
    if (fs.existsSync(state.mapFilePath)) {
      state.currentMap = JSON.parse(fs.readFileSync(state.mapFilePath, "utf-8"));
    }
  } catch {
    state.currentMap = {};
  }
}

// ─── CRUD ──────────────────────────────────────────────

/**
 * CLI의 서브에이전트 sessionId를 가져옵니다.
 */
export function getSubSessionId(cli: CliType): string | undefined {
  return getState().currentMap[cli];
}

/**
 * CLI의 서브에이전트 sessionId를 저장합니다.
 * 즉시 파일에 기록합니다.
 */
export function setSubSessionId(cli: CliType, sessionId: string): void {
  const state = getState();
  if (state.currentMap[cli] === sessionId) return; // 변경 없으면 스킵
  state.currentMap[cli] = sessionId;
  persistMap();
}

/**
 * CLI의 서브에이전트 sessionId를 제거합니다.
 * resume 실패 시 호출하여 다음 연결에서 새 세션을 생성하도록 합니다.
 */
export function clearSubSessionId(cli: CliType): void {
  const state = getState();
  if (!(cli in state.currentMap)) return; // 없으면 스킵
  delete state.currentMap[cli];
  persistMap();
}

/**
 * 현재 매핑의 읽기 전용 복사본을 반환합니다.
 */
export function getSessionMap(): Readonly<SessionMap> {
  return { ...getState().currentMap };
}

// ─── 내부 ──────────────────────────────────────────────

/** 현재 매핑을 파일에 동기적으로 기록합니다. */
function persistMap(): void {
  const state = getState();
  if (!state.mapFilePath) return;
  try {
    const dir = path.dirname(state.mapFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(state.mapFilePath, JSON.stringify(state.currentMap, null, 2));
  } catch {
    // 파일 쓰기 실패 무시 (권한 등)
  }
}
