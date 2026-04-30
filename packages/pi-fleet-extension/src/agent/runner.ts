import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  UnifiedAgentRequestOptions as CoreUnifiedAgentRequestOptions,
  UnifiedAgentResult,
} from "@sbluemin/fleet-core";

import { getFleetRuntime, withAgentRequestContext } from "../fleet.js";

export type {
  UnifiedAgentBackgroundRequestOptions,
  UnifiedAgentResult,
  UnifiedAgentRequestStatus,
} from "@sbluemin/fleet-core";

export interface UnifiedAgentRequestOptions extends CoreUnifiedAgentRequestOptions {
  ctx: ExtensionContext;
}

export interface UnifiedAgentRequestBridge {
  requestUnifiedAgent(options: UnifiedAgentRequestOptions): Promise<UnifiedAgentResult>;
}

type RunAgentRequestOptions = UnifiedAgentRequestOptions;

const UNIFIED_AGENT_REQUEST_KEY = "__pi_ua_request__";

export async function runAgentRequest(options: RunAgentRequestOptions): Promise<UnifiedAgentResult> {
  return withAgentRequestContext(options.ctx, () =>
    getFleetRuntime().agent.run(toCoreOptions(options)));
}

export function exposeAgentApi(): UnifiedAgentRequestBridge {
  const bridge: UnifiedAgentRequestBridge = {
    requestUnifiedAgent: (options) =>
      runAgentRequest({
        ...options,
      }),
  };

  (globalThis as Record<string, unknown>)[UNIFIED_AGENT_REQUEST_KEY] = bridge;
  return bridge;
}

function toCoreOptions(options: RunAgentRequestOptions): CoreUnifiedAgentRequestOptions {
  const { ctx, cwd, ...rest } = options;
  return {
    ...rest,
    cwd: cwd ?? ctx.cwd,
  };
}
