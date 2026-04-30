import { describe, expect, it } from "vitest";

import { sanitizeOperationNameDisplay } from "../../src/metaphor/operation-name/index.js";

describe("sanitizeOperationNameDisplay", () => {
  it("keeps the operation prefix when worldview is enabled", () => {
    expect(sanitizeOperationNameDisplay("Iron Tide", true)).toBe("Operation › Iron Tide");
    expect(sanitizeOperationNameDisplay("Operation › Iron Tide", true)).toBe("Operation › Iron Tide");
  });

  it("removes the operation prefix when worldview is disabled", () => {
    expect(sanitizeOperationNameDisplay("Operation › Refactor auth", false)).toBe("Refactor auth");
  });

  it("strips unsafe display controls and redacts common secret tokens", () => {
    expect(sanitizeOperationNameDisplay("\x1b[31mOperation › Fix sk-testSECRET123\u202E", true)).toBe(
      "Operation › Fix [redacted]",
    );
  });

  it("limits display text to forty characters", () => {
    const value = sanitizeOperationNameDisplay("Operation › Extremely Long Operation Codename Beyond Limit", true);
    expect(value).toHaveLength(40);
  });
});
