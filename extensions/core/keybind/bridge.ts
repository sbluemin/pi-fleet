/**
 * core-keybind/bridge.ts — globalThis 런타임 브릿지
 *
 * types.ts에서 분리된 모든 런타임 로직을 포함한다.
 * - stub API 초기화 (큐 기반)
 * - _bootstrapKeybind() 함수 (실제 구현 주입)
 * - getKeybindAPI() 헬퍼 (외부 소비자 유일 진입점)
 *
 * globalThis 키 상수는 types.ts에 정의 (AGENTS.md 규칙 준수)
 */

export { CORE_KEYBIND_KEY } from "./types.js";
import { CORE_KEYBIND_KEY } from "./types.js";
import type { CoreKeybindAPI, KeybindRegistration, ResolvedBinding } from "./types.js";

// ── 큐 기반 stub API (globalThis 객체에 상태 보관) ──
// ⚠️ pi는 각 확장을 별도 번들로 로드하므로 모듈 레벨 변수는
//    확장 간에 공유되지 않는다. 따라서 _queue와 _impl을
//    globalThis 객체의 프로퍼티로 저장하여 번들 간 공유를 보장한다.
// 가드: 이미 등록되어 있으면(다른 번들에서 먼저 실행됨) 덮어쓰지 않는다.

if (!(globalThis as any)[CORE_KEYBIND_KEY]) {
  (globalThis as any)[CORE_KEYBIND_KEY] = {
    _impl: null as CoreKeybindAPI | null,
    _queue: [] as KeybindRegistration[],
    _bindings: [] as ResolvedBinding[],
    _warnTimer: setTimeout(() => {
      const self = (globalThis as any)[CORE_KEYBIND_KEY];
      if (!self._impl && self._queue.length > 0) {
        console.warn(
          "[core-keybind] core-keybind 확장이 로드되지 않았습니다. " +
          `큐에 ${self._queue.length}개의 단축키가 등록 대기 중이지만 실제 등록되지 않습니다.`,
        );
      }
    }, 500),
    register(binding: KeybindRegistration) {
      const self = (globalThis as any)[CORE_KEYBIND_KEY];
      if (self._impl) {
        self._impl.register(binding);
      } else {
        self._queue.push(binding);
      }
    },
    getBindings() {
      const self = (globalThis as any)[CORE_KEYBIND_KEY];
      return self._impl?.getBindings() ?? [];
    },
    getKey(ext: string, action: string) {
      const self = (globalThis as any)[CORE_KEYBIND_KEY];
      return self._impl?.getKey(ext, action);
    },
  };
}

// ── 함수 ──

/** 외부 소비자가 안전하게 keybind API에 접근하는 유일한 진입점 */
export function getKeybindAPI(): CoreKeybindAPI {
  return (globalThis as any)[CORE_KEYBIND_KEY];
}

/** @internal index.ts에서 호출 — 실제 구현 주입 + 큐 flush */
export function _bootstrapKeybind(impl: CoreKeybindAPI): void {
  const bridge = (globalThis as any)[CORE_KEYBIND_KEY];
  // 단독 실행 경고 타이머 해제
  if (bridge._warnTimer) {
    clearTimeout(bridge._warnTimer);
    bridge._warnTimer = null;
  }

  bridge._impl = impl;

  // 큐에 대기 중인 바인딩 flush
  for (const binding of bridge._queue) {
    impl.register(binding);
  }
  bridge._queue.length = 0;
}
