import { beforeEach, describe, expect, it } from "vitest";

import { configureBridgeStateStorage } from "@sbluemin/fleet-core/bridge";
import {
  appendTextBlock,
  createRun,
} from "@sbluemin/fleet-core/bridge/streaming";
import type { PanelJob } from "../../src/tui/panel/types.js";
import { renderPanelFull } from "../../src/tui/render/panel-renderer.js";

beforeEach(() => {
  configureBridgeStateStorage(null);
  (globalThis as any)["__pi_stream_store__"] = undefined;
});

describe("renderPanelFull", () => {
  it("긴 단일 text block도 최근 5줄 tail로 제한한다", () => {
    const runId = createRun("genesis", "stream");
    appendTextBlock("genesis", "line1\nline2\nline3\nline4\nline5\nline6\nline7\n");

    const rendered = renderPanelFull(
      100,
      [buildJob(runId)],
      0,
      "",
      "",
      null,
      10,
    ).join("\n");

    expect(rendered).not.toContain("line1");
    expect(rendered).not.toContain("line2");
    expect(rendered).toContain("line3");
    expect(rendered).toContain("line7");
  });
});

function buildJob(runId: string): PanelJob {
  return {
    jobId: "job-1",
    kind: "sortie",
    ownerCarrierId: "genesis",
    label: "Genesis",
    startedAt: Date.now(),
    status: "active",
    tracks: [{
      trackId: "genesis",
      streamKey: "genesis",
      displayCli: "genesis",
      runId,
      displayName: "Genesis",
      kind: "carrier",
      status: "wait",
    }],
  };
}
