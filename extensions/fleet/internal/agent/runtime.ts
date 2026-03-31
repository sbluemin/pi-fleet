/**
 * fleet/internal/agent/runtime.ts — Core 런타임 상태 관리
 *
 * configDir(dataDir), sessionStore, 호스트 세션 관리를 캡슐화합니다.
 * 외부(feature/index.ts)에서는 initRuntime()으로 초기화하고,
 * onHostSessionChange()로 PI 호스트 세션 변경만 통지합니다.
 *
 * captains는 sessionStore/configDir을 직접 몰라도 됩니다.
 * 내부 모듈(executor, operation-runner, panel)은 이 모듈을 통해 접근합니다.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createSessionMapStore, type SessionMapStore } from "./session-map.js";
import {
  loadSelectedModels,
  saveSelectedModels,
  type ModelSelection,
  type SelectedModelsConfig,
} from "./model-config.js";
import { disconnectClient } from "./client-pool.js";

/** 런타임 데이터 디렉토리 (session-maps/, selected-models.json 저장 경로) */
let dataDir: string | null = null;

/** 세션 매핑 저장소 (PI 세션별 carrierId→sessionId 매핑) */
let sessionStore: SessionMapStore | null = null;

/** noop SessionMapStore (미초기화/host session 없는 경우 fallback) */
const noopStore: SessionMapStore = {
  restore() {},
  get() { return undefined; },
  set() {},
  clear() {},
  getAll() { return {}; },
};

/**
 * Core 런타임을 초기화합니다.
 * index.ts 와이어링 단계에서 1회 호출합니다.
 *
 * @param dir - 런타임 데이터가 저장될 디렉토리
 *              (e.g. `path.join(extensionDir, ".data")`)
 */
export function initRuntime(dir: string): void {
  dataDir = dir;
  // dataDir이 존재하지 않으면 생성 (.data/ 는 런타임에 처음 만들어짐)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const sessionDir = path.join(dir, "session-maps");
  sessionStore = createSessionMapStore(sessionDir);
}

/**
 * PI 호스트 세션 변경을 통지합니다.
 * index.ts의 session_start/switch/fork/tree 이벤트 핸들러에서 호출합니다.
 *
 * 호스트 세션 없이 호출된 경우(빈 문자열)에도 안전합니다.
 */
export function onHostSessionChange(piSessionId: string): void {
  if (!sessionStore) return;
  sessionStore.restore(piSessionId);
}

/**
 * 내부 sessionStore를 반환합니다.
 * 내부 모듈(executor, panel/state)에서 직접 사용합니다.
 *
 * 미초기화 상태이면 noop store를 반환하여 신규 세션을 허용합니다.
 */
export function getSessionStore(): SessionMapStore {
  return sessionStore ?? noopStore;
}

/** carrierId의 현재 서브에이전트 sessionId를 조회합니다. */
export function getSessionId(carrierId: string): string | undefined {
  return sessionStore?.get(carrierId);
}

/** 현재 모델 설정을 로드합니다. */
export function getModelConfig(): SelectedModelsConfig {
  if (!dataDir) return {};
  return loadSelectedModels(dataDir);
}

/**
 * Carrier의 모델 설정을 변경하고 세션을 무효화합니다.
 * 원자적 연산: save → disconnect → session clear
 *
 * @param carrierId - 풀/세션 키 (disconnect, session clear에 사용)
 * @param selection - 새 모델 설정
 */
export async function updateModelSelection(
  carrierId: string,
  selection: ModelSelection,
): Promise<void> {
  if (!dataDir) return;
  const existing = loadSelectedModels(dataDir);
  existing[carrierId] = selection;
  saveSelectedModels(dataDir, existing);
  await disconnectClient(carrierId);
  sessionStore?.clear(carrierId);
}

/**
 * 전체 모델 설정을 교체하고 변경된 키의 세션을 무효화합니다.
 * 원자적 연산: save → disconnect all → session clear all
 */
export async function updateAllModelSelections(
  config: SelectedModelsConfig,
): Promise<void> {
  if (!dataDir) return;
  saveSelectedModels(dataDir, config);
  const keys = Object.keys(config);
  await Promise.allSettled(keys.map((key) => disconnectClient(key)));
  for (const key of keys) {
    sessionStore?.clear(key);
  }
}

/** 데이터 디렉토리를 반환합니다. 미초기화 시 null. */
export function getDataDir(): string | null {
  return dataDir;
}
