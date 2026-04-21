/**
 * core-keybind/registry.ts — 바인딩 레지스트리
 *
 * 등록된 모든 키바인딩을 관리한다.
 * 바인딩 배열은 globalThis에 보관하여 모듈 재로드 시 유실을 방지한다.
 */

import { CORE_KEYBIND_KEY } from "./bridge.js";
import type { ResolvedBinding } from "./types.js";

/** globalThis에 보관된 바인딩 배열 접근 */
function bindings(): ResolvedBinding[] {
  return (globalThis as any)[CORE_KEYBIND_KEY]._bindings;
}

/** 바인딩 등록 (동일 extension+action이 이미 있으면 교체, 키 충돌 감지) */
export function addBinding(binding: ResolvedBinding): void {
  const arr = bindings();
  const idx = arr.findIndex(
    (b) => b.extension === binding.extension && b.action === binding.action,
  );

  // 동일 resolvedKey를 가진 다른 바인딩과의 충돌 감지
  const conflict = arr.find(
    (b) =>
      b.resolvedKey === binding.resolvedKey &&
      !(b.extension === binding.extension && b.action === binding.action),
  );
  if (conflict) {
    binding.conflicted = true;
    conflict.conflicted = true;
    console.warn(
      `[core-keybind] 키 충돌: "${binding.resolvedKey}" — ` +
      `${conflict.extension}/${conflict.action} ↔ ${binding.extension}/${binding.action}`,
    );
  }

  if (idx >= 0) {
    arr[idx] = binding;
  } else {
    arr.push(binding);
  }
}

/** 등록된 모든 바인딩 반환 (등록 순서 보존) */
export function getBindings(): ResolvedBinding[] {
  return [...bindings()];
}

/** 특정 확장/액션의 최종 키 반환 */
export function getKey(extension: string, action: string): string | undefined {
  const binding = bindings().find(
    (b) => b.extension === extension && b.action === action,
  );
  return binding?.resolvedKey;
}
