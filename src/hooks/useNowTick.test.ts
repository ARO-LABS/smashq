import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNowTick } from "./useNowTick";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNowTick", () => {
  it("returns a numeric timestamp", () => {
    const { result } = renderHook(() => useNowTick());
    expect(typeof result.current).toBe("number");
  });

  it("updates the value to the current time after one second", () => {
    const { result } = renderHook(() => useNowTick());
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const base = Date.now();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // advanceTimersByTime moves the clock first, then fires the interval —
    // the callback observes base + 1000.
    expect(result.current).toBe(base + 1000);
  });

  it("does not update before a full second elapses", () => {
    const { result } = renderHook(() => useNowTick());
    const initial = result.current;
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(result.current).toBe(initial);
  });

  it("shares one timer so all subscribers receive the same value", () => {
    const a = renderHook(() => useNowTick());
    const b = renderHook(() => useNowTick());
    vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(a.result.current).toBe(b.result.current);
  });

  it("freezes the value for a subscriber after unmount", () => {
    const { result, unmount } = renderHook(() => useNowTick());
    unmount();
    const frozen = result.current;
    vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(frozen);
  });

  it("keeps ticking for remaining subscribers when one unmounts", () => {
    const survivor = renderHook(() => useNowTick());
    const leaving = renderHook(() => useNowTick());
    leaving.unmount();
    vi.setSystemTime(new Date("2032-03-03T03:03:03Z"));
    const base = Date.now();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(survivor.result.current).toBe(base + 1000);
  });
});
