/**
 * infra-keybind/types.ts — API 인터페이스 및 타입 정의
 *
 * globalThis 키와 bridge interface를 이 파일에서 정의한다.
 * 다른 확장이 types.ts를 import하는 것만으로 globalThis API 접근이 보장된다.
 * (AGENTS.md: "globalThis key와 bridge interface는 소유 확장의 types.ts에 정의")
 */

/** globalThis 브릿지 키 */
export const INFRA_KEYBIND_KEY = "__infra_keybind__";

/** 단축키 등록 요청 */
export interface KeybindRegistration {
  /** 확장 디렉토리명 (e.g. "utils-improve-prompt") */
  extension: string;
  /** 액션 식별자 (e.g. "meta-prompt") */
  action: string;
  /** 소스 내 기본 단축키 */
  defaultKey: string;
  /** 단축키 설명 */
  description: string;
  /** 오버레이 그룹핑용 카테고리 (선택) */
  category?: string;
  /** 단축키 핸들러 (ExtensionContext) */
  handler: (ctx: any) => void | Promise<void>;
}

/** 오버라이드가 적용된 최종 바인딩 */
export interface ResolvedBinding extends KeybindRegistration {
  /** keybindings.json 오버라이드 적용 후 최종 키 */
  resolvedKey: string;
  /** 다른 바인딩과 동일 키 충돌 여부 */
  conflicted?: boolean;
}

/** infra-keybind가 globalThis를 통해 제공하는 API */
export interface InfraKeybindAPI {
  /** 단축키 등록 (pi.registerShortcut 대행) */
  register(binding: KeybindRegistration): void;
  /** 등록된 모든 바인딩 반환 */
  getBindings(): ResolvedBinding[];
  /** 특정 확장/액션의 최종 키 반환 */
  getKey(extension: string, action: string): string | undefined;
}

// ── 큐 기반 stub API (globalThis 객체에 상태 보관) ──
// ⚠️ pi는 각 확장을 별도 번들로 로드하므로 모듈 레벨 변수는
//    확장 간에 공유되지 않는다. 따라서 _queue와 _impl을
//    globalThis 객체의 프로퍼티로 저장하여 번들 간 공유를 보장한다.
// 가드: 이미 등록되어 있으면(다른 번들에서 먼저 실행됨) 덮어쓰지 않는다.

if (!(globalThis as any)[INFRA_KEYBIND_KEY]) {
  (globalThis as any)[INFRA_KEYBIND_KEY] = {
    _impl: null as InfraKeybindAPI | null,
    _queue: [] as KeybindRegistration[],
    _warnTimer: setTimeout(() => {
      const self = (globalThis as any)[INFRA_KEYBIND_KEY];
      if (!self._impl && self._queue.length > 0) {
        console.warn(
          "[infra-keybind] infra-keybind 확장이 로드되지 않았습니다. " +
          `큐에 ${self._queue.length}개의 단축키가 등록 대기 중이지만 실제 등록되지 않습니다.`,
        );
      }
    }, 500),
    register(binding: KeybindRegistration) {
      const self = (globalThis as any)[INFRA_KEYBIND_KEY];
      if (self._impl) {
        self._impl.register(binding);
      } else {
        self._queue.push(binding);
      }
    },
    getBindings() {
      const self = (globalThis as any)[INFRA_KEYBIND_KEY];
      return self._impl?.getBindings() ?? [];
    },
    getKey(ext: string, action: string) {
      const self = (globalThis as any)[INFRA_KEYBIND_KEY];
      return self._impl?.getKey(ext, action);
    },
  };
}

/** @internal index.ts에서 호출 — 실제 구현 주입 + 큐 flush */
export function _bootstrapKeybind(impl: InfraKeybindAPI): void {
  const bridge = (globalThis as any)[INFRA_KEYBIND_KEY];
  // 단독 실행 경고 타이머 해제
  if (bridge._warnTimer) {
    clearTimeout(bridge._warnTimer);
    bridge._warnTimer = null;
  }
  bridge._impl = impl;
  for (const binding of bridge._queue) {
    impl.register(binding);
  }
  bridge._queue.length = 0;
}
