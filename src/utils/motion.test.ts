import { describe, it, expect } from "vitest";
import { DURATION, EASE } from "./motion";

describe("DURATION tokens", () => {
  it("exposes the documented duration steps", () => {
    expect(DURATION.instant).toBe(0.1);
    expect(DURATION.fast).toBe(0.2);
    expect(DURATION.base).toBe(0.3);
    expect(DURATION.slow).toBe(0.5);
    expect(DURATION.ambient).toBe(8);
  });

  it("orders the interaction durations from fastest to slowest", () => {
    expect(DURATION.instant).toBeLessThan(DURATION.fast);
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThan(DURATION.slow);
    expect(DURATION.slow).toBeLessThan(DURATION.ambient);
  });

  it("keeps every duration positive", () => {
    for (const value of Object.values(DURATION)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe("EASE curves", () => {
  it("exposes out, in and inOut curves", () => {
    expect(Object.keys(EASE).sort()).toEqual(["in", "inOut", "out"]);
  });

  it("uses the exponential ease-out curve for entering elements", () => {
    expect(EASE.out).toEqual([0.16, 1, 0.3, 1]);
  });

  it("uses an accelerating curve for leaving elements", () => {
    expect(EASE.in).toEqual([0.7, 0, 0.84, 0]);
  });

  it("uses a symmetric curve for state toggles", () => {
    expect(EASE.inOut).toEqual([0.65, 0, 0.35, 1]);
  });

  it("defines each curve as four cubic-bezier control values", () => {
    for (const curve of Object.values(EASE)) {
      expect(curve).toHaveLength(4);
    }
  });

  it("keeps all bezier control values within the 0..1 range", () => {
    for (const curve of Object.values(EASE)) {
      for (const point of curve as readonly number[]) {
        expect(point).toBeGreaterThanOrEqual(0);
        expect(point).toBeLessThanOrEqual(1);
      }
    }
  });
});
