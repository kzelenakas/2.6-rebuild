import { describe, expect, it } from "vitest";
import { computeSyncedScrollTop } from "./scrollSync";

describe("computeSyncedScrollTop", () => {
  it("maps the same fraction onto a taller target", () => {
    // source: 50% scrolled through a 400px range
    const result = computeSyncedScrollTop(200, 800, 400, 1200, 400);
    // target range is 800px, so 50% of that is 400
    expect(result).toBe(400);
  });

  it("maps the same fraction onto a shorter target", () => {
    const result = computeSyncedScrollTop(300, 1000, 400, 500, 400);
    // source fraction = 300/600 = 0.5, target range = 100 -> 50
    expect(result).toBe(50);
  });

  it("returns 0 when the target has no scrollable range", () => {
    const result = computeSyncedScrollTop(200, 800, 400, 400, 400);
    expect(result).toBe(0);
  });

  it("returns 0 when the source has no scrollable range", () => {
    const result = computeSyncedScrollTop(0, 400, 400, 1200, 400);
    expect(result).toBe(0);
  });

  it("is idempotent at the top and bottom", () => {
    expect(computeSyncedScrollTop(0, 800, 400, 1200, 400)).toBe(0);
    expect(computeSyncedScrollTop(400, 800, 400, 1200, 400)).toBe(800);
  });
});
