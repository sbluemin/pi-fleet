import type { AgentStreamingSink, FleetHostPorts } from "@sbluemin/fleet-core";

import { getLogAPI } from "@sbluemin/fleet-core/services/log";
import {
  setAgentPanelServiceLoading,
  setAgentPanelServiceStatus,
} from "./agent/ui/panel/config.js";

export function createFleetHostPorts(streamingSink?: AgentStreamingSink): FleetHostPorts {
  return {
    sendCarrierResultPush() {},
    notify(level, message) {
      getLogAPI().log(level, "fleet-boot", message);
    },
    loadSetting() {
      return undefined;
    },
    saveSetting() {},
    registerKeybind() {
      return () => {};
    },
    now: () => Date.now(),
    getDeliverAs() {
      return undefined;
    },
    serviceStatus: {
      setLoading: setAgentPanelServiceLoading,
      setStatus: setAgentPanelServiceStatus,
    },
    streamingSink,
  };
}
