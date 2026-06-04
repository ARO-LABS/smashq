/**
 * Layer-B integration test — favorites + favorite-group PERSISTENCE contract.
 *
 * Favorites/favoriteGroups persist through the standard zustand persist
 * middleware (partialize → settings.json in Tauri, → localStorage in jsdom),
 * exactly like notes/theme/sessionRestore. This test exercises that real
 * round-trip with the REAL store (no store mocks, no IPC mocks).
 *
 * WHY THIS MATTERS: the previous design wrote favorites to a separate
 * favorites.json via a lone `hasHydrated()`-gated store.subscribe. That writer
 * never fired in production builds — favorites vanished on every restart — and
 * it was UNTESTABLE in jsdom (`isTauri` is false, so the write/load no-op'd),
 * which is exactly why the regression shipped with green tests. Persisting via
 * partialize routes favorites through the proven path AND makes the round-trip
 * fully testable here: jsdom's localStorage fallback serializes the same blob
 * the Tauri build writes to settings.json.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settingsStore";
import { resetAllStores } from "../test/storeReset";

const PERSIST_KEY = "agenticexplorer-settings";

/** Read the persisted blob (partialize output) zustand wrote to storage. */
function readPersistedState(): Record<string, unknown> {
  const raw = localStorage.getItem(PERSIST_KEY);
  if (!raw) return {};
  return (JSON.parse(raw).state ?? {}) as Record<string, unknown>;
}

async function rehydrate(): Promise<void> {
  const store = useSettingsStore as unknown as {
    persist: { rehydrate: () => Promise<void> };
  };
  await store.persist.rehydrate();
}

describe("favorites persistence — partialize round-trip (settings.json single source)", () => {
  beforeEach(() => {
    resetAllStores();
  });

  it("writes an added favorite + group into the persisted settings blob", () => {
    useSettingsStore.getState().addFavorite("C:/Projects/demo", "Demo");
    useSettingsStore.getState().addFavoriteGroup("Wichtig");

    const persisted = readPersistedState();
    const favs = persisted.favorites as Array<{ path: string }>;
    const groups = persisted.favoriteGroups as Array<{ label: string }>;

    expect(Array.isArray(favs)).toBe(true);
    expect(favs.some((f) => f.path === "C:/Projects/demo")).toBe(true);
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.some((g) => g.label === "Wichtig")).toBe(true);
  });

  it("round-trips favorites + groups across a rehydrate (the restart scenario)", async () => {
    // Simulate the user's session: add a group, add a favorite, assign it.
    const gid = useSettingsStore.getState().addFavoriteGroup("Arbeit");
    useSettingsStore.getState().addFavorite("C:/Projects/alpha", "Alpha");
    const favId = useSettingsStore.getState().favorites[0].id;
    useSettingsStore.getState().moveFavorite(favId, gid, 0);

    // Capture the persisted blob, then fully reset (clears memory AND storage)
    // and re-seed the blob before rehydrating — a faithful "app restart" that
    // reads the persisted settings fresh. (Calling setState to wipe memory
    // would re-persist the empty state and clobber the blob, so we don't.)
    const blob = localStorage.getItem(PERSIST_KEY);
    expect(blob).toBeTruthy();
    resetAllStores();
    localStorage.setItem(PERSIST_KEY, blob as string);
    await rehydrate();

    const favs = useSettingsStore.getState().favorites;
    const groups = useSettingsStore.getState().favoriteGroups;
    expect(groups.some((g) => g.id === gid && g.label === "Arbeit")).toBe(true);
    expect(favs.some((f) => f.path === "C:/Projects/alpha" && f.groupId === gid)).toBe(true);
  });

  it("hydrates favorites + groups seeded into a v7 settings blob", async () => {
    resetAllStores();
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        version: 7,
        state: {
          favorites: [
            {
              id: "fav-seed-1",
              path: "C:/Projects/seeded",
              label: "Seeded",
              shell: "powershell",
              addedAt: 1,
              lastUsedAt: 2,
              groupId: "grp-seed-1",
              sortIndex: 0,
            },
          ],
          favoriteGroups: [{ id: "grp-seed-1", label: "Gruppe", sortIndex: 0 }],
        },
      }),
    );
    await rehydrate();

    expect(useSettingsStore.getState().favorites.some((f) => f.path === "C:/Projects/seeded")).toBe(true);
    expect(useSettingsStore.getState().favoriteGroups.some((g) => g.label === "Gruppe")).toBe(true);
  });

  it("an empty favorites set persists as empty (deleting the last favorite sticks)", async () => {
    useSettingsStore.getState().addFavorite("C:/Projects/tmp");
    const id = useSettingsStore.getState().favorites[0].id;
    useSettingsStore.getState().removeFavorite(id);

    const persisted = readPersistedState();
    expect(persisted.favorites).toEqual([]);

    await rehydrate();
    expect(useSettingsStore.getState().favorites).toEqual([]);
  });
});
