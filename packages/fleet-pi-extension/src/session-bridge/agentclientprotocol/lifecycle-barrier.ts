/**
 * session-bridge/agentclientprotocol/lifecycle-barrier — ACP 세션 lifecycle 직렬화
 *
 * imports → types/interfaces → constants → functions 순서 준수.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types / Interfaces
// ═══════════════════════════════════════════════════════════════════════════

type LifecycleTask<T> = () => Promise<T>;

interface LifecycleBarrierGlobalState {
  queue: Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const LIFECYCLE_BARRIER_STATE_KEY = Symbol.for("fleet.acp.lifecycle-barrier.state");

// ═══════════════════════════════════════════════════════════════════════════
// Functions
// ═══════════════════════════════════════════════════════════════════════════

function getLifecycleBarrierState(): LifecycleBarrierGlobalState {
  const globalRecord = globalThis as Record<symbol, LifecycleBarrierGlobalState | undefined>;
  let state = globalRecord[LIFECYCLE_BARRIER_STATE_KEY];
  if (!state) {
    state = { queue: Promise.resolve() };
    globalRecord[LIFECYCLE_BARRIER_STATE_KEY] = state;
  }
  return state;
}

/** session_start/session_shutdown 작업을 직렬화하고 실패 후에도 다음 작업을 계속 진행한다. */
export function enqueueSessionLifecycleTask(
  task: LifecycleTask<void>,
  onError: (err: unknown) => void,
): Promise<void> {
  const state = getLifecycleBarrierState();
  const queued = state.queue.then(task, task).catch(onError);
  state.queue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

/** streamAcp 진입 전 pending lifecycle 정리가 끝날 때까지 대기한다. */
export async function waitForSessionLifecycleBarrier(): Promise<void> {
  await getLifecycleBarrierState().queue.catch(() => undefined);
}
