import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerDefaultCarrierPersonas } from "@sbluemin/fleet-core/admiral/carrier/personas";

import { registerSingleCarrier } from "../../tools/carrier/register.js";

export function registerFleetCarriers(pi: ExtensionAPI): void {
  registerDefaultCarrierPersonas({
    register(cli, metadata, options) {
      registerSingleCarrier(pi, cli, metadata, options);
    },
  });
}
