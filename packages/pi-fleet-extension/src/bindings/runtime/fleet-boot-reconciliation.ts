import type { CliType } from "@sbluemin/fleet-core/agent/provider-client";
import {
  getConfiguredTaskForceCarrierIds,
  reconcileActiveModelSelections,
  saveSquadronEnabled,
} from "@sbluemin/fleet-core/admiral/store";

import { syncModelConfig } from "../../commands/carrier/model-ui.js";
import {
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  getSquadronEnabledIds,
  notifyStatusUpdate,
  setSquadronEnabledCarriers,
  setTaskForceConfiguredCarriers,
} from "../../tools/carrier/framework.js";

export function scheduleFleetBootReconciliation(): void {
  setTimeout(() => {
    reconcileRegisteredCarrierModels();
    pruneStaleSquadronIds();
    syncTaskForceConfiguredCarriers();
    notifyStatusUpdate();
  }, 0);
}

function reconcileRegisteredCarrierModels(): void {
  const cliTypesByCarrier = Object.fromEntries(
    getRegisteredOrder()
      .map((carrierId) => {
        const config = getRegisteredCarrierConfig(carrierId);
        return config ? [carrierId, config.cliType] : null;
      })
      .filter((entry): entry is [string, CliType] => entry !== null),
  );

  if (Object.keys(cliTypesByCarrier).length > 0 && reconcileActiveModelSelections(cliTypesByCarrier)) {
    syncModelConfig();
  }
}

function pruneStaleSquadronIds(): void {
  const registeredSet = new Set(getRegisteredOrder());
  const squadronIds = getSquadronEnabledIds();
  const validSquadronIds = squadronIds.filter((id) => registeredSet.has(id));
  if (validSquadronIds.length !== squadronIds.length) {
    setSquadronEnabledCarriers(validSquadronIds);
    saveSquadronEnabled(validSquadronIds);
  }
}

function syncTaskForceConfiguredCarriers(): void {
  const tfIds = getConfiguredTaskForceCarrierIds(getRegisteredOrder());
  setTaskForceConfiguredCarriers(tfIds);
}
