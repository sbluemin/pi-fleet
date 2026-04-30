import type { ResolvedBinding } from "./types.js";

export function addBindingToList(
  bindings: ResolvedBinding[],
  binding: ResolvedBinding,
  onConflict?: (message: string) => void,
): void {
  const idx = bindings.findIndex(
    (b) => b.extension === binding.extension && b.action === binding.action,
  );

  const conflict = bindings.find(
    (b) =>
      b.resolvedKey === binding.resolvedKey &&
      !(b.extension === binding.extension && b.action === binding.action),
  );
  if (conflict) {
    binding.conflicted = true;
    conflict.conflicted = true;
    onConflict?.(
      `[core-keybind] 키 충돌: "${binding.resolvedKey}" — ` +
      `${conflict.extension}/${conflict.action} ↔ ${binding.extension}/${binding.action}`,
    );
  }

  if (idx >= 0) {
    bindings[idx] = binding;
  } else {
    bindings.push(binding);
  }
}

export function getBindingsFromList(bindings: ResolvedBinding[]): ResolvedBinding[] {
  return [...bindings];
}

export function getKeyFromList(
  bindings: ResolvedBinding[],
  extension: string,
  action: string,
): string | undefined {
  const binding = bindings.find(
    (b) => b.extension === extension && b.action === action,
  );
  return binding?.resolvedKey;
}
