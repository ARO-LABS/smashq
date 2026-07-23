/**
 * Pure Helpers für den History-Tab: Zeit-Gruppierung, Suche, Aktiv-Join.
 * Bewusst UI-frei, damit sie ohne DOM testbar sind.
 */

/** Minimaler Shape, den die Helpers brauchen (Subset von ClaudeSessionSummary). */
export interface HistorySessionLike {
  session_id: string;
  title: string;
  started_at: string;
  git_branch: string;
}

export type HistoryGroupKey = "today" | "week" | "older";

export interface HistoryGroup<T extends HistorySessionLike> {
  key: HistoryGroupKey;
  label: string;
  sessions: T[];
}

const GROUP_LABELS: Record<HistoryGroupKey, string> = {
  today: "Heute",
  week: "Diese Woche",
  older: "Älter",
};

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/**
 * Heute = gleicher Kalendertag; Diese Woche = innerhalb der letzten 7 Tage
 * (aber nicht heute); Älter = Rest. Unparsebares Datum fällt auf „Älter" —
 * lieber zu tief einsortiert als eine crashende Gruppierung.
 */
export function groupSessionsByTime<T extends HistorySessionLike>(
  sessions: T[],
  now: Date = new Date()
): HistoryGroup<T>[] {
  const todayStart = startOfDay(now);
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  const buckets: Record<HistoryGroupKey, T[]> = { today: [], week: [], older: [] };
  for (const s of sessions) {
    const ts = Date.parse(s.started_at);
    if (!Number.isFinite(ts)) {
      buckets.older.push(s);
    } else if (ts >= todayStart) {
      buckets.today.push(s);
    } else if (ts >= weekStart) {
      buckets.week.push(s);
    } else {
      buckets.older.push(s);
    }
  }

  return (Object.keys(buckets) as HistoryGroupKey[])
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: GROUP_LABELS[k], sessions: buckets[k] }));
}

/** Suche über effektiven Titel (inkl. Override) und Branch, case-insensitive. */
export function matchesHistoryQuery(
  session: HistorySessionLike,
  effectiveTitle: string,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    effectiveTitle.toLowerCase().includes(q) ||
    session.git_branch.toLowerCase().includes(q)
  );
}

/** Live = Prozess existiert noch (starting/running/waiting). done/error = beendet. */
const LIVE_STATUSES = new Set(["starting", "running", "waiting"]);

export function buildRunningClaudeIds(
  sessions: ReadonlyArray<{ claudeSessionId?: string; status: string }>
): Set<string> {
  const ids = new Set<string>();
  for (const s of sessions) {
    if (s.claudeSessionId && LIVE_STATUSES.has(s.status)) ids.add(s.claudeSessionId);
  }
  return ids;
}
