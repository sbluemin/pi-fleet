import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerProviderRuntime from "./provider-register.js";

export function registerProvider(pi: ExtensionAPI): void {
  registerProviderRuntime(pi);
}
