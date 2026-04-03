/**
 * fleet/internal/agent/runtime.ts — Core 런타임 상태 관리
 *
 * configDir(dataDir), sessionStore, 호스트 세션 관리를 캡슐화합니다.
 * 외부(feature/index.ts)에서는 initRuntime()으로 초기화하고,
 * onHostSessionChange()로 PI 호스트 세션 변경만 통지합니다.
 *
 * carriers는 sessionStore/configDir을 직접 몰라도 됩니다.
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
  getTaskForceModelConfig as getTaskForceModelConfigLow,
  updateTaskForceModelSelection as updateTaskForceModelSelectionLow,
  resetTaskForceModelSelection as resetTaskForceModelSelectionLow,
  isTaskForceFullyConfigured as isTaskForceFullyConfiguredLow,
  getConfiguredTaskForceCarrierIds as getConfiguredTaskForceCarrierIdsLow,
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

// ─── Task Force 모델 설정 래퍼 ──────────────────────────

/**
 * Task Force 백엔드별 모델 설정을 반환합니다.
 * 명시적 설정이 없으면 undefined를 반환합니다 (auto 폴백 없음).
 */
export function getTaskForceModelConfig(
  carrierId: string,
  cliType: string,
): Omit<ModelSelection, "taskforce"> | undefined {
  if (!dataDir) return undefined;
  return getTaskForceModelConfigLow(dataDir, carrierId, cliType);
}

/**
 * Task Force 백엔드별 모델 설정을 저장합니다.
 */
export async function updateTaskForceModelSelection(
  carrierId: string,
  cliType: string,
  selection: Omit<ModelSelection, "taskforce">,
): Promise<void> {
  if (!dataDir) return;
  updateTaskForceModelSelectionLow(dataDir, carrierId, cliType, selection);
}

/**
 * Task Force 백엔드별 모델 설정을 초기화합니다 (origin으로 되돌림).
 */
export function resetTaskForceModelSelection(carrierId: string, cliType: string): void {
  if (!dataDir) return;
  resetTaskForceModelSelectionLow(dataDir, carrierId, cliType);
}

/**
 * 지정 캐리어가 모든 CLI 백엔드에 대해 Task Force 설정을 완료했는지 확인합니다.
 */
export function isTaskForceFullyConfigured(carrierId: string): boolean {
  if (!dataDir) return false;
  return isTaskForceFullyConfiguredLow(dataDir, carrierId);
}

/**
 * 등록된 전체 캐리어 중 Task Force 설정이 완전히 구성된 캐리어 ID 목록을 반환합니다.
 */
export function getConfiguredTaskForceCarrierIds(registeredIds: string[]): string[] {
  if (!dataDir) return [];
  return getConfiguredTaskForceCarrierIdsLow(dataDir, registeredIds);
}
