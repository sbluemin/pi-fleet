/**
 * fleet/internal/agent/session-map.ts — 세션 매핑 관리
 *
 * SessionMapStore: 인스턴스 기반 세션 맵 저장소.
 * 각 확장이 자체 저장 경로를 가진 독립 인스턴스를 생성합니다.
 *
 * PI API 타입(ExtensionContext)을 사용하지 않으며,
 * piSessionId를 문자열로 직접 받습니다.
 *
 * 데이터는 sessionDir/<uuid>.json에 저장됩니다.
 * sessionDir은 호출처(확장)가 결정합니다.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── 타입 ────────────────────────────────────────────────

/** carrierId별 서브에이전트 sessionId 매핑 */
type SessionMap = Record<string, string>;

/** 세션 매핑 저장소 인터페이스 */
export interface SessionMapStore {
  /** 세션 시작/전환 시 기존 매핑을 복원합니다. */
  restore(piSessionId: string): void;
  /** carrierId의 서브에이전트 sessionId를 조회합니다. */
  get(carrierId: string): string | undefined;
  /** carrierId의 서브에이전트 sessionId를 저장합니다 (즉시 persist). */
  set(carrierId: string, sessionId: string): void;
  /** carrierId의 서브에이전트 sessionId를 제거합니다 (즉시 persist). */
  clear(carrierId: string): void;
  /** 현재 매핑의 읽기 전용 복사본을 반환합니다. */
  getAll(): Readonly<SessionMap>;
}

// ─── Legacy 키 마이그레이션 ──────────────────────────────

/** cliType 기반 legacy 키 목록 (carrierId 체계 전환 이전에 사용된 키) */
const LEGACY_CLI_KEYS = new Set(["claude", "codex", "gemini"]);

// ─── 팩토리 ──────────────────────────────────────────────

/**
 * 독립된 SessionMapStore 인스턴스를 생성합니다.
 *
 * @param sessionDir - 세션 맵 JSON 파일이 저장될 디렉토리 경로
 *                     (예: fleet/session-maps/)
 */
export function createSessionMapStore(sessionDir: string): SessionMapStore {
  let currentMap: SessionMap = {};
  let mapFilePath: string | null = null;

  function persist(): void {
    if (!mapFilePath) return;
    try {
      const dir = path.dirname(mapFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(mapFilePath, JSON.stringify(currentMap, null, 2));
    } catch {
      // 파일 쓰기 실패 무시 (권한 등)
    }
  }

  return {
    restore(piSessionId: string): void {
      currentMap = {};
      mapFilePath = null;

      if (!piSessionId || !sessionDir) return;

      mapFilePath = path.join(sessionDir, `${piSessionId}.json`);
      try {
        if (fs.existsSync(mapFilePath)) {
          currentMap = JSON.parse(fs.readFileSync(mapFilePath, "utf-8"));
          // legacy cliType 키("claude" 등)가 잔존하면 제거 후 즉시 persist
          if (migrateLegacyKeys(currentMap)) {
            persist();
          }
        }
      } catch {
        currentMap = {};
      }
    },

    get(carrierId: string): string | undefined {
      return currentMap[carrierId];
    },

    set(carrierId: string, sessionId: string): void {
      if (currentMap[carrierId] === sessionId) return;
      currentMap[carrierId] = sessionId;
      persist();
    },

    clear(carrierId: string): void {
      if (!(carrierId in currentMap)) return;
      delete currentMap[carrierId];
      persist();
    },

    getAll(): Readonly<SessionMap> {
      return { ...currentMap };
    },
  };
}

/**
 * cliType 기반 legacy 키를 제거합니다.
 * carrierId 체계 전환 이전에 저장된 세션 맵 파일에 잔존하는
 * "claude", "codex", "gemini" 등의 키를 정리하여
 * 동일 cliType을 사용하는 복수 carrier 간 세션 충돌을 방지합니다.
 *
 * @returns 마이그레이션이 발생했으면 true
 */
function migrateLegacyKeys(map: SessionMap): boolean {
  let migrated = false;
  for (const key of LEGACY_CLI_KEYS) {
    if (key in map) {
      delete map[key];
      migrated = true;
    }
  }
  return migrated;
}
