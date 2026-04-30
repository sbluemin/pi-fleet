import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as core from "@sbluemin/fleet-core/admiral/carrier";

import {
  createDefaultResponseRenderer,
  createDefaultUserRenderer,
} from "../../tui/render/message-renderers.js";

export type { CarrierConfig } from "@sbluemin/fleet-core/admiral/carrier";

export {
  disableSortieCarrier,
  disableSquadronCarrier,
  enableSortieCarrier,
  enableSquadronCarrier,
  getActiveSquadronIds,
  getActiveTaskForceIds,
  getAllCliTypes,
  getRegisteredCarrierConfig,
  getRegisteredOrder,
  getSortieDisabledIds,
  getSortieEnabledIds,
  getSquadronEnabledIds,
  getTaskForceConfiguredIds,
  isSortieCarrierEnabled,
  isSquadronCarrierEnabled,
  notifyStatusUpdate,
  onStatusUpdate,
  reorderRegisteredByCliType,
  resolveCarrierBgColor,
  resolveCarrierCliDisplayName,
  resolveCarrierColor,
  resolveCarrierDisplayName,
  resolveCarrierRgb,
  setPendingCliTypeOverrides,
  setSortieDisabledCarriers,
  setSquadronEnabledCarriers,
  setTaskForceConfiguredCarriers,
  updateCarrierCliType,
} from "@sbluemin/fleet-core/admiral/carrier";

export function registerCarrier(
  pi: ExtensionAPI,
  config: core.CarrierConfig,
): void {
  core.registerCarrier(config);

  const userRenderer = config.renderUser ?? createDefaultUserRenderer(config);
  pi.registerMessageRenderer(`${config.id}-user`, userRenderer);

  const responseRenderer = config.renderResponse ?? createDefaultResponseRenderer(config);
  pi.registerMessageRenderer(`${config.id}-response`, responseRenderer);
}
