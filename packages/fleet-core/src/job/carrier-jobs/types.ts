export type CarrierJobsAction = "status" | "result" | "cancel" | "list";

export interface CarrierJobsParams {
  action: CarrierJobsAction;
  job_id?: string;
}

export interface CarrierJobsAvailability {
  summary_available: boolean;
  full_available: boolean;
  full_invalidated: boolean;
}
