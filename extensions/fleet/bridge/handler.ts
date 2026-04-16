import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import {
  DEFAULT_BRIDGE_SCOPE,
  getBridgeScopeSession,
  getOrInitState,
  getSessionLaunchConfig,
  parseModelId,
} from "../../core/agentclientprotocol/provider-types.js";
import { SHELL_POPUP_BRIDGE_KEY, type ShellPopupBridge } from "../../core/shell/types.js";
import { buildBridgeCommand } from "./command.js";
import type { ActiveBridgeSession, InteractiveShellBridge } from "./types.js";

export async function launchBridgeShell(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    throw new Error("Bridge popup is only available in interactive TUI mode.");
  }

  const shellBridge = getShellBridge();
  if (!shellBridge) {
    throw new Error("Interactive shell bridge is not available.");
  }
  if (shellBridge.isOpen()) {
    ctx.ui.notify("브리지 쉘이 이미 열려 있습니다.", "warning");
    return;
  }

  const session = getActiveBridgeSession();
  const command = buildBridgeCommand({
    cli: session.cli,
    model: session.model,
    sessionId: session.sessionId,
    cwd: session.cwd,
    effort: session.effort,
  });

  await shellBridge.open(command);
}

function getActiveBridgeSession(): ActiveBridgeSession {
  const state = getOrInitState();
  const sessionKey = getBridgeScopeSession(DEFAULT_BRIDGE_SCOPE);
  if (!sessionKey) {
    throw new Error("기본 bridge scope에 활성 ACP 세션이 없습니다.");
  }

  const session = state.sessions.get(sessionKey);
  if (!session?.sessionId) {
    throw new Error("활성 ACP 세션을 찾을 수 없습니다.");
  }

  const launchConfig = getSessionLaunchConfig(sessionKey);
  const parsed = parseModelId(launchConfig?.modelId ?? "");
  if (!parsed) {
    throw new Error("활성 ACP 세션의 모델 ID를 해석할 수 없습니다.");
  }

  return {
    cli: parsed.cli,
    model: parsed.backendModel,
    sessionId: session.sessionId,
    cwd: session.cwd,
    effort: launchConfig?.effort,
  };
}

function getShellBridge(): InteractiveShellBridge {
  return (globalThis as Record<string, unknown>)[SHELL_POPUP_BRIDGE_KEY] as ShellPopupBridge | undefined;
}
