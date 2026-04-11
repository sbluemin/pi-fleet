import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import registerAcpProvider from "./agentclientprotocol/provider-register.js";
import registerHud from "./hud/register.js";
import registerImprovePrompt from "./improve-prompt/register.js";
import registerKeybind from "./keybind/register.js";
import registerLog from "./log/register.js";
import registerProviderGuard from "./provider-guard/register.js";
import registerSettings from "./settings/register.js";
import registerShell from "./shell/register.js";
import registerSummarize from "./summarize/register.js";
import registerThinkingTimer from "./thinking-timer/register.js";
import registerWelcome from "./welcome/register.js";

export default function registerCore(pi: ExtensionAPI) {
  registerKeybind(pi);
  registerSettings(pi);
  registerLog(pi);
  registerWelcome(pi);
  registerHud(pi);
  registerShell(pi);
  registerImprovePrompt(pi);
  registerSummarize(pi);
  registerThinkingTimer(pi);
  registerProviderGuard(pi);
  registerAcpProvider(pi);
}
