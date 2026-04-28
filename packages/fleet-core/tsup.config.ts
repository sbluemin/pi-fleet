import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    agent: "src/agent/index.ts",
    "agent/provider-types": "src/agent/provider-types.ts",
    "agent/types": "src/agent/types.ts",
    "agent/runtime": "src/agent/runtime.ts",
    "agent/session-store": "src/agent/session-store.ts",
    "agent/session-resume-utils": "src/agent/session-resume-utils.ts",
    "agent/pool": "src/agent/pool.ts",
    "agent/executor": "src/agent/executor.ts",
    "agent/tool-snapshot": "src/agent/tool-snapshot.ts",
    "agent/provider-mcp": "src/agent/provider-mcp.ts",
    "agent/log-port": "src/agent/log-port.ts",
    job: "src/job/index.ts",
    carrier: "src/carrier/index.ts",
    squadron: "src/squadron/index.ts",
    taskforce: "src/taskforce/index.ts",
    "carrier-jobs": "src/carrier-jobs/index.ts",
    store: "src/store/index.ts",
    push: "src/push/index.ts",
    bridge: "src/bridge/index.ts",
    operation: "src/operation/index.ts",
    admiral: "src/admiral/index.ts",
    metaphor: "src/metaphor/index.ts",
    "grand-fleet": "src/grand-fleet/index.ts",
    "experimental-wiki": "src/experimental-wiki/index.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022"
});
