export { CORE_KEYBIND_KEY } from "@sbluemin/fleet-core/services/keybind";
import { CORE_KEYBIND_KEY } from "@sbluemin/fleet-core/services/keybind";
import type {
  CoreKeybindAPI,
  KeybindRegistration,
  ResolvedBinding,
} from "@sbluemin/fleet-core/services/keybind";

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

export function getKeybindAPI(): CoreKeybindAPI {
  return (globalThis as any)[CORE_KEYBIND_KEY];
}

export function prepareKeybindBridgeForExtensionLoad(): void {
  const bridge = (globalThis as any)[CORE_KEYBIND_KEY];
  bridge._impl = null;
  bridge._queue.length = 0;
  bridge._bindings.length = 0;
}

export function _bootstrapKeybind(impl: CoreKeybindAPI): void {
  const bridge = (globalThis as any)[CORE_KEYBIND_KEY];
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
