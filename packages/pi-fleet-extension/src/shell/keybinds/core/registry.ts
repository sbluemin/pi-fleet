import type { ResolvedBinding } from "./types.js";

import { getKeybindBindings } from "./bridge.js";

function bindings(): ResolvedBinding[] {
  return getKeybindBindings();
}

export function addBinding(binding: ResolvedBinding): void {
  const bindingList = bindings();
  const idx = bindingList.findIndex(
    (b) => b.extension === binding.extension && b.action === binding.action,
  );

  if (idx >= 0) {
    bindingList[idx] = binding;
  } else {
    bindingList.push(binding);
  }

  recomputeConflicts(bindingList, binding);
}

export function getBindings(): ResolvedBinding[] {
  return [...bindings()];
}

export function getKey(extension: string, action: string): string | undefined {
  const binding = bindings().find(
    (b) => b.extension === extension && b.action === action,
  );
  return binding?.resolvedKey;
}

function recomputeConflicts(
  bindingList: ResolvedBinding[],
  changedBinding: ResolvedBinding,
): void {
  for (const binding of bindingList) {
    binding.conflicted = false;
  }

  for (let i = 0; i < bindingList.length; i += 1) {
    for (let j = i + 1; j < bindingList.length; j += 1) {
      const left = bindingList[i];
      const right = bindingList[j];
      if (left.resolvedKey !== right.resolvedKey) continue;

      left.conflicted = true;
      right.conflicted = true;
      if (isSameBinding(left, changedBinding) || isSameBinding(right, changedBinding)) {
        console.warn(
          `[core-keybind] 키 충돌: "${changedBinding.resolvedKey}" — ` +
          `${left.extension}/${left.action} ↔ ${right.extension}/${right.action}`,
        );
      }
    }
  }
}

function isSameBinding(left: ResolvedBinding, right: ResolvedBinding): boolean {
  return left.extension === right.extension && left.action === right.action;
}
