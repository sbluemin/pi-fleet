/**
 * fleet/internal/agent/client-pool.ts — 클라이언트 풀 관리
 *
 * CLI별 Keep-alive 연결을 재사용하기 위한 싱글턴 풀입니다.
 * PI API 타입을 사용하지 않습니다.
 *
 * ⚠️ pi는 각 확장을 별도 번들로 로드하므로 모듈 레벨 변수는
 *    확장 간에 공유되지 않습니다. globalThis를 통해 풀을 공유합니다.
 */

import type { FleetAgentClient } from "../shared/client.js";

// ─── 타입 ────────────────────────────────────────────────

/** 풀에 보관되는 클라이언트 엔트리 */
export interface PooledClient {
  client: FleetAgentClient;
  /** 현재 요청 처리 중 여부 */
  busy: boolean;
  /** 마지막으로 알려진 세션 ID (재연결 시 복원용) */
  sessionId?: string;
}

// ─── 상수 ────────────────────────────────────────────────

/** globalThis 키 */
const POOL_KEY = "__pi_unified_agent_client_pool__";

// ─── globalThis 기반 싱글턴 풀 ───────────────────────────

/** 싱글턴 풀 반환 (globalThis에서 가져오거나 생성) */
export function getClientPool(): Map<string, PooledClient> {
  let pool = (globalThis as any)[POOL_KEY] as Map<string, PooledClient> | undefined;
  if (!pool) {
    pool = new Map();
    (globalThis as any)[POOL_KEY] = pool;
  }
  return pool;
}

// ─── 헬퍼 ────────────────────────────────────────────────

/** 연결 상태가 활성(재사용 가능)인지 판별 */
export function isClientAlive(client: FleetAgentClient): boolean {
  const info = client.getConnectionInfo();
  return info.state === "ready" || info.state === "connected";
}

/** busy가 아닌 클라이언트를 disconnect + 풀에서 제거 */
export function cleanIdleClients(): void {
  const pool = getClientPool();
  for (const [key, entry] of pool) {
    if (!entry.busy) {
      entry.client.disconnect().catch(() => {});
      pool.delete(key);
    }
  }
}

/**
 * 특정 CLI의 풀 클라이언트를 강제로 종료하고 풀에서 제거합니다.
 * expectedClient가 주어지면 현재 풀 엔트리가 해당 인스턴스일 때만 종료합니다.
 */
export async function disconnectClient(
  carrierId: string,
  expectedClient?: FleetAgentClient,
): Promise<boolean> {
  const pool = getClientPool();
  const entry = pool.get(carrierId);
  if (!entry) return false;
  if (expectedClient && entry.client !== expectedClient) return false;

  pool.delete(carrierId);
  entry.busy = false;

  try {
    await entry.client.disconnect();
  } catch {
    // 강제 정리 경로이므로 disconnect 실패는 무시합니다.
  }
  entry.client.removeAllListeners();
  return true;
}

/** 전체 풀 정리 (session_end용) */
export async function disconnectAll(): Promise<void> {
  const pool = getClientPool();
  const promises: Promise<void>[] = [];
  for (const [, entry] of pool) {
    promises.push(
      entry.client.disconnect().catch(() => { /* 정리 실패 무시 */ }),
    );
  }
  await Promise.allSettled(promises);
  pool.clear();
}
