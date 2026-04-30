import {
  addBindingToList,
  getBindingsFromList,
  getKeyFromList,
  type ResolvedBinding,
} from "@sbluemin/fleet-core/services/keybind";

import { CORE_KEYBIND_KEY } from "./bridge.js";

function bindings(): ResolvedBinding[] {
  return (globalThis as any)[CORE_KEYBIND_KEY]._bindings;
}

export function addBinding(binding: ResolvedBinding): void {
  addBindingToList(bindings(), binding, (message) => console.warn(message));
}

export function getBindings(): ResolvedBinding[] {
  return getBindingsFromList(bindings());
}

export function getKey(extension: string, action: string): string | undefined {
  return getKeyFromList(bindings(), extension, action);
}
