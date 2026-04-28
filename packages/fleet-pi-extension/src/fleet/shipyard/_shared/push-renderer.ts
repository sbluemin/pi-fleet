import type { MessageRenderer } from "@mariozechner/pi-coding-agent";

export const CARRIER_RESULT_CUSTOM_TYPE = "carrier-result";

export interface CarrierResultMessageDetails {
  jobIds: string[];
  summaries: string[];
}

export const carrierResultRenderer: MessageRenderer<CarrierResultMessageDetails> = () => undefined;
