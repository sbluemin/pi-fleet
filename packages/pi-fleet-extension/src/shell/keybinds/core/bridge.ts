import { CORE_KEYBIND_KEY } from "./types.js";
import type {
  CoreKeybindAPI,
  KeybindRegistration,
  ResolvedBinding,
} from "./types.js";

export { CORE_KEYBIND_KEY } from "./types.js";

const bootstrapQueue: KeybindRegistration[] = [];
const keybindState = {
  _bindings: [] as ResolvedBinding[],
};

let activeApi: CoreKeybindAPI | null = null;
let warnTimer: ReturnType<typeof setTimeout> | null = null;

const keybindService: CoreKeybindAPI & typeof keybindState = {
  ...keybindState,
  register(binding: KeybindRegistration) {
    if (activeApi) {
      activeApi.register(binding);
      return;
    }
    bootstrapQueue.push(binding);
  },
  getBindings() {
    return activeApi?.getBindings() ?? [];
  },
  getKey(ext: string, action: string) {
    return activeApi?.getKey(ext, action);
  },
};

if (!(globalThis as any)[CORE_KEYBIND_KEY]) {
  (globalThis as any)[CORE_KEYBIND_KEY] = keybindService;
} else if (!(globalThis as any)[CORE_KEYBIND_KEY]._bindings) {
  (globalThis as any)[CORE_KEYBIND_KEY] = keybindService;
}

export function getKeybindAPI(): CoreKeybindAPI {
  return (globalThis as any)[CORE_KEYBIND_KEY];
}

export function prepareKeybindBridgeForExtensionLoad(): void {
  activeApi = null;
  bootstrapQueue.length = 0;
  keybindService._bindings.length = 0;
  warnTimer = setTimeout(() => {
    if (!activeApi && bootstrapQueue.length > 0) {
      console.warn(
        "[core-keybind] core-keybind 확장이 로드되지 않았습니다. " +
        `큐에 ${bootstrapQueue.length}개의 단축키가 등록 대기 중이지만 실제 등록되지 않습니다.`,
      );
    }
  }, 500);
}

export function _bootstrapKeybind(impl: CoreKeybindAPI): void {
  if (warnTimer) {
    clearTimeout(warnTimer);
    warnTimer = null;
  }

  activeApi = impl;

  for (const binding of bootstrapQueue) {
    impl.register(binding);
  }
  bootstrapQueue.length = 0;
}
