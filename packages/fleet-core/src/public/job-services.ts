import * as CarrierJobsServiceFacade from "../admiral/carrier-jobs/index.js";
import * as JobServiceFacade from "../services/job/index.js";

export interface FleetJobServices {
  readonly archive: typeof JobServiceFacade;
  readonly carrierJobs: typeof CarrierJobsServiceFacade;
}

const JOB_SERVICES: FleetJobServices = {
  archive: JobServiceFacade,
  carrierJobs: CarrierJobsServiceFacade,
};

export function createJobServices(): FleetJobServices {
  return JOB_SERVICES;
}
