import type { CarrierJobsParams } from "@sbluemin/fleet-core/carrier-jobs";

import {
  CarrierJobsCallComponent,
  CarrierJobsVerboseCallComponent,
  renderQuietResult,
  renderVerboseResult,
  type CarrierJobsToolResult,
} from "./render.js";
import { getCarrierJobsVerbose } from "./verbose-toggle.js";

interface CarrierJobsRenderContext {
  readonly lastComponent?: unknown;
}

export function renderCarrierJobsCall(args: unknown, context: CarrierJobsRenderContext | undefined): CarrierJobsCallComponent | CarrierJobsVerboseCallComponent {
  const typedArgs = args as CarrierJobsParams;
  if (getCarrierJobsVerbose()) {
    const component = context?.lastComponent instanceof CarrierJobsVerboseCallComponent
      ? context.lastComponent
      : new CarrierJobsVerboseCallComponent();
    component.setState(typedArgs);
    return component;
  }
  const component = context?.lastComponent instanceof CarrierJobsCallComponent
    ? context.lastComponent
    : new CarrierJobsCallComponent();
  component.setState(typedArgs);
  return component;
}

export function renderCarrierJobsResult(result: CarrierJobsToolResult): ReturnType<typeof renderQuietResult> | ReturnType<typeof renderVerboseResult> {
  return getCarrierJobsVerbose() ? renderVerboseResult(result) : renderQuietResult(result);
}
