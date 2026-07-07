// Shared infrastructure for the layered Claude settings files, consumed by
// SettingsViewer and HooksViewer. Both read the same three settings sources
// (project, project-local, user) and render the same source legend / raw
// JSON view — this module is the single home for that shared surface.
// Viewer-specific parsing (buildSettingsSections / buildEventGroups) stays
// in the respective viewer.

/* eslint-disable react-refresh/only-export-components --
   Intentional shared module: it deliberately co-exports constants, a hook and
   presentational components. The fast-refresh granularity tradeoff is accepted. */

import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../../utils/errorLogger";

/** The three layered Claude settings sources, in precedence/display order. */
export type SettingsSource = "project" | "project-local" | "user";

export const SETTINGS_SOURCES: SettingsSource[] = [
  "project",
  "project-local",
  "user",
];

export const SOURCE_META: Record<
  SettingsSource,
  { label: string; color: string; dot: string; path: string }
> = {
  project: {
    label: "Projekt",
    color: "bg-accent/15 text-accent",
    dot: "bg-accent",
    path: ".claude/settings.json",
  },
  "project-local": {
    label: "Lokal",
    color: "bg-warning/15 text-warning",
    dot: "bg-warning",
    path: ".claude/settings.local.json",
  },
  user: {
    label: "User",
    color: "bg-cat-violet/15 text-cat-violet",
    dot: "bg-cat-violet",
    path: "~/.claude/settings.json",
  },
};

export type SettingsRaws = Record<SettingsSource, string>;

const EMPTY_RAWS: SettingsRaws = { project: "", "project-local": "", user: "" };

/**
 * Loads the three layered Claude settings files for `folder`. Returns the raw
 * file contents, a loading flag, and a `reload` callback. `logTag` scopes the
 * error log to the calling viewer (e.g. "SettingsViewer.load").
 */
export function useClaudeSettingsRaws(folder: string, logTag: string) {
  const [raws, setRaws] = useState<SettingsRaws>(EMPTY_RAWS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        invoke<string>("read_project_file", {
          folder,
          relativePath: ".claude/settings.json",
        }),
        invoke<string>("read_project_file", {
          folder,
          relativePath: ".claude/settings.local.json",
        }),
        invoke<string>("read_user_claude_file", {
          relativePath: "settings.json",
        }),
      ]);

      const values = results.map((r) =>
        r.status === "fulfilled" ? (r.value ?? "") : "",
      );

      setRaws({
        project: values[0],
        "project-local": values[1],
        user: values[2],
      });
    } catch (err) {
      logError(logTag, err);
      setRaws(EMPTY_RAWS);
    } finally {
      setLoading(false);
    }
  }, [folder, logTag]);

  useEffect(() => {
    load();
  }, [load]);

  return { raws, loading, reload: load };
}

/** Coloured badge naming a settings source — used inside section/hook cards. */
export function SourceBadge({ source }: { source: SettingsSource }) {
  const meta = SOURCE_META[source];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded-sm ${meta.color}`}
      title={meta.path}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

/** Header legend listing which sources contributed visible entries. */
export function SourceLegend({
  visibleSources,
}: {
  visibleSources: Set<SettingsSource>;
}) {
  return (
    <div className="flex items-center gap-2">
      {SETTINGS_SOURCES.map((s) => {
        const meta = SOURCE_META[s];
        if (!visibleSources.has(s)) return null;
        return (
          <div
            key={s}
            className="flex items-center gap-1"
            title={meta.path}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <span className="text-[10px] text-neutral-500">{meta.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Raw-JSON view: one labelled <pre> block per non-empty settings source. */
export function RawJsonView({ raws }: { raws: SettingsRaws }) {
  const activeSources = useMemo(
    () =>
      SETTINGS_SOURCES.filter((s) => raws[s]).map((s) => ({
        source: s,
        raw: raws[s],
      })),
    [raws],
  );

  return (
    <div className="space-y-3">
      {activeSources.map(({ source, raw }) => (
        <div key={source}>
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${SOURCE_META[source].dot}`}
            />
            <span className="text-xs text-neutral-400 font-medium">
              {SOURCE_META[source].label}
            </span>
            <span className="text-[10px] text-neutral-600">
              {SOURCE_META[source].path}
            </span>
          </div>
          <pre className="text-xs text-neutral-200 whitespace-pre-wrap font-mono leading-relaxed bg-surface-raised rounded-sm p-3 border border-neutral-700">
            {raw}
          </pre>
        </div>
      ))}
    </div>
  );
}
