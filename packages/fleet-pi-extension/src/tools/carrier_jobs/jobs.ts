import {
  dispatchCarrierJobsAction,
  CARRIER_JOBS_DESCRIPTION,
  CARRIER_JOBS_MANIFEST,
  buildCarrierJobsPromptGuidelines,
  buildCarrierJobsPromptSnippet,
  buildCarrierJobsSchema,
  type CarrierJobsParams,
} from "@sbluemin/fleet-core/carrier-jobs";
import { registerToolPromptManifest } from "@sbluemin/fleet-core/admiral/tool-prompt-manifest";

import { CarrierJobsCallComponent, CarrierJobsVerboseCallComponent, renderQuietResult, renderVerboseResult } from "./render.js";
import { getCarrierJobsVerbose } from "./verbose-toggle.js";

export { dispatchCarrierJobsAction };

export function buildCarrierJobsToolConfig() {
  registerToolPromptManifest(CARRIER_JOBS_MANIFEST);

  return {
    name: "carrier_jobs",
    label: "Carrier Jobs",
    description: CARRIER_JOBS_DESCRIPTION,
    promptSnippet: buildCarrierJobsPromptSnippet(),
    promptGuidelines: buildCarrierJobsPromptGuidelines(),
    parameters: buildCarrierJobsSchema(),
    renderCall(args: unknown, _theme: unknown, context: any) {
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
    },
    renderResult(result: any) {
      return getCarrierJobsVerbose() ? renderVerboseResult(result) : renderQuietResult(result);
    },
    async execute(
      _id: string,
      params: Record<string, unknown>,
    ) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(dispatchCarrierJobsAction(params as unknown as CarrierJobsParams), null, 2) }],
        details: {},
      };
    },
  };
}
