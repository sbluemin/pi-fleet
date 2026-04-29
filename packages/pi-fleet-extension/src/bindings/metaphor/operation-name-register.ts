import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { registerOperationNameCommand } from "../../commands/metaphor/operation-name-command.js";

export function registerOperationName(pi: ExtensionAPI): void {
  registerOperationNameCommand(pi);
}
