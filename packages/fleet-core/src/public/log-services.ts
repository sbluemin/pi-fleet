import * as LogServiceFacade from "../services/log/index.js";

export interface FleetLogServices {
  readonly core: typeof LogServiceFacade;
}

const LOG_SERVICES: FleetLogServices = {
  core: LogServiceFacade,
};

export function createLogServices(): FleetLogServices {
  return LOG_SERVICES;
}
