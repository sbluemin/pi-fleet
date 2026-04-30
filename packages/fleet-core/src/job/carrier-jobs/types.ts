export type CarrierJobsAction = "status" | "result" | "cancel" | "list";

export type CarrierJobsResultFormat = "summary" | "full";

export interface CarrierJobsParams {
  action: CarrierJobsAction;
  job_id?: string;
  format?: CarrierJobsResultFormat;
}

export interface CarrierJobsAvailability {
  summary_available: boolean;
  full_available: boolean;
  full_invalidated: boolean;
}
