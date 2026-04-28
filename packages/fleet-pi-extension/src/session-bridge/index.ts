import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerAcpProvider from "./agentclientprotocol/provider-register.js";

export function mountSessionBridge(pi: ExtensionAPI): void {
  registerAcpProvider(pi);
}
