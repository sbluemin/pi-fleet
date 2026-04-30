import type { CliType } from "@sbluemin/fleet-core/agent/provider/provider-client";

import type { ShellPopupBridge } from "../../../shell/tui/shell/types.js";

export interface BridgeLaunchContext {
  cli: CliType;
  model: string;
  sessionId: string;
  cwd: string;
  effort?: string;
}

export interface BridgeCommandSpec {
  command: string;
  cwd: string;
  title: string;
}

export interface ActiveBridgeSession {
  cli: CliType;
  model: string;
  sessionId: string;
  cwd: string;
  effort?: string;
}

export const BRIDGE_COMMAND_ID = "fleet:bridge:launch";
export const BRIDGE_DEFAULT_KEY = "alt+t";
export const BRIDGE_SCOPE = "default";
export const BRIDGE_EXTENSION_ID = "bridge";
export const BRIDGE_ACTION_ID = "launch";
export const BRIDGE_KEYBIND_CATEGORY = "Fleet Bridge";
export const BRIDGE_TITLE_PREFIX = "ACP Bridge";

export type InteractiveShellBridge = ShellPopupBridge | undefined;
