/**
 * unified-agent-core — 세션 매핑 관리
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

import type { CliType } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── 타입 ────────────────────────────────────────────────

/** CLI별 서브에이전트 sessionId 매핑 */
type SessionMap = Partial<Record<CliType, string>>;

// ─── SessionMapStore 인터페이스 ──────────────────────────

/** 세션 매핑 저장소 인터페이스 */
export interface SessionMapStore {
  /** 세션 시작/전환 시 기존 매핑을 복원합니다. */
  restore(piSessionId: string): void;
  /** CLI의 서브에이전트 sessionId를 조회합니다. */
  get(cli: CliType): string | undefined;
  /** CLI의 서브에이전트 sessionId를 저장합니다 (즉시 persist). */
  set(cli: CliType, sessionId: string): void;
  /** CLI의 서브에이전트 sessionId를 제거합니다 (즉시 persist). */
  clear(cli: CliType): void;
  /** 현재 매핑의 읽기 전용 복사본을 반환합니다. */
  getAll(): Readonly<SessionMap>;
}

// ─── 팩토리 ──────────────────────────────────────────────

/**
 * 독립된 SessionMapStore 인스턴스를 생성합니다.
 *
 * @param sessionDir - 세션 맵 JSON 파일이 저장될 디렉토리 경로
 *                     (예: unified-agent-direct/session-maps/)
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
        }
      } catch {
        currentMap = {};
      }
    },

    get(cli: CliType): string | undefined {
      return currentMap[cli];
    },

    set(cli: CliType, sessionId: string): void {
      if (currentMap[cli] === sessionId) return;
      currentMap[cli] = sessionId;
      persist();
    },

    clear(cli: CliType): void {
      if (!(cli in currentMap)) return;
      delete currentMap[cli];
      persist();
    },

    getAll(): Readonly<SessionMap> {
      return { ...currentMap };
    },
  };
}

// ─── 마이그레이션 유틸 ───────────────────────────────────

/**
 * 레거시 세션 맵 디렉토리에서 새 디렉토리로 파일을 복사합니다.
 * 이미 존재하는 파일은 덮어쓰지 않습니다.
 *
 * @param legacyDir - 기존 세션 맵 디렉토리 (예: unified-agent-core/session-maps/)
 * @param newDir - 새 세션 맵 디렉토리 (예: unified-agent-direct/session-maps/)
 */
export function migrateSessionMaps(legacyDir: string, newDir: string): void {
  try {
    if (!fs.existsSync(legacyDir)) return;
    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });

    const files = fs.readdirSync(legacyDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const src = path.join(legacyDir, file);
      const dst = path.join(newDir, file);
      if (!fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    }
  } catch {
    // 마이그레이션 실패 무시
  }
}
