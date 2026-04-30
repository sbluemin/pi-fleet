import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  attachStatusContext as attachCoreStatusContext,
  detachStatusContext,
  getServiceSnapshots,
  initServiceStatus,
  refreshStatusNow as refreshCoreStatusNow,
  refreshStatusQuiet,
  type ServiceStatusCallbacks,
  type ServiceStatusContextPort,
} from "@sbluemin/fleet-core/agent/shared/service-status";

export {
  detachStatusContext,
  getServiceSnapshots,
  initServiceStatus,
  refreshStatusQuiet,
  type ServiceStatusCallbacks,
};

export function attachStatusContext(ctx: ExtensionContext): void {
  attachCoreStatusContext(createStatusContextPort(ctx));
}

export async function refreshStatusNow(ctx: ExtensionContext): Promise<void> {
  await refreshCoreStatusNow(createStatusContextPort(ctx));
}

function createStatusContextPort(ctx: ExtensionContext): ServiceStatusContextPort {
  return {
    get hasUI() {
      return ctx.hasUI;
    },
    getSessionId() {
      return ctx.sessionManager.getSessionId();
    },
    notify(message, level) {
      ctx.ui.notify(message, level);
    },
  };
}
