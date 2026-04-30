import type { AgentStreamingSink, FleetHostPorts, FleetLogPort } from "@sbluemin/fleet-core";

import { getLogAPI } from "@sbluemin/fleet-core/services/log";
import { setAgentPanelServiceLoading, setAgentPanelServiceStatus } from "../../tui/panel/config.js";

const fleetBootLogPort: FleetLogPort = (level, message, details) => {
  getLogAPI().log(level, "fleet-boot", message, details as Parameters<ReturnType<typeof getLogAPI>["log"]>[3]);
};

export function createFleetBootHostPorts(streamingSink?: AgentStreamingSink): FleetHostPorts {
  return {
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
