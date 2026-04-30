import { beforeEach, describe, expect, it } from "vitest";

import { buildPanelViewModel } from "../../src/admiral/bridge/carrier-panel/index.js";
import {
  appendTextBlock,
  createRun,
  finalizeRun,
  upsertToolBlock,
} from "../../src/admiral/bridge/run-stream/stream-store.js";
import { configureBridgeStateStorage } from "../../src/admiral/bridge/run-stream/state-store.js";
import type { PanelJob } from "../../src/admiral/bridge/carrier-panel/types.js";

beforeEach(() => {
  configureBridgeStateStorage(null);
  (globalThis as any)["__pi_stream_store__"] = undefined;
});

describe("buildPanelViewModel", () => {
  it("렌더러가 사용할 run 상태와 통계를 plain data로 생성한다", () => {
    const runId = createRun("genesis", "stream");
    upsertToolBlock("genesis", "read", "done");
    appendTextBlock("genesis", "first\nsecond\n");
    finalizeRun("genesis", "done");

    const jobs: PanelJob[] = [{
      jobId: "job-1",
      kind: "sortie",
      ownerCarrierId: "genesis",
      label: "Genesis",
      startedAt: 1,
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
    }];

    const [job] = buildPanelViewModel(jobs);
    expect(job!.tracks[0]).toMatchObject({
      trackId: "genesis",
      runId,
      status: "done",
      toolCallCount: 1,
      textLineCount: 2,
      isComplete: true,
    });
    expect(job!.tracks[0]!.blocks).toHaveLength(2);
  });
});
