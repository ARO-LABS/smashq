import { describe, it, expect, beforeEach } from "vitest";
import {
  useSettingsStore,
  type SettingsState,
  normalizeProjectKey,
  validatePinnedPath,
  sanitizeScrollbackLines,
  sanitizePreferences,
  SCROLLBACK_PRESETS,
  useSettingsStoreMigrateForTest,
  useSettingsStoreValidateForTest,
} from "./settingsStore";

// ============================================================================
// Helpers
// ============================================================================

function getState(): SettingsState {
  return useSettingsStore.getState();
}

// ============================================================================
// Reset
// ============================================================================

beforeEach(() => {
  useSettingsStore.getState().resetToDefaults();
  // Also clear favorites, apiKeys and pinnedDocs manually (resetToDefaults preserves them)
  useSettingsStore.setState({ favorites: [], apiKeys: [], pinnedDocs: {} });
});

// ============================================================================
// sanitizePreferences — Same-Version-Corruption-Recovery (Issue-#209-Klasse)
// ============================================================================

describe("sanitizePreferences", () => {
  it("coerces string bools to false (corrupt settings.json must not open gates)", () => {
    const clean = sanitizePreferences({
      frontendLogging: "true",
      backendFileLogging: 1,
      performanceProfiler: null,
    });
    expect(clean.frontendLogging).toBe(false);
    expect(clean.backendFileLogging).toBe(false);
    expect(clean.performanceProfiler).toBe(false);
  });

  it("keeps genuine booleans and clamps scrollbackLines", () => {
    const clean = sanitizePreferences({
      frontendLogging: true,
      backendFileLogging: true,
      performanceProfiler: false,
      scrollbackLines: -5,
    });
    expect(clean.frontendLogging).toBe(true);
    expect(clean.backendFileLogging).toBe(true);
    expect(clean.performanceProfiler).toBe(false);
    expect(clean.scrollbackLines).toBeGreaterThan(0);
  });

  it("collapses non-object input to defaults", () => {
    expect(sanitizePreferences("garbage")).toEqual(sanitizePreferences({}));
    expect(sanitizePreferences(null)).toEqual(sanitizePreferences({}));
    expect(sanitizePreferences([1, 2])).toEqual(sanitizePreferences({}));
  });

  it("migrate runs persisted preferences through sanitizePreferences", () => {
    const migrated = useSettingsStoreMigrateForTest(
      { preferences: { frontendLogging: "true", backendFileLogging: "yes" } },
      7,
    ) as SettingsState;
    expect(migrated.preferences.frontendLogging).toBe(false);
    expect(migrated.preferences.backendFileLogging).toBe(false);
  });
});

// ============================================================================
// Initial State / Defaults
// ============================================================================

describe("initial state", () => {
  it("defaults theme.mode to 'dark'", () => {
    expect(getState().theme.mode).toBe("dark");
  });

  it("defaults theme.reducedMotion to false", () => {
    expect(getState().theme.reducedMotion).toBe(false);
  });

  it("defaults theme.animationSpeed to 1.0", () => {
    expect(getState().theme.animationSpeed).toBe(1.0);
  });

  it("defaults theme.accentColor to oklch value", () => {
    expect(getState().theme.accentColor).toBe("oklch(72% 0.14 230)");
  });

  it("defaults sound.enabled to false", () => {
    expect(getState().sound.enabled).toBe(false);
  });

  it("defaults sound.volume to 0.5", () => {
    expect(getState().sound.volume).toBe(0.5);
  });

  it("defaults notifications.enabled to true", () => {
    expect(getState().notifications.enabled).toBe(true);
  });

  it("defaults all notification channels to true", () => {
    const n = getState().notifications;
    expect(n.pipelineComplete).toBe(true);
    expect(n.pipelineError).toBe(true);
    expect(n.qaGateResult).toBe(true);
    expect(n.costAlert).toBe(true);
  });

  it("defaults pipeline.defaultMode to 'mock'", () => {
    expect(getState().pipeline.defaultMode).toBe("mock");
  });

  it("defaults pipeline.maxConcurrentWorktrees to 5", () => {
    expect(getState().pipeline.maxConcurrentWorktrees).toBe(5);
  });

  it("defaults pipeline.autoRetryOnError to false", () => {
    expect(getState().pipeline.autoRetryOnError).toBe(false);
  });

  it("defaults pipeline.logBufferSize to 200", () => {
    expect(getState().pipeline.logBufferSize).toBe(200);
  });

  it("defaults locale to 'de'", () => {
    expect(getState().locale).toBe("de");
  });

  it("defaults defaultShell to 'auto'", () => {
    expect(getState().defaultShell).toBe("auto");
  });

  it("defaults defaultProjectPath to empty string", () => {
    expect(getState().defaultProjectPath).toBe("");
  });

  it("defaults apiKeys to empty array", () => {
    expect(getState().apiKeys).toEqual([]);
  });

  it("defaults favorites to empty array", () => {
    expect(getState().favorites).toEqual([]);
  });
});

// ============================================================================
// setTheme
// ============================================================================

describe("setTheme", () => {
  it("updates a single theme property", () => {
    getState().setTheme({ reducedMotion: true });
    expect(getState().theme.reducedMotion).toBe(true);
  });

  it("merges with existing theme values", () => {
    getState().setTheme({ animationSpeed: 0.5 });
    const theme = getState().theme;
    // Other values should remain unchanged
    expect(theme.mode).toBe("dark");
    expect(theme.reducedMotion).toBe(false);
    expect(theme.animationSpeed).toBe(0.5);
  });

  it("updates multiple theme properties at once", () => {
    getState().setTheme({ reducedMotion: true, animationSpeed: 2.0 });
    const theme = getState().theme;
    expect(theme.reducedMotion).toBe(true);
    expect(theme.animationSpeed).toBe(2.0);
  });

  it("updates accentColor", () => {
    getState().setTheme({ accentColor: "#ff0000" });
    expect(getState().theme.accentColor).toBe("#ff0000");
  });
});

// ============================================================================
// setNotifications
// ============================================================================

describe("setNotifications", () => {
  it("updates a single notification property", () => {
    getState().setNotifications({ enabled: false });
    expect(getState().notifications.enabled).toBe(false);
  });

  it("merges with existing notification values", () => {
    getState().setNotifications({ costAlert: false });
    const n = getState().notifications;
    expect(n.enabled).toBe(true);
    expect(n.pipelineComplete).toBe(true);
    expect(n.costAlert).toBe(false);
  });

  it("updates multiple notification properties", () => {
    getState().setNotifications({
      pipelineComplete: false,
      pipelineError: false,
    });
    const n = getState().notifications;
    expect(n.pipelineComplete).toBe(false);
    expect(n.pipelineError).toBe(false);
    expect(n.qaGateResult).toBe(true);
  });
});

// ============================================================================
// setSound
// ============================================================================

describe("setSound", () => {
  it("enables sound", () => {
    getState().setSound({ enabled: true });
    expect(getState().sound.enabled).toBe(true);
  });

  it("updates volume while preserving enabled state", () => {
    getState().setSound({ volume: 0.8 });
    expect(getState().sound.volume).toBe(0.8);
    expect(getState().sound.enabled).toBe(false);
  });
});

// ============================================================================
// setPipeline
// ============================================================================

describe("setPipeline", () => {
  it("updates defaultMode to real", () => {
    getState().setPipeline({ defaultMode: "real" });
    expect(getState().pipeline.defaultMode).toBe("real");
  });

  it("merges with existing pipeline values", () => {
    getState().setPipeline({ maxConcurrentWorktrees: 3 });
    const p = getState().pipeline;
    expect(p.maxConcurrentWorktrees).toBe(3);
    expect(p.defaultMode).toBe("mock");
    expect(p.autoRetryOnError).toBe(false);
    expect(p.logBufferSize).toBe(200);
  });

  it("updates multiple pipeline properties", () => {
    getState().setPipeline({
      autoRetryOnError: true,
      logBufferSize: 500,
    });
    expect(getState().pipeline.autoRetryOnError).toBe(true);
    expect(getState().pipeline.logBufferSize).toBe(500);
  });
});

// ============================================================================
// setLocale
// ============================================================================

describe("setLocale", () => {
  it("switches to English", () => {
    getState().setLocale("en");
    expect(getState().locale).toBe("en");
  });

  it("switches back to German", () => {
    getState().setLocale("en");
    getState().setLocale("de");
    expect(getState().locale).toBe("de");
  });

  it("is idempotent — setting same locale twice is fine", () => {
    getState().setLocale("de");
    getState().setLocale("de");
    expect(getState().locale).toBe("de");
  });
});

// ============================================================================
// setDefaultShell
// ============================================================================

describe("setDefaultShell", () => {
  it("sets to powershell", () => {
    getState().setDefaultShell("powershell");
    expect(getState().defaultShell).toBe("powershell");
  });

  it("sets to auto", () => {
    getState().setDefaultShell("powershell");
    getState().setDefaultShell("auto");
    expect(getState().defaultShell).toBe("auto");
  });

  it("sets to bash", () => {
    getState().setDefaultShell("bash");
    expect(getState().defaultShell).toBe("bash");
  });

  it("sets to cmd", () => {
    getState().setDefaultShell("cmd");
    expect(getState().defaultShell).toBe("cmd");
  });

  it("sets to zsh", () => {
    getState().setDefaultShell("zsh");
    expect(getState().defaultShell).toBe("zsh");
  });
});

// ============================================================================
// setDefaultProjectPath
// ============================================================================

describe("setDefaultProjectPath", () => {
  it("sets a project path", () => {
    getState().setDefaultProjectPath("C:/Projects");
    expect(getState().defaultProjectPath).toBe("C:/Projects");
  });

  it("can reset to empty string", () => {
    getState().setDefaultProjectPath("C:/Projects");
    getState().setDefaultProjectPath("");
    expect(getState().defaultProjectPath).toBe("");
  });
});

// ============================================================================
// API Key CRUD
// ============================================================================

describe("API key metadata", () => {
  const testKey = {
    id: "key-1",
    provider: "anthropic",
    label: "My API Key",
    redactedKey: "sk-ant-...xxxx",
    addedAt: Date.now(),
    isValid: true,
  };

  it("adds an API key entry", () => {
    getState().addApiKeyMetadata(testKey);
    expect(getState().apiKeys).toHaveLength(1);
    expect(getState().apiKeys[0]).toEqual(testKey);
  });

  it("adds multiple API key entries", () => {
    getState().addApiKeyMetadata(testKey);
    getState().addApiKeyMetadata({ ...testKey, id: "key-2", label: "Second" });
    expect(getState().apiKeys).toHaveLength(2);
  });

  it("removes an API key by ID", () => {
    getState().addApiKeyMetadata(testKey);
    getState().addApiKeyMetadata({ ...testKey, id: "key-2" });
    getState().removeApiKeyMetadata("key-1");
    expect(getState().apiKeys).toHaveLength(1);
    expect(getState().apiKeys[0].id).toBe("key-2");
  });

  it("removeApiKeyMetadata is a no-op for non-existent ID", () => {
    getState().addApiKeyMetadata(testKey);
    getState().removeApiKeyMetadata("nonexistent");
    expect(getState().apiKeys).toHaveLength(1);
  });

  it("updates an API key entry partially", () => {
    getState().addApiKeyMetadata(testKey);
    getState().updateApiKeyMetadata("key-1", {
      label: "Updated Label",
      isValid: false,
    });
    const key = getState().apiKeys[0];
    expect(key.label).toBe("Updated Label");
    expect(key.isValid).toBe(false);
    // Other fields remain unchanged
    expect(key.provider).toBe("anthropic");
    expect(key.redactedKey).toBe("sk-ant-...xxxx");
  });

  it("updateApiKeyMetadata is a no-op for non-existent ID", () => {
    getState().addApiKeyMetadata(testKey);
    getState().updateApiKeyMetadata("nonexistent", { label: "Ghost" });
    expect(getState().apiKeys[0].label).toBe("My API Key");
  });

  it("sets lastUsedAt via updateApiKeyMetadata", () => {
    getState().addApiKeyMetadata(testKey);
    const now = Date.now();
    getState().updateApiKeyMetadata("key-1", { lastUsedAt: now });
    expect(getState().apiKeys[0].lastUsedAt).toBe(now);
  });
});

// ============================================================================
// resetToDefaults
// ============================================================================

describe("resetToDefaults", () => {
  it("resets theme to defaults", () => {
    getState().setTheme({ reducedMotion: true, animationSpeed: 0.1 });
    getState().resetToDefaults();
    expect(getState().theme.reducedMotion).toBe(false);
    expect(getState().theme.animationSpeed).toBe(1.0);
    expect(getState().theme.mode).toBe("dark");
  });

  it("resets notifications to defaults", () => {
    getState().setNotifications({ enabled: false, costAlert: false });
    getState().resetToDefaults();
    expect(getState().notifications.enabled).toBe(true);
    expect(getState().notifications.costAlert).toBe(true);
  });

  it("resets sound to defaults", () => {
    getState().setSound({ enabled: true, volume: 1.0 });
    getState().resetToDefaults();
    expect(getState().sound.enabled).toBe(false);
    expect(getState().sound.volume).toBe(0.5);
  });

  it("resets pipeline to defaults", () => {
    getState().setPipeline({ defaultMode: "real", maxConcurrentWorktrees: 10 });
    getState().resetToDefaults();
    expect(getState().pipeline.defaultMode).toBe("mock");
    expect(getState().pipeline.maxConcurrentWorktrees).toBe(5);
  });

  it("resets locale to 'de'", () => {
    getState().setLocale("en");
    getState().resetToDefaults();
    expect(getState().locale).toBe("de");
  });

  it("resets defaultShell to 'auto'", () => {
    getState().setDefaultShell("powershell");
    getState().resetToDefaults();
    expect(getState().defaultShell).toBe("auto");
  });

  it("resets defaultProjectPath to empty string", () => {
    getState().setDefaultProjectPath("C:/Projects");
    getState().resetToDefaults();
    expect(getState().defaultProjectPath).toBe("");
  });

  it("does NOT reset apiKeys", () => {
    const testKey = {
      id: "key-persist",
      provider: "anthropic",
      label: "Persistent",
      redactedKey: "sk-...xxxx",
      addedAt: Date.now(),
      isValid: true,
    };
    getState().addApiKeyMetadata(testKey);
    getState().resetToDefaults();
    expect(getState().apiKeys).toHaveLength(1);
    expect(getState().apiKeys[0].id).toBe("key-persist");
  });

  it("does NOT reset favorites", () => {
    getState().addFavorite("C:/Projects/important");
    getState().resetToDefaults();
    expect(getState().favorites).toHaveLength(1);
    expect(getState().favorites[0].path).toBe("C:/Projects/important");
  });
});

// ============================================================================
// addFavorite
// ============================================================================

describe("addFavorite", () => {
  it("creates a favorite with generated ID", () => {
    getState().addFavorite("C:/Projects/test");
    const favs = getState().favorites;
    expect(favs).toHaveLength(1);
    expect(favs[0].id).toBeDefined();
    expect(typeof favs[0].id).toBe("string");
    expect(favs[0].id.length).toBeGreaterThan(0);
  });

  it("sets path correctly", () => {
    getState().addFavorite("C:/Projects/test");
    expect(getState().favorites[0].path).toBe("C:/Projects/test");
  });

  it("derives label from path when no label provided", () => {
    getState().addFavorite("C:/Projects/test");
    // Should use the last segment of the path as label
    expect(getState().favorites[0].label).toBe("test");
  });

  it("uses custom label when provided", () => {
    getState().addFavorite("C:/Projects/test", "Mein Projekt");
    expect(getState().favorites[0].label).toBe("Mein Projekt");
  });

  it("sets shell to 'auto' as default so the backend resolves it per-platform", () => {
    // Regression guard: a hardcoded "powershell" here made Quick Start fail
    // silently on macOS (favorite resolved to the absent `pwsh`).
    getState().addFavorite("C:/Projects/test");
    expect(getState().favorites[0].shell).toBe("auto");
  });

  it("sets addedAt to approximately now", () => {
    const before = Date.now();
    getState().addFavorite("C:/Projects/test");
    const after = Date.now();
    const fav = getState().favorites[0];
    expect(fav.addedAt).toBeGreaterThanOrEqual(before);
    expect(fav.addedAt).toBeLessThanOrEqual(after);
  });

  it("sets lastUsedAt to approximately now (same as addedAt)", () => {
    const before = Date.now();
    getState().addFavorite("C:/Projects/test");
    const after = Date.now();
    const fav = getState().favorites[0];
    expect(fav.lastUsedAt).toBeGreaterThanOrEqual(before);
    expect(fav.lastUsedAt).toBeLessThanOrEqual(after);
  });

  it("adds multiple favorites", () => {
    getState().addFavorite("C:/Projects/alpha");
    getState().addFavorite("C:/Projects/beta");
    getState().addFavorite("C:/Projects/gamma");
    expect(getState().favorites).toHaveLength(3);
  });

  it("generates unique IDs for each favorite", () => {
    getState().addFavorite("C:/Projects/alpha");
    getState().addFavorite("C:/Projects/beta");
    const ids = getState().favorites.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("derives label from last segment for deep path", () => {
    getState().addFavorite("C:/Users/dev/Documents/Projects/my-app");
    expect(getState().favorites[0].label).toBe("my-app");
  });

  it("handles path with trailing slash", () => {
    getState().addFavorite("C:/Projects/test/");
    const fav = getState().favorites[0];
    // Should still derive a meaningful label, not empty string
    expect(fav.path).toBe("C:/Projects/test/");
    expect(fav.label.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// addFavorite — Edge Cases
// ============================================================================

describe("addFavorite edge cases", () => {
  it("accepts empty path with a fallback label", () => {
    // Current contract: addFavorite("") ACCEPTS the entry. The label derivation
    // ("".split(...).pop() ?? "folder") yields the literal fallback "folder",
    // so the favorite is created with an empty path but a non-empty label.
    getState().addFavorite("");
    const favs = getState().favorites;
    expect(favs).toHaveLength(1);
    expect(favs[0].path).toBe("");
    expect(favs[0].label).toBe("folder");
  });

  it("handles very long path", () => {
    const longPath = "C:/" + "a".repeat(1000) + "/project";
    getState().addFavorite(longPath);
    expect(getState().favorites).toHaveLength(1);
    expect(getState().favorites[0].path).toBe(longPath);
  });

  it("handles path with spaces", () => {
    getState().addFavorite("C:/My Projects/Test Project");
    expect(getState().favorites[0].path).toBe("C:/My Projects/Test Project");
    expect(getState().favorites[0].label).toBe("Test Project");
  });

  it("handles path with special characters", () => {
    getState().addFavorite("C:/Projects/über-app (v2.0)");
    expect(getState().favorites[0].path).toBe("C:/Projects/über-app (v2.0)");
  });

  it("handles duplicate paths — adds second entry", () => {
    getState().addFavorite("C:/Projects/test");
    getState().addFavorite("C:/Projects/test");
    // Duplicate paths are allowed (different favorites pointing to same folder)
    const favs = getState().favorites;
    expect(favs.length).toBeGreaterThanOrEqual(1);
    // If duplicates are allowed, they should have different IDs
    if (favs.length === 2) {
      expect(favs[0].id).not.toBe(favs[1].id);
    }
  });

  it("handles backslash Windows paths", () => {
    getState().addFavorite("C:\\Projects\\test");
    expect(getState().favorites[0].path).toBe("C:\\Projects\\test");
  });
});

// ============================================================================
// removeFavorite
// ============================================================================

describe("removeFavorite", () => {
  it("removes the correct favorite", () => {
    getState().addFavorite("C:/Projects/alpha");
    getState().addFavorite("C:/Projects/beta");
    const idToRemove = getState().favorites[0].id;
    getState().removeFavorite(idToRemove);
    expect(getState().favorites).toHaveLength(1);
    expect(getState().favorites[0].path).toBe("C:/Projects/beta");
  });

  it("is a no-op for non-existent ID (no crash)", () => {
    getState().addFavorite("C:/Projects/test");
    getState().removeFavorite("non-existent-id");
    expect(getState().favorites).toHaveLength(1);
  });

  it("removes from an already empty list without crash", () => {
    getState().removeFavorite("whatever");
    expect(getState().favorites).toEqual([]);
  });

  it("removes the only favorite leaving empty array", () => {
    getState().addFavorite("C:/Projects/solo");
    const id = getState().favorites[0].id;
    getState().removeFavorite(id);
    expect(getState().favorites).toEqual([]);
  });

  it("removes correct favorite from many", () => {
    getState().addFavorite("C:/Projects/a");
    getState().addFavorite("C:/Projects/b");
    getState().addFavorite("C:/Projects/c");
    const middleId = getState().favorites[1].id;
    getState().removeFavorite(middleId);
    const remaining = getState().favorites;
    expect(remaining).toHaveLength(2);
    expect(remaining.find((f) => f.id === middleId)).toBeUndefined();
    expect(remaining[0].path).toBe("C:/Projects/a");
    expect(remaining[1].path).toBe("C:/Projects/c");
  });
});

// ============================================================================
// updateFavoriteLastUsed
// ============================================================================

describe("updateFavoriteLastUsed", () => {
  it("updates lastUsedAt to current time", () => {
    getState().addFavorite("C:/Projects/test");
    const id = getState().favorites[0].id;

    const before = Date.now();
    getState().updateFavoriteLastUsed(id);
    const after = Date.now();

    const updated = getState().favorites[0];
    expect(updated.lastUsedAt).toBeGreaterThanOrEqual(before);
    expect(updated.lastUsedAt).toBeLessThanOrEqual(after);
  });

  it("does not modify other fields", () => {
    getState().addFavorite("C:/Projects/test", "My Label");
    const id = getState().favorites[0].id;
    const original = { ...getState().favorites[0] };

    getState().updateFavoriteLastUsed(id);

    const updated = getState().favorites[0];
    expect(updated.id).toBe(original.id);
    expect(updated.path).toBe(original.path);
    expect(updated.label).toBe(original.label);
    expect(updated.shell).toBe(original.shell);
    expect(updated.addedAt).toBe(original.addedAt);
  });

  it("is a no-op for non-existent ID (no crash)", () => {
    getState().addFavorite("C:/Projects/test");
    const before = getState().favorites[0].lastUsedAt;
    getState().updateFavoriteLastUsed("non-existent-id");
    expect(getState().favorites[0].lastUsedAt).toBe(before);
  });

  it("updates only the targeted favorite, not others", () => {
    getState().addFavorite("C:/Projects/alpha");
    getState().addFavorite("C:/Projects/beta");
    const alphaLastUsed = getState().favorites[0].lastUsedAt;
    const betaId = getState().favorites[1].id;

    getState().updateFavoriteLastUsed(betaId);

    expect(getState().favorites[0].lastUsedAt).toBe(alphaLastUsed);
  });
});

// ============================================================================
// reorderFavorites
// ============================================================================

describe("reorderFavorites", () => {
  it("reorders ungrouped favorites by ID array", () => {
    getState().addFavorite("C:/Projects/alpha");
    getState().addFavorite("C:/Projects/beta");
    getState().addFavorite("C:/Projects/gamma");
    const [a, b, c] = getState().favorites;

    // Reverse order — all ungrouped (null)
    getState().reorderFavorites(null, [c.id, b.id, a.id]);
    const reordered = getState().favorites
      .filter(f => f.groupId === null)
      .sort((x, y) => x.sortIndex - y.sortIndex);
    expect(reordered[0].path).toBe("C:/Projects/gamma");
    expect(reordered[1].path).toBe("C:/Projects/beta");
    expect(reordered[2].path).toBe("C:/Projects/alpha");
  });

  it("keeps all favorites intact after reorder", () => {
    getState().addFavorite("C:/Projects/alpha");
    getState().addFavorite("C:/Projects/beta");
    const [a, b] = getState().favorites;

    getState().reorderFavorites(null, [b.id, a.id]);
    expect(getState().favorites).toHaveLength(2);
    // All original data preserved
    const reordered = getState().favorites;
    expect(reordered.find((f) => f.id === a.id)?.path).toBe("C:/Projects/alpha");
    expect(reordered.find((f) => f.id === b.id)?.path).toBe("C:/Projects/beta");
  });

  it("handles single-element reorder", () => {
    getState().addFavorite("C:/Projects/solo");
    const id = getState().favorites[0].id;
    getState().reorderFavorites(null, [id]);
    expect(getState().favorites).toHaveLength(1);
    expect(getState().favorites[0].id).toBe(id);
  });

  it("empty reorder array preserves the existing ungrouped favorite", () => {
    // Contract: reorderFavorites(groupId, []) is a no-op for membership. The
    // empty orderedIds produces no reindexed items, but the safety-net `tail`
    // loop re-appends every group member not named in orderedIds, so the lone
    // ungrouped favorite survives unchanged.
    getState().addFavorite("C:/Projects/test");
    getState().reorderFavorites(null, []);
    const favs = getState().favorites;
    expect(favs).toHaveLength(1);
    expect(favs[0].path).toBe("C:/Projects/test");
    expect(favs[0].groupId).toBe(null);
  });
});

// ============================================================================
// Favorite persistence across resetToDefaults
// ============================================================================

describe("favorites persistence", () => {
  it("favorites survive multiple resetToDefaults calls", () => {
    getState().addFavorite("C:/Projects/persistent");
    getState().resetToDefaults();
    getState().resetToDefaults();
    getState().resetToDefaults();
    expect(getState().favorites).toHaveLength(1);
    expect(getState().favorites[0].path).toBe("C:/Projects/persistent");
  });

  it("favorites and apiKeys both survive resetToDefaults", () => {
    getState().addFavorite("C:/Projects/test");
    getState().addApiKeyMetadata({
      id: "key-1",
      provider: "anthropic",
      label: "Key",
      redactedKey: "sk-...xxxx",
      addedAt: Date.now(),
      isValid: true,
    });
    getState().resetToDefaults();
    expect(getState().favorites).toHaveLength(1);
    expect(getState().apiKeys).toHaveLength(1);
  });
});

// ============================================================================
// folderAccents (per-project shared accent color)
// ============================================================================

describe("folderAccents", () => {
  const folder = "C:/Projects/zovel";

  // resetToDefaults deliberately PRESERVES folderAccents (project colors must
  // survive a settings reset), so the shared beforeEach does not clear them —
  // this block clears them itself to keep each case isolated.
  beforeEach(() => {
    useSettingsStore.setState({ folderAccents: {} });
  });

  it("setFolderAccent stores a valid accent name keyed by folder path", () => {
    getState().setFolderAccent(folder, "amber");
    expect(getState().folderAccents[folder]).toBe("amber");
  });

  it("setFolderAccent ignores an unknown accent name (no entry written)", () => {
    getState().setFolderAccent(folder, "magenta");
    expect(folder in getState().folderAccents).toBe(false);
  });

  it("setFolderAccent ignores an empty folder key", () => {
    getState().setFolderAccent("   ", "amber");
    expect("   " in getState().folderAccents).toBe(false);
  });

  it("clearFolderAccent removes the entry", () => {
    getState().setFolderAccent(folder, "rose");
    getState().clearFolderAccent(folder);
    expect(folder in getState().folderAccents).toBe(false);
  });

  it("does NOT reset folderAccents on resetToDefaults", () => {
    getState().setFolderAccent(folder, "emerald");
    getState().resetToDefaults();
    expect(getState().folderAccents[folder]).toBe("emerald");
  });

  it("migrate drops folderAccents entries with unknown names", () => {
    const migrated = useSettingsStoreMigrateForTest(
      { folderAccents: { "C:/a": "violet", "C:/b": "bogus", "": "amber" } },
      9,
    ) as SettingsState;
    expect(migrated.folderAccents["C:/a"]).toBe("violet");
    expect("C:/b" in migrated.folderAccents).toBe(false);
    expect("" in migrated.folderAccents).toBe(false);
  });

  it("migrate remaps persisted cyan folderAccents/sessionAccents to azure, keeps valid names, drops garbage", () => {
    const migrated = useSettingsStoreMigrateForTest(
      {
        folderAccents: { "/a": "cyan", "/b": "violet", "/c": "bogus" },
        sessionAccents: { s1: "cyan", s2: "amber" },
      },
      9,
    ) as SettingsState;
    expect(migrated.folderAccents).toEqual({ "/a": "azure", "/b": "violet" });
    expect(migrated.sessionAccents).toEqual({ s1: "azure", s2: "amber" });
  });
});

// ============================================================================
// Pinned Docs — Path Validation
// ============================================================================

describe("validatePinnedPath", () => {
  it("accepts simple .md path", () => {
    expect(validatePinnedPath("README.md")).toBeNull();
  });

  it("accepts nested .md path", () => {
    expect(validatePinnedPath("tasks/todo.md")).toBeNull();
  });

  it("accepts .markdown extension", () => {
    expect(validatePinnedPath("notes.markdown")).toBeNull();
  });

  it("accepts backslash-separated paths (Windows) and normalizes them", () => {
    expect(validatePinnedPath("tasks\\todo.md")).toBeNull();
  });

  it("rejects empty path", () => {
    expect(validatePinnedPath("")).toContain("leer");
    expect(validatePinnedPath("   ")).toContain("leer");
  });

  it("rejects absolute Windows path", () => {
    expect(validatePinnedPath("C:\\Users\\foo.md")).toContain("relativ");
    expect(validatePinnedPath("C:/Users/foo.md")).toContain("relativ");
  });

  it("rejects absolute Unix path", () => {
    expect(validatePinnedPath("/etc/passwd.md")).toContain("relativ");
  });

  it("rejects UNC path", () => {
    expect(validatePinnedPath("\\\\share\\foo.md")).toContain("relativ");
  });

  it("rejects path traversal with leading ..", () => {
    expect(validatePinnedPath("../secret.md")).toContain("Traversal");
  });

  it("rejects path traversal in middle", () => {
    expect(validatePinnedPath("foo/../bar.md")).toContain("Traversal");
  });

  it("rejects path traversal with nested ..", () => {
    expect(validatePinnedPath("a/b/../../c/d.md")).toContain("Traversal");
  });

  it("rejects non-markdown extension", () => {
    expect(validatePinnedPath("script.sh")).toContain("Nur .md");
    expect(validatePinnedPath("config.json")).toContain("Nur .md");
    expect(validatePinnedPath("no-extension")).toContain("Nur .md");
  });
});

// ============================================================================
// normalizeProjectKey
// ============================================================================

describe("normalizeProjectKey", () => {
  it("lowercases and replaces backslashes", () => {
    expect(normalizeProjectKey("C:\\Projects\\MyApp")).toBe("c:/projects/myapp");
  });

  it("strips trailing slashes", () => {
    expect(normalizeProjectKey("C:/Projects/MyApp/")).toBe("c:/projects/myapp");
    expect(normalizeProjectKey("C:/Projects/MyApp///")).toBe("c:/projects/myapp");
  });

  it("is idempotent", () => {
    const once = normalizeProjectKey("C:\\Projects\\Foo\\");
    const twice = normalizeProjectKey(once);
    expect(twice).toBe(once);
  });
});

// ============================================================================
// Pinned Docs — addPinnedDoc / removePinnedDoc / renamePinnedDoc
// ============================================================================

describe("addPinnedDoc", () => {
  const folder = "C:/Projects/smashq";

  it("adds a pin with generated id and defaults label to filename", () => {
    const err = getState().addPinnedDoc(folder, "tasks/todo.md");
    expect(err).toBeNull();
    const pins = getState().pinnedDocs[normalizeProjectKey(folder)];
    expect(pins).toHaveLength(1);
    expect(pins[0].relativePath).toBe("tasks/todo.md");
    expect(pins[0].label).toBe("todo.md");
    expect(pins[0].id).toMatch(/^pin-\d+-[a-z0-9]+$/);
    expect(pins[0].addedAt).toBeGreaterThan(0);
  });

  it("uses custom label when provided", () => {
    getState().addPinnedDoc(folder, "README.md", "Project Intro");
    const pins = getState().pinnedDocs[normalizeProjectKey(folder)];
    expect(pins[0].label).toBe("Project Intro");
  });

  it("normalizes backslashes in relativePath", () => {
    getState().addPinnedDoc(folder, "tasks\\lessons.md");
    const pins = getState().pinnedDocs[normalizeProjectKey(folder)];
    expect(pins[0].relativePath).toBe("tasks/lessons.md");
  });

  it("rejects duplicate relativePath in same folder", () => {
    getState().addPinnedDoc(folder, "README.md");
    const err = getState().addPinnedDoc(folder, "README.md");
    expect(err).toContain("bereits");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)]).toHaveLength(1);
  });

  it("allows same relativePath in different folders", () => {
    getState().addPinnedDoc(folder, "README.md");
    getState().addPinnedDoc("C:/Projects/other", "README.md");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)]).toHaveLength(1);
    expect(getState().pinnedDocs[normalizeProjectKey("C:/Projects/other")]).toHaveLength(1);
  });

  it("rejects path traversal attempts", () => {
    const err = getState().addPinnedDoc(folder, "../../etc/passwd.md");
    expect(err).toContain("Traversal");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)] ?? []).toHaveLength(0);
  });

  it("rejects non-markdown files", () => {
    const err = getState().addPinnedDoc(folder, "script.ts");
    expect(err).toContain("Nur .md");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)] ?? []).toHaveLength(0);
  });

  it("rejects absolute paths", () => {
    const err = getState().addPinnedDoc(folder, "C:/Windows/system32.md");
    expect(err).toContain("relativ");
  });

  it("same folder with different case uses the same key", () => {
    getState().addPinnedDoc("C:/Projects/App", "a.md");
    getState().addPinnedDoc("c:\\projects\\app", "b.md");
    const pins = getState().pinnedDocs[normalizeProjectKey("C:/Projects/App")];
    expect(pins).toHaveLength(2);
  });
});

describe("removePinnedDoc", () => {
  const folder = "C:/Projects/test";

  it("removes the pin by id", () => {
    getState().addPinnedDoc(folder, "a.md");
    getState().addPinnedDoc(folder, "b.md");
    const pins = getState().pinnedDocs[normalizeProjectKey(folder)];
    const firstId = pins[0].id;
    getState().removePinnedDoc(folder, firstId);
    const remaining = getState().pinnedDocs[normalizeProjectKey(folder)];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].relativePath).toBe("b.md");
  });

  it("deletes the folder key when last pin is removed", () => {
    getState().addPinnedDoc(folder, "only.md");
    const pin = getState().pinnedDocs[normalizeProjectKey(folder)][0];
    getState().removePinnedDoc(folder, pin.id);
    expect(getState().pinnedDocs[normalizeProjectKey(folder)]).toBeUndefined();
  });

  it("is a no-op for unknown id", () => {
    getState().addPinnedDoc(folder, "a.md");
    getState().removePinnedDoc(folder, "nonexistent-id");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)]).toHaveLength(1);
  });

  it("is a no-op for unknown folder", () => {
    getState().removePinnedDoc("C:/Nowhere", "any-id");
    expect(getState().pinnedDocs).toEqual({});
  });
});

describe("renamePinnedDoc", () => {
  const folder = "C:/Projects/test";

  it("updates the label", () => {
    getState().addPinnedDoc(folder, "a.md", "Old Label");
    const pin = getState().pinnedDocs[normalizeProjectKey(folder)][0];
    getState().renamePinnedDoc(folder, pin.id, "New Label");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)][0].label).toBe("New Label");
  });

  it("trims whitespace from label", () => {
    getState().addPinnedDoc(folder, "a.md");
    const pin = getState().pinnedDocs[normalizeProjectKey(folder)][0];
    getState().renamePinnedDoc(folder, pin.id, "   Trimmed   ");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)][0].label).toBe("Trimmed");
  });

  it("ignores empty label (keeps old value)", () => {
    getState().addPinnedDoc(folder, "a.md", "Keep Me");
    const pin = getState().pinnedDocs[normalizeProjectKey(folder)][0];
    getState().renamePinnedDoc(folder, pin.id, "   ");
    expect(getState().pinnedDocs[normalizeProjectKey(folder)][0].label).toBe("Keep Me");
  });

  it("does not affect pins in other folders", () => {
    getState().addPinnedDoc(folder, "shared.md", "Here");
    getState().addPinnedDoc("C:/Projects/other", "shared.md", "Over There");
    const pin = getState().pinnedDocs[normalizeProjectKey(folder)][0];
    getState().renamePinnedDoc(folder, pin.id, "Renamed");
    expect(getState().pinnedDocs[normalizeProjectKey("C:/Projects/other")][0].label).toBe("Over There");
  });
});

// ============================================================================
// scrollbackLines preferences (Phase 1 of scrollback-history-coverage)
// ============================================================================

// ============================================================================
// removeRestorableSessionByClaudeId
// ============================================================================

describe("removeRestorableSessionByClaudeId", () => {
  // Real UUID-v4 strings (lowercase, version-4-shape) so they pass the
  // store's `validateSessionRestore` filter on hydration paths. The action
  // itself does not validate — but using realistic ids matches production.
  const ID_A = "12345678-90ab-4def-9234-567890abcdef";
  const ID_B = "11111111-2222-4333-9444-555566667777";

  beforeEach(() => {
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
      sessionTitleOverrides: {},
    });
  });

  it("removes the matching session from sessionRestore.sessions[]", () => {
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "C:/A", title: "alpha", shell: "powershell", claudeSessionId: ID_A },
          { folder: "C:/B", title: "beta", shell: "powershell", claudeSessionId: ID_B },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    getState().removeRestorableSessionByClaudeId(ID_A);

    expect(getState().sessionRestore.sessions).toHaveLength(1);
    expect(getState().sessionRestore.sessions[0].claudeSessionId).toBe(ID_B);
  });

  it("clears the title override for the same id", () => {
    getState().setSessionTitleOverride(ID_A, "Mein Titel");
    expect(getState().sessionTitleOverrides[ID_A]).toBe("Mein Titel");

    getState().removeRestorableSessionByClaudeId(ID_A);

    expect(getState().sessionTitleOverrides[ID_A]).toBeUndefined();
  });

  it("removes restore-entry AND title-override in a single action", () => {
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "C:/A", title: "alpha", shell: "powershell", claudeSessionId: ID_A },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });
    getState().setSessionTitleOverride(ID_A, "Custom");

    getState().removeRestorableSessionByClaudeId(ID_A);

    expect(getState().sessionRestore.sessions).toHaveLength(0);
    expect(getState().sessionTitleOverrides[ID_A]).toBeUndefined();
  });

  it("is a no-op for unknown id", () => {
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "C:/A", title: "alpha", shell: "powershell", claudeSessionId: ID_A },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });
    getState().setSessionTitleOverride(ID_A, "Keep");

    getState().removeRestorableSessionByClaudeId("unknown-xyz");

    expect(getState().sessionRestore.sessions).toHaveLength(1);
    expect(getState().sessionTitleOverrides[ID_A]).toBe("Keep");
  });

  it("ignores empty / whitespace id without touching state", () => {
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "C:/A", title: "alpha", shell: "powershell", claudeSessionId: ID_A },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    getState().removeRestorableSessionByClaudeId("");
    getState().removeRestorableSessionByClaudeId("   ");

    expect(getState().sessionRestore.sessions).toHaveLength(1);
  });
});

// ============================================================================
// preferences
// ============================================================================

describe("preferences.scrollbackLines", () => {
  it("defaults to 25_000 on a fresh store", () => {
    expect(getState().preferences.scrollbackLines).toBe(25_000);
  });

  it("persists user-selected presets via setPreferences", () => {
    getState().setPreferences({ scrollbackLines: 50_000 });
    expect(getState().preferences.scrollbackLines).toBe(50_000);

    getState().setPreferences({ scrollbackLines: 5_000 });
    expect(getState().preferences.scrollbackLines).toBe(5_000);
  });

  it("SCROLLBACK_PRESETS contains exactly the UI options", () => {
    expect(SCROLLBACK_PRESETS).toEqual([5_000, 10_000, 25_000, 50_000]);
  });
});

describe("sanitizeScrollbackLines", () => {
  it("returns the value when within safe band", () => {
    expect(sanitizeScrollbackLines(5_000)).toBe(5_000);
    expect(sanitizeScrollbackLines(25_000)).toBe(25_000);
    expect(sanitizeScrollbackLines(50_000)).toBe(50_000);
    expect(sanitizeScrollbackLines(100_000)).toBe(100_000);
  });

  it("clamps values above the 100k OOM-defense ceiling", () => {
    expect(sanitizeScrollbackLines(500_000)).toBe(100_000);
    expect(sanitizeScrollbackLines(1_000_000)).toBe(100_000);
    expect(sanitizeScrollbackLines(Number.MAX_SAFE_INTEGER)).toBe(100_000);
  });

  it("clamps values below the 1k floor", () => {
    expect(sanitizeScrollbackLines(0)).toBe(25_000); // falls through to default for non-positive
    expect(sanitizeScrollbackLines(-1)).toBe(25_000);
    expect(sanitizeScrollbackLines(500)).toBe(1_000);
  });

  it("returns default 25_000 for non-numeric / invalid input", () => {
    expect(sanitizeScrollbackLines("50000" as unknown)).toBe(25_000);
    expect(sanitizeScrollbackLines(null)).toBe(25_000);
    expect(sanitizeScrollbackLines(undefined)).toBe(25_000);
    expect(sanitizeScrollbackLines(NaN)).toBe(25_000);
    expect(sanitizeScrollbackLines(Infinity)).toBe(25_000);
  });

  it("floors fractional values", () => {
    expect(sanitizeScrollbackLines(25_000.7)).toBe(25_000);
    expect(sanitizeScrollbackLines(50_000.99)).toBe(50_000);
  });
});

// ============================================================================
// favorites groups migration v4 → v5
// ============================================================================

describe("favorites groups migration v4 → v5", () => {
  it("assigns groupId=null and sortIndex monotonic in lastUsedAt order", () => {
    const persisted = {
      favorites: [
        { id: "a", path: "/a", label: "A", shell: "powershell", addedAt: 100, lastUsedAt: 100 },
        { id: "b", path: "/b", label: "B", shell: "powershell", addedAt: 200, lastUsedAt: 300 },
        { id: "c", path: "/c", label: "C", shell: "powershell", addedAt: 150, lastUsedAt: 200 },
      ],
    };
    const out = useSettingsStoreMigrateForTest(persisted, 4);
    expect(out.favorites.map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(out.favorites.every((f) => f.groupId === null)).toBe(true);
    expect(out.favorites.map((f) => f.sortIndex)).toEqual([0, 1000, 2000]);
    expect(out.favoriteGroups).toEqual([]);
  });

  it("nullifies dangling groupId in onRehydrateStorage", () => {
    const tampered = {
      favorites: [
        { id: "a", path: "/a", label: "A", shell: "powershell", addedAt: 1, lastUsedAt: 1,
          groupId: "grp-ghost", sortIndex: 0 },
      ],
      favoriteGroups: [],
    };
    const out = useSettingsStoreValidateForTest(tampered);
    expect(out.favorites[0].groupId).toBe(null);
  });

  it("removes duplicate group IDs", () => {
    const tampered = {
      favorites: [],
      favoriteGroups: [
        { id: "grp-dup", label: "First", sortIndex: 0 },
        { id: "grp-dup", label: "Dup",   sortIndex: 1000 },
      ],
    };
    const out = useSettingsStoreValidateForTest(tampered);
    expect(out.favoriteGroups).toHaveLength(1);
    expect(out.favoriteGroups[0].label).toBe("First");
  });

  it("reindexes NaN sortIndex", () => {
    const tampered = {
      favorites: [
        { id: "a", path: "/a", label: "A", shell: "powershell", addedAt: 1, lastUsedAt: 1,
          groupId: null, sortIndex: Number.NaN },
        { id: "b", path: "/b", label: "B", shell: "powershell", addedAt: 2, lastUsedAt: 2,
          groupId: null, sortIndex: 1000 },
      ],
      favoriteGroups: [],
    };
    const out = useSettingsStoreValidateForTest(tampered);
    expect(out.favorites.every((f) => Number.isFinite(f.sortIndex))).toBe(true);
  });

  it("handles empty/missing favorites in migration", () => {
    const out = useSettingsStoreMigrateForTest({}, 4);
    expect(out.favorites).toEqual([]);
    expect(out.favoriteGroups).toEqual([]);
  });

  it("drops non-object favorites from validation output", () => {
    const tampered = {
      favorites: [
        null,
        "garbage",
        42,
        { id: "a", path: "/a", label: "A", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: null, sortIndex: 0 },
      ],
      favoriteGroups: [],
    };
    const out = useSettingsStoreValidateForTest(tampered as unknown as Parameters<typeof useSettingsStoreValidateForTest>[0]);
    expect(out.favorites).toHaveLength(1);
    expect(out.favorites[0].id).toBe("a");
  });

  it("validation merges file data with state before checking dangling groupIds", () => {
    // Regression guard for onRehydrateStorage fix: when the file-merged view
    // already contains a group, validation must NOT strip the groupId — even if
    // the raw settings.json state did not yet list that group.
    const stateBlob = {
      favorites: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: "grp-1", sortIndex: 0 },
      ],
      favoriteGroups: [], // stale — group not yet written back to settings.json
    };
    const fileFavorites = [
      { id: "f1", path: "/f1", label: "F1", shell: "powershell",
        addedAt: 1, lastUsedAt: 1, groupId: "grp-1", sortIndex: 0 },
    ];
    const fileGroups = [
      { id: "grp-1", label: "Arbeit", sortIndex: 0 },
    ];

    // Simulate the merge that onRehydrateStorage now performs before calling
    // _settingsValidate, i.e. file data overrides the raw state for these two fields.
    const merged = {
      ...stateBlob,
      favorites: fileFavorites,
      favoriteGroups: fileGroups,
    };
    const out = useSettingsStoreValidateForTest(merged);
    expect(out.favorites[0].groupId).toBe("grp-1"); // preserved — group exists in file-merged view
    expect(out.favoriteGroups).toHaveLength(1);
  });
});

describe("settingsStore migrate — apiKeys element validation", () => {
  it("keeps a well-formed apiKey entry through migrate", () => {
    const persisted = {
      apiKeys: [
        {
          id: "key-1",
          provider: "anthropic",
          label: "My Key",
          redactedKey: "sk-ant-...xxxx",
          addedAt: 1700000000000,
          isValid: true,
        },
      ],
    } as unknown;
    const migrated = useSettingsStoreMigrateForTest(persisted, 9);
    expect(migrated.apiKeys).toHaveLength(1);
    expect(migrated.apiKeys[0].id).toBe("key-1");
    expect(migrated.apiKeys[0].isValid).toBe(true);
  });

  it("drops malformed apiKey entries (missing fields / wrong types)", () => {
    const persisted = {
      apiKeys: [
        null,
        "garbage",
        { id: "no-redacted", provider: "anthropic", label: "X", addedAt: 1, isValid: true },
        { id: 42, provider: "anthropic", label: "bad-id-type", redactedKey: "r", addedAt: 1, isValid: true },
        {
          id: "key-ok",
          provider: "anthropic",
          label: "Valid",
          redactedKey: "sk-...xxxx",
          addedAt: 2,
          isValid: false,
        },
      ],
    } as unknown;
    const migrated = useSettingsStoreMigrateForTest(persisted, 9);
    expect(migrated.apiKeys).toHaveLength(1);
    expect(migrated.apiKeys[0].id).toBe("key-ok");
  });
});

describe("settingsStore migrate v8->v9 — showProtokolleTab entfernt", () => {
  it("strips the legacy showProtokolleTab key from preferences", () => {
    const persisted = {
      preferences: { frontendLogging: true, showProtokolleTab: true },
    } as unknown;
    const migrated = useSettingsStoreMigrateForTest(persisted, 8);
    expect("showProtokolleTab" in (migrated.preferences as object)).toBe(false);
    // frontendLogging must survive the strip.
    expect(migrated.preferences.frontendLogging).toBe(true);
  });
});

// ============================================================================
// favoriteGroups actions
// ============================================================================

describe("favoriteGroups actions", () => {
  beforeEach(() => {
    useSettingsStore.setState({ favorites: [], favoriteGroups: [] });
  });

  it("addFavoriteGroup creates a group with monotonic sortIndex", () => {
    const id1 = useSettingsStore.getState().addFavoriteGroup("Arbeit");
    const id2 = useSettingsStore.getState().addFavoriteGroup("Fun");
    const groups = useSettingsStore.getState().favoriteGroups;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: id1, label: "Arbeit", sortIndex: 0 });
    expect(groups[1]).toMatchObject({ id: id2, label: "Fun",    sortIndex: 1000 });
  });

  it("addFavoriteGroup rejects empty/whitespace label", () => {
    const id = useSettingsStore.getState().addFavoriteGroup("   ");
    expect(id).toBe("");
    expect(useSettingsStore.getState().favoriteGroups).toHaveLength(0);
  });

  it("renameFavoriteGroup updates label only", () => {
    const id = useSettingsStore.getState().addFavoriteGroup("Arbeit");
    useSettingsStore.getState().renameFavoriteGroup(id, "Work");
    expect(useSettingsStore.getState().favoriteGroups[0].label).toBe("Work");
  });

  it("renameFavoriteGroup ignores empty/whitespace label", () => {
    const id = useSettingsStore.getState().addFavoriteGroup("Arbeit");
    useSettingsStore.getState().renameFavoriteGroup(id, "   ");
    expect(useSettingsStore.getState().favoriteGroups[0].label).toBe("Arbeit");
  });

  it("removeFavoriteGroup cascade=unassign sets groupId to null", () => {
    const id = useSettingsStore.getState().addFavoriteGroup("Arbeit");
    useSettingsStore.setState({
      favorites: [{ id: "f1", path: "/f1", label: "F1", shell: "powershell",
                    addedAt: 1, lastUsedAt: 1, groupId: id, sortIndex: 0 }],
    });
    useSettingsStore.getState().removeFavoriteGroup(id, "unassign");
    const st = useSettingsStore.getState();
    expect(st.favoriteGroups).toHaveLength(0);
    expect(st.favorites[0].groupId).toBe(null);
  });

  it("removeFavoriteGroup cascade=delete removes group AND members", () => {
    const id = useSettingsStore.getState().addFavoriteGroup("Arbeit");
    useSettingsStore.setState({
      favorites: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: id, sortIndex: 0 },
        { id: "f2", path: "/f2", label: "F2", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: null, sortIndex: 0 },
      ],
    });
    useSettingsStore.getState().removeFavoriteGroup(id, "delete");
    const st = useSettingsStore.getState();
    expect(st.favoriteGroups).toHaveLength(0);
    expect(st.favorites.map(f => f.id)).toEqual(["f2"]);
  });

  it("reorderFavoriteGroups reindexes in 1000er steps", () => {
    const a = useSettingsStore.getState().addFavoriteGroup("A");
    const b = useSettingsStore.getState().addFavoriteGroup("B");
    const c = useSettingsStore.getState().addFavoriteGroup("C");
    useSettingsStore.getState().reorderFavoriteGroups([c, a, b]);
    const groups = useSettingsStore.getState().favoriteGroups;
    expect(groups.map(g => g.id)).toEqual([c, a, b]);
    expect(groups.map(g => g.sortIndex)).toEqual([0, 1000, 2000]);
  });
});

// ============================================================================
// moveFavorite + reorderFavorites (group-aware)
// ============================================================================

describe("moveFavorite + reorderFavorites (group-aware)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ favorites: [], favoriteGroups: [] });
  });

  it("moveFavorite changes groupId and reindexes target group", () => {
    const grpA = useSettingsStore.getState().addFavoriteGroup("A");
    const grpB = useSettingsStore.getState().addFavoriteGroup("B");
    useSettingsStore.setState({
      favorites: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: grpA, sortIndex: 0 },
        { id: "f2", path: "/f2", label: "F2", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: grpB, sortIndex: 0 },
        { id: "f3", path: "/f3", label: "F3", shell: "powershell",
          addedAt: 3, lastUsedAt: 3, groupId: grpB, sortIndex: 1000 },
      ],
    });
    useSettingsStore.getState().moveFavorite("f1", grpB, 0);
    const inB = useSettingsStore.getState().favorites
      .filter(f => f.groupId === grpB)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(inB.map(f => f.id)).toEqual(["f1", "f2", "f3"]);
    expect(inB.map(f => f.sortIndex)).toEqual([0, 1000, 2000]);
  });

  it("moveFavorite to null group puts item in ungrouped bucket", () => {
    const grpA = useSettingsStore.getState().addFavoriteGroup("A");
    useSettingsStore.setState({
      favorites: [
        { id: "f1", path: "/f1", label: "F1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: grpA, sortIndex: 0 },
      ],
    });
    useSettingsStore.getState().moveFavorite("f1", null, 0);
    expect(useSettingsStore.getState().favorites[0].groupId).toBe(null);
    expect(useSettingsStore.getState().favorites[0].sortIndex).toBe(0);
  });

  it("moveFavorite clamps targetIndex beyond the end", () => {
    const grpA = useSettingsStore.getState().addFavoriteGroup("A");
    useSettingsStore.setState({
      favorites: [
        { id: "a", path: "/a", label: "A", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: grpA, sortIndex: 0 },
        { id: "b", path: "/b", label: "B", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: grpA, sortIndex: 1000 },
        { id: "c", path: "/c", label: "C", shell: "powershell",
          addedAt: 3, lastUsedAt: 3, groupId: null, sortIndex: 0 },
      ],
    });
    // Try to move c to index 99 in grpA — should clamp to end (idx 2 → 2*1000 sortIndex).
    useSettingsStore.getState().moveFavorite("c", grpA, 99);
    const inA = useSettingsStore.getState().favorites
      .filter(f => f.groupId === grpA)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(inA.map(f => f.id)).toEqual(["a", "b", "c"]);
  });

  it("moveFavorite no-op for unknown favId", () => {
    const before = useSettingsStore.getState().favorites;
    useSettingsStore.getState().moveFavorite("ghost", null, 0);
    expect(useSettingsStore.getState().favorites).toBe(before);
  });

  it("reorderFavorites reindexes a single group in 1000er steps", () => {
    const grp = useSettingsStore.getState().addFavoriteGroup("A");
    useSettingsStore.setState({
      favorites: [
        { id: "a", path: "/a", label: "A", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: grp, sortIndex: 0 },
        { id: "b", path: "/b", label: "B", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: grp, sortIndex: 1000 },
        { id: "c", path: "/c", label: "C", shell: "powershell",
          addedAt: 3, lastUsedAt: 3, groupId: grp, sortIndex: 2000 },
      ],
    });
    useSettingsStore.getState().reorderFavorites(grp, ["c", "a", "b"]);
    const inGrp = useSettingsStore.getState().favorites
      .filter(f => f.groupId === grp)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(inGrp.map(f => f.id)).toEqual(["c", "a", "b"]);
    expect(inGrp.map(f => f.sortIndex)).toEqual([0, 1000, 2000]);
  });

  it("reorderFavorites does not touch other groups", () => {
    const grpA = useSettingsStore.getState().addFavoriteGroup("A");
    const grpB = useSettingsStore.getState().addFavoriteGroup("B");
    useSettingsStore.setState({
      favorites: [
        { id: "a1", path: "/a1", label: "a1", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: grpA, sortIndex: 0 },
        { id: "b1", path: "/b1", label: "b1", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: grpB, sortIndex: 0 },
        { id: "b2", path: "/b2", label: "b2", shell: "powershell",
          addedAt: 3, lastUsedAt: 3, groupId: grpB, sortIndex: 1000 },
      ],
    });
    useSettingsStore.getState().reorderFavorites(grpB, ["b2", "b1"]);
    const a = useSettingsStore.getState().favorites.find(f => f.id === "a1")!;
    expect(a.sortIndex).toBe(0); // unchanged
    expect(a.groupId).toBe(grpA);
  });

  it("reorderFavorites appends missing items at the end", () => {
    const grp = useSettingsStore.getState().addFavoriteGroup("A");
    useSettingsStore.setState({
      favorites: [
        { id: "a", path: "/a", label: "A", shell: "powershell",
          addedAt: 1, lastUsedAt: 1, groupId: grp, sortIndex: 0 },
        { id: "b", path: "/b", label: "B", shell: "powershell",
          addedAt: 2, lastUsedAt: 2, groupId: grp, sortIndex: 1000 },
      ],
    });
    // Only reorder "a"; "b" should be appended at idx 1.
    useSettingsStore.getState().reorderFavorites(grp, ["a"]);
    const inGrp = useSettingsStore.getState().favorites
      .filter(f => f.groupId === grp)
      .sort((a, b) => a.sortIndex - b.sortIndex);
    expect(inGrp.map(f => f.id)).toEqual(["a", "b"]);
    expect(inGrp.map(f => f.sortIndex)).toEqual([0, 1000]);
  });
});

// ============================================================================
// pendingTitleOverrides — rename intent survives async claudeSessionId resolution
// ============================================================================

describe("pendingTitleOverrides", () => {
  const SID = "session-123-abc"; // internal (stable) session id
  const UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // claude session UUID

  beforeEach(() => {
    // resetToDefaults() intentionally preserves sessionTitleOverrides — clear
    // both maps here so cases don't leak override/pending state into each other.
    useSettingsStore.setState({
      sessionTitleOverrides: {},
      pendingTitleOverrides: {},
    });
  });

  it("setPendingTitleOverride records intent keyed by the internal session id", () => {
    getState().setPendingTitleOverride(SID, "Mein Name");
    expect(getState().pendingTitleOverrides[SID]).toBe("Mein Name");
    // Pending must NOT leak into the persisted, UUID-keyed override map yet.
    expect(getState().sessionTitleOverrides).toEqual({});
  });

  it("flushPendingTitleOverride moves the intent under the claude UUID and clears pending", () => {
    getState().setPendingTitleOverride(SID, "Mein Name");
    getState().flushPendingTitleOverride(SID, UUID);

    expect(getState().sessionTitleOverrides[UUID]).toBe("Mein Name");
    // Pending entry consumed — no dangling intent.
    expect(getState().pendingTitleOverrides[SID]).toBeUndefined();
  });

  it("flushPendingTitleOverride is a no-op when there is no pending intent", () => {
    getState().flushPendingTitleOverride(SID, UUID);
    expect(getState().sessionTitleOverrides[UUID]).toBeUndefined();
  });
});
