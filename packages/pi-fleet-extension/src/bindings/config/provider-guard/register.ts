import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerCoreProviderGuardCommand from "../../../commands/core-provider-guard-command.js";

export default function registerProviderGuardLifecycle(pi: ExtensionAPI): void {
  registerCoreProviderGuardCommand(pi);
}
