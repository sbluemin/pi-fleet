import { describe, expect, it } from "vitest";

import { createFleetToolRegistry } from "../src/public/fleet-tool-registry.js";
import { createAgentToolRegistry } from "../src/public/tool-registry.js";

describe("createAgentToolRegistry", () => {
  it("registers, lists, looks up, and unregisters tools", () => {
    const registry = createAgentToolRegistry();
    const unsubscribe = registry.onChange(() => {});

    registry.register({
      name: "fleet:test:tool",
      description: "test tool",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(["fleet:test:tool"]);
    expect(registry.get("fleet:test:tool")?.description).toBe("test tool");
    expect(registry.computeHash()).toBe(registry.computeHash());

    registry.unregister("fleet:test:tool");
    expect(registry.list()).toEqual([]);
    unsubscribe();
  });
});

describe("createFleetToolRegistry", () => {
  it("exposes core-owned fleet tool specs without Pi registration", () => {
    const specs = createFleetToolRegistry({
      logDebug() {},
      runAgentRequestBackground: async () => ({ status: "done", responseText: "", thoughtText: "" }),
      enqueueCarrierCompletionPush() {},
    });

    expect(specs.map((spec) => spec.name)).toContain("carrier_jobs");
    expect(specs.every((spec) => typeof spec.execute === "function")).toBe(true);
  });
});
