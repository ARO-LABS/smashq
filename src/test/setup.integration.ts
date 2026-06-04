import { vi } from "vitest";
import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// Integration-test setup — runtime-boundary shims ONLY.
//
// PHILOSOPHY: integration tests use REAL Zustand stores, REAL components,
// REAL hooks, REAL filesystem fixtures. The only acceptable mocks are at
// the Tauri-runtime boundary (IPC + events), because Tauri itself is not
// running in jsdom — there is no real bus to attach to. Production code
// is exercised verbatim.
//
// What this file does NOT mock:
//   - @tauri-apps/api/core (intercepted at IPC level via `mockIPC` in
//     mockTauriIPC.ts — that is Tauri's official testing API, not a
//     module mock of production code).
//   - Any Zustand store (tests reset state in `beforeEach` via
//     `useStore.setState(initial, true)` — see helper exports in
//     mockTauriIPC.ts).
//   - Any production module under src/ (hooks, components, utils).
//
// Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 2)
// ---------------------------------------------------------------------------

// crypto.randomUUID polyfill (jsdom does not provide it)
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...globalThis.crypto,
      randomUUID: () =>
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }),
    },
  });
}

// PointerEvent polyfill (jsdom omits it)
if (!globalThis.PointerEvent) {
  class PointerEvent extends MouseEvent {
    public readonly pointerId: number;
    public readonly pointerType: string;
    public readonly isPrimary: boolean;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "mouse";
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEvent as typeof globalThis.PointerEvent;
}

// localStorage polyfill (some jsdom + vitest combos omit setItem)
if (typeof globalThis.localStorage?.setItem !== "function") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Tauri-event runtime shim (NOT a production-code mock)
// ---------------------------------------------------------------------------
//
// `vi.mock("@tauri-apps/api/event")` is acceptable here because Tauri itself
// is not running in jsdom — there is no real bus. The shim provides a
// routable in-memory bus that tests drive via `emitTauriEvent()` from
// `mockTauriIPC.ts`. Production hooks call `listen()` exactly as in
// production; the shim records the listener so tests can synchronously
// fire matching events.
//
// The listener registry lives inside the factory closure and is exposed
// via `globalThis.__TAURI_TEST_EVENT_BUS__` for the helper to drive.

vi.mock("@tauri-apps/api/event", () => {
  // Payload shape mirrors Tauri v2's `Event<T>` (event.d.ts): `{ event, id, payload }`.
  // Intentionally NO `windowLabel` — that field does NOT exist on real Tauri Event,
  // and adding it here would let prod hooks read `event.windowLabel` in tests
  // without failing in production (silent shim drift).
  interface TauriListener {
    eventName: string;
    handler: (event: { payload: unknown; event: string; id: number }) => void;
    id: number;
  }

  const listeners = new Set<TauriListener>();
  let nextListenerId = 1;

  const expose = {
    bus: listeners,
    nextId: () => nextListenerId++,
  };
  (globalThis as unknown as { __TAURI_TEST_EVENT_BUS__: typeof expose }).__TAURI_TEST_EVENT_BUS__ =
    expose;

  return {
    listen: async (
      eventName: string,
      handler: (event: { payload: unknown; event: string; id: number }) => void,
    ) => {
      const id = expose.nextId();
      const listener: TauriListener = { eventName, handler, id };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: async () => {
      // No-op: tests drive events via emitTauriEvent in mockTauriIPC.ts.
      // If a future test exercises a hook that calls emit() to drive its
      // own state, route emit to emitTauriEvent here.
    },
    once: async (
      eventName: string,
      handler: (event: { payload: unknown; event: string; id: number }) => void,
    ) => {
      const id = expose.nextId();
      const listener: TauriListener = {
        eventName,
        // Tauri semantics: deliver event THEN unregister. Mirror that
        // ordering so a handler that re-emits the same event during the
        // first delivery cannot also catch its own re-emit (matches prod).
        handler: (event) => {
          try {
            handler(event);
          } finally {
            listeners.delete(listener);
          }
        },
        id,
      };
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

// ---------------------------------------------------------------------------
// Global cross-test isolation: drop all event listeners + IPC handlers
// after every test. Without this, a test that forgot to call
// clearTauriIPC() in afterEach pollutes the next test in the same file.
// ---------------------------------------------------------------------------
import { afterEach } from "vitest";
import { clearTauriIPC } from "./mockTauriIPC";
afterEach(() => {
  clearTauriIPC();
});
