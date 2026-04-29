import type { FleetHostPorts, FleetLogPort } from "@sbluemin/fleet-core";
import type { AgentStreamingSink } from "@sbluemin/fleet-core/streaming-sink";

import { getLogAPI } from "../../config-bridge/log/bridge.js";
import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "../../tui/panel/config.js";

const fleetBootLogPort: FleetLogPort = (level, message, details) => {
  getLogAPI().log(level, "fleet-boot", message, details as Parameters<ReturnType<typeof getLogAPI>["log"]>[3]);
};

export function createFleetBootHostPorts(streamingSink?: AgentStreamingSink): FleetHostPorts {
  return {
    appendStreamBlock() {},
    syncPanelColumn() {},
    endStreamColumn() {},
    sendCarrierResultPush() {},
    notify(level, message) {
      getLogAPI().log(level, "fleet-boot", message);
    },
    loadSetting() { return undefined; },
    saveSetting() {},
    registerKeybind() { return () => {}; },
    log: fleetBootLogPort,
    now: () => Date.now(),
    getDeliverAs() { return undefined; },
    serviceStatus: {
      setLoading: setAgentPanelServiceLoading,
      setStatus: setAgentPanelServiceStatus,
    },
    streamingSink,
  };
}
