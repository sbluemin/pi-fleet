import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { reregisterCoreKeybinds } from "../../keybinds/core-keybind-register.js";

export default function registerKeybindLifecycle(pi: ExtensionAPI): void {
  pi.on("session_start", (event) => {
    if (event.reason === "startup") return;
    reregisterCoreKeybinds(pi);
  });
}
