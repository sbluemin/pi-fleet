import * as FleetMetaphorServiceFacade from "../metaphor/index.js";

export interface FleetMetaphorServices {
  readonly core: typeof FleetMetaphorServiceFacade;
}

const METAPHOR_SERVICES: FleetMetaphorServices = {
  core: FleetMetaphorServiceFacade,
};

export function createMetaphorServices(): FleetMetaphorServices {
  return METAPHOR_SERVICES;
}
