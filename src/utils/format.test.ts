import { describe, it, expect } from "vitest";
import { formatMs, formatElapsed } from "./format";

describe("formatMs", () => {
  it("renders a plain integer with space + lowercase unit", () => {
    expect(formatMs(312)).toBe("312 ms");
  });

  it("renders zero as '0 ms'", () => {
    expect(formatMs(0)).toBe("0 ms");
  });

  it("rounds fractional input", () => {
    expect(formatMs(12.7)).toBe("13 ms");
  });

  it("clamps negative input to zero", () => {
    expect(formatMs(-5)).toBe("0 ms");
  });

  it("falls back for non-finite input", () => {
    expect(formatMs(Number.NaN)).toBe("– ms");
    expect(formatMs(Number.POSITIVE_INFINITY)).toBe("– ms");
  });
});

describe("formatElapsed", () => {
  it("renders zero as '0:00'", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("pads the seconds field", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
  });

  it("renders minutes and seconds", () => {
    expect(formatElapsed(134_000)).toBe("2:14");
  });

  it("handles sub-second durations by flooring", () => {
    expect(formatElapsed(500)).toBe("0:00");
  });

  it("falls back to '0:00' for negative or non-finite input", () => {
    expect(formatElapsed(-1)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });

  it("stays in mm:ss just below the 1h threshold", () => {
    expect(formatElapsed(3_599_000)).toBe("59:59");
  });

  it("switches to h:mm:ss at 1h with zero-padded minutes", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_665_000)).toBe("1:01:05");
  });

  it("formats multi-hour durations as h:mm:ss", () => {
    expect(formatElapsed(10_800_000)).toBe("3:00:00");
    expect(formatElapsed(7_530_000)).toBe("2:05:30");
  });

  it("formats multi-day durations as h:mm:ss without overflowing minutes", () => {
    // 25h 0m 0s
    expect(formatElapsed(90_000_000)).toBe("25:00:00");
  });
});
