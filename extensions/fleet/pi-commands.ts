import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { refreshStatusNow } from "../core/agentclientprotocol/service-status/store.js";
import {
  setCarrierJobsVerbose,
  toggleCarrierJobsVerbose,
} from "./shipyard/carrier_jobs/verbose-toggle.js";

export function registerFleetPiCommands(pi: ExtensionAPI): void {
  pi.registerCommand("fleet:agent:status", {
    description: "지원 CLI 서비스 상태를 즉시 새로고침",
    handler: async (_args, ctx) => {
      await refreshStatusNow(ctx);
    },
  });

  pi.registerCommand("fleet:jobs:verbose", {
    description: "carrier_jobs 렌더링 상세 모드 토글",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      const enabled = value === "on"
        ? (setCarrierJobsVerbose(true), true)
        : value === "off"
          ? (setCarrierJobsVerbose(false), false)
          : toggleCarrierJobsVerbose();
      ctx.ui.notify(`Carrier Jobs verbose: ${enabled ? "ON" : "OFF"}`, "info");
    },
  });
}
