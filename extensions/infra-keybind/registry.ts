/**
 * infra-keybind/registry.ts — 바인딩 레지스트리
 *
 * 등록된 모든 키바인딩을 관리한다.
 */

import type { ResolvedBinding } from "./types.js";

/** 등록 순서 유지를 위한 배열 */
const bindings: ResolvedBinding[] = [];

/** 바인딩 등록 (동일 extension+action이 이미 있으면 교체, 키 충돌 감지) */
export function addBinding(binding: ResolvedBinding): void {
  const idx = bindings.findIndex(
    (b) => b.extension === binding.extension && b.action === binding.action,
  );

  // 동일 resolvedKey를 가진 다른 바인딩과의 충돌 감지
  const conflict = bindings.find(
    (b) =>
      b.resolvedKey === binding.resolvedKey &&
      !(b.extension === binding.extension && b.action === binding.action),
  );
  if (conflict) {
    binding.conflicted = true;
    conflict.conflicted = true;
    console.warn(
      `[infra-keybind] 키 충돌: "${binding.resolvedKey}" — ` +
      `${conflict.extension}/${conflict.action} ↔ ${binding.extension}/${binding.action}`,
    );
  }

  if (idx >= 0) {
    bindings[idx] = binding;
  } else {
    bindings.push(binding);
  }
}

/** 등록된 모든 바인딩 반환 (등록 순서 보존) */
export function getBindings(): ResolvedBinding[] {
  return [...bindings];
}

/** 특정 확장/액션의 최종 키 반환 */
export function getKey(extension: string, action: string): string | undefined {
  const binding = bindings.find(
    (b) => b.extension === extension && b.action === action,
  );
  return binding?.resolvedKey;
}
