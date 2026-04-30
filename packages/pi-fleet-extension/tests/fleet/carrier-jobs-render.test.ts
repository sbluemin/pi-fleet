import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

import { renderCarrierJobsCall, renderCarrierJobsResult } from "../../src/tools/carrier_jobs/jobs.js";
import {
  CarrierJobsCallComponent,
  CarrierJobsVerboseCallComponent,
  formatQuietResult,
  renderQuietResult,
  renderVerboseResult,
  shortenJobId,
} from "../../src/tools/carrier_jobs/render.js";
import {
  getCarrierJobsVerbose,
  onCarrierJobsVerboseChange,
  resetCarrierJobsVerboseForTest,
  setCarrierJobsVerbose,
  toggleCarrierJobsVerbose,
} from "../../src/tools/carrier_jobs/verbose-toggle.js";

const testDir = dirname(fileURLToPath(import.meta.url));

beforeEach(() => {
  resetCarrierJobsVerboseForTest();
});

describe("carrier_jobs rendering", () => {
  it("defaults to quiet mode and toggles process-local verbose state", () => {
    const seen: boolean[] = [];
    const unsubscribe = onCarrierJobsVerboseChange((value) => { seen.push(value); });

    expect(getCarrierJobsVerbose()).toBe(false);
    setCarrierJobsVerbose(true);
    expect(getCarrierJobsVerbose()).toBe(true);
    expect(toggleCarrierJobsVerbose()).toBe(false);

    unsubscribe();
    setCarrierJobsVerbose(true);

    expect(seen).toEqual([true, false]);
  });

  it("shortens long job IDs with the carrier prefix and tail", () => {
    const short = shortenJobId("sortie:call_C3yYXMpTDNPAhMBc2J0kfMZk");

    expect(short.startsWith("sortie:…")).toBe(true);
    expect(short.endsWith("0kfMZk")).toBe(true);
  });

  it("renders quiet calls as a single compact line", () => {
    const component = new CarrierJobsCallComponent();
    component.setState({
      action: "result",
      format: "full",
      job_id: "taskforce:call_C3yYXMpTDNPAhMBc2J0kfMZk",
    });

    const lines = component.render();

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Carrier Jobs · result:full · taskforce:…0kfMZk");
  });

  it("renders verbose calls with structured details", () => {
    const component = new CarrierJobsVerboseCallComponent();
    component.setState({ action: "status", job_id: "sortie:abc123" });

    const output = component.render().join("\n");

    expect(output).toContain('"action": "status"');
    expect(output).toContain('"job_id": "sortie:abc123"');
  });

  it("uses quiet call and empty result components by default", () => {
    const call = renderCarrierJobsCall({ action: "list" }, {});
    const result = renderCarrierJobsResult(buildResult({ action: "list", ok: true, active: [], recent: [] }));

    expect(call).toBeInstanceOf(CarrierJobsCallComponent);
    expect(call.render()).toHaveLength(1);
    expect(result.render()).toEqual([]);
  });

  it("uses verbose call and result components when verbose mode is enabled", () => {
    setCarrierJobsVerbose(true);

    const call = renderCarrierJobsCall({ action: "status", job_id: "sortie:abc123" }, {});
    const result = renderCarrierJobsResult(buildResult({ action: "status", ok: true, job_id: "sortie:abc123", status: "done" }));

    expect(call).toBeInstanceOf(CarrierJobsVerboseCallComponent);
    expect(result.render().join("\n")).toContain('"status": "done"');
  });

  it("keeps quiet result rendering empty while preserving verbose JSON details", () => {
    const result = buildResult({ action: "cancel", ok: true, job_id: "sortie:abc123", cancelled: true });

    expect(renderQuietResult(result).render()).toEqual([]);
    expect(renderVerboseResult(result).render().join("\n")).toContain('"cancelled": true');
  });

  it("formats quiet result summaries for action-specific status text", () => {
    const list = formatQuietResult(buildResult({ action: "list", ok: true, active: [{ jobId: "sortie:a" }], recent: [{ jobId: "sortie:b" }] }));
    const full = formatQuietResult(buildResult({ action: "result", ok: true, job_id: "sortie:call_C3yYXMpTDNPAhMBc2J0kfMZk", full_result: "x".repeat(1500) }));

    expect(list).toContain("list · 1 active, 1 recent");
    expect(full).toContain("result:full · sortie:…0kfMZk · 2KB");
  });

  it("registers the verbose slash command in fleet boot", () => {
    const indexPath = join(testDir, "..", "..", "src", "commands", "fleet-pi-commands.ts");
    const source = readFileSync(indexPath, "utf8");

    expect(existsSync(indexPath)).toBe(true);
    expect(source).toContain('pi.registerCommand("fleet:jobs:verbose"');
    expect(source).toContain("toggleCarrierJobsVerbose");
    expect(source).toContain("Carrier Jobs verbose:");
  });
});

function buildResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    details: {},
  };
}
