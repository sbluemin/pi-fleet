import { describe, expect, it } from "vitest";

import { PROTOCOL_PREAMBLE } from "../admiral/prompts.js";
import { DELEGATION_POLICY } from "../admiral/standing-orders/delegation-policy.js";
import { SORTIE_MANIFEST, buildSortieToolSchema } from "../shipyard/carrier/prompts.js";
import { CARRIER_JOBS_MANIFEST, buildCarrierJobsSchema } from "../shipyard/carrier_jobs/prompts.js";
import { SQUADRON_MANIFEST, buildSquadronSchema } from "../shipyard/squadron/prompts.js";
import { TASKFORCE_MANIFEST, buildTaskForceSchema } from "../shipyard/taskforce/prompts.js";
import { CARRIER_RESULT_CUSTOM_TYPE } from "../shipyard/_shared/push-renderer.js";

describe("carrier prompt doctrine", () => {
  it("contains fire-and-forget doctrine and carrier_jobs read-once guidance", () => {
    expect(PROTOCOL_PREAMBLE).toContain("[carrier:result]");
    expect(PROTOCOL_PREAMBLE).toContain("carrier_jobs");
    expect(PROTOCOL_PREAMBLE).toContain("read-once");
    expect(PROTOCOL_PREAMBLE).toContain("Do not poll carrier_jobs immediately after a carrier launch");
    expect(DELEGATION_POLICY.prompt).toContain("Lookup/control detached carrier jobs");
  });

  it("keeps one manifest per carrier tool and carrier_jobs has no roster", () => {
    expect(SORTIE_MANIFEST.id).toBe("carriers_sortie");
    expect(SQUADRON_MANIFEST.id).toBe("carrier_squadron");
    expect(TASKFORCE_MANIFEST.id).toBe("carrier_taskforce");
    expect(CARRIER_JOBS_MANIFEST.id).toBe("carrier_jobs");
    expect(CARRIER_JOBS_MANIFEST.usageGuidelines.join("\n")).not.toContain("Available Carriers");
    expect(CARRIER_JOBS_MANIFEST.usageGuidelines.join("\n")).toContain("finalized-only");
    expect(CARRIER_JOBS_MANIFEST.whenNotToUse.join("\n")).toContain("Do not poll carrier_jobs immediately after a carrier launch");
    expect(CARRIER_JOBS_MANIFEST.usageGuidelines.join("\n")).toContain("follow-up push");
  });

  it("registers the hidden carrier result custom renderer contract", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const indexSource = fs.readFileSync(path.join(process.cwd(), "index.ts"), "utf8");
    expect(CARRIER_RESULT_CUSTOM_TYPE).toBe("carrier-result");
    expect(indexSource).toContain("pi.registerMessageRenderer(CARRIER_RESULT_CUSTOM_TYPE, carrierResultRenderer)");
  });

  it("does not expose wait/mode/fallback queue schema knobs", () => {
    const schemaKeys = [
      Object.keys((buildSortieToolSchema(["genesis"]) as any).properties),
      Object.keys((buildSquadronSchema(["genesis"]) as any).properties),
      Object.keys((buildTaskForceSchema(["genesis"]) as any).properties),
      Object.keys((buildCarrierJobsSchema() as any).properties),
    ].flat();
    const manifestText = [
      JSON.stringify(SORTIE_MANIFEST),
      JSON.stringify(SQUADRON_MANIFEST),
      JSON.stringify(TASKFORCE_MANIFEST),
      JSON.stringify(CARRIER_JOBS_MANIFEST),
    ].join("\n");

    expect(schemaKeys).not.toEqual(expect.arrayContaining(["max_wait_ms", "wait", "mode"]));
    expect(manifestText).not.toMatch(/max_wait_ms|temporary-client|queue policy|fallback mode/i);
    const combined = `${schemaKeys.join("\n")}\n${manifestText}`;
    expect(combined).toContain("job_id");
    expect(combined).toContain("accepted");
  });
});
