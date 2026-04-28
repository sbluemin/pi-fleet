import type { CliType } from "@sbluemin/unified-agent";

import {
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  getSquadronEnabledIds,
  notifyStatusUpdate,
  setSquadronEnabledCarriers,
  setTaskForceConfiguredCarriers,
} from "./shipyard/carrier/framework.js";
import {
  getConfiguredTaskForceCarrierIds,
  reconcileActiveModelSelections,
  saveSquadronEnabled,
} from "./shipyard/store.js";
import { syncModelConfig } from "./shipyard/carrier/model-ui.js";

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
