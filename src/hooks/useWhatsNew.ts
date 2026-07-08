import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "../store/settingsStore";
import { getWhatsNewEntry, type WhatsNewEntry } from "../whatsNew";
import { logError } from "../utils/errorLogger";

export interface UseWhatsNewResult {
  /** Kuratierter Eintrag der laufenden Version, oder null (kein Modal). */
  entry: WhatsNewEntry | null;
  dismiss: () => void;
}

/**
 * Einmaliges "Was ist neu"-Gating pro Release.
 *
 * Beim App-Start wird `getVersion()` mit dem persistierten `lastSeenVersion`
 * verglichen. Bei einer neuen Version wird SOFORT gestempelt (nicht erst bei
 * "Verstanden" — ein Crash vor dem Bestaetigen darf das Modal nicht bei jedem
 * Start erneut zeigen) und der kuratierte Eintrag aus `whatsNew.ts` geliefert.
 *
 * Kein Modal bei: Erstinstallation (lastSeenVersion === null — ein frischer
 * User braucht kein "neu"), bekannter Version, oder Version ohne Eintrag
 * (stiller Skip — reine Wartungs-Releases unterbrechen niemanden).
 */
export function useWhatsNew(): UseWhatsNewResult {
  const [entry, setEntry] = useState<WhatsNewEntry | null>(null);
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    // Dev-Gate wie useSessionRestore: in `npm run tauri dev` nicht stempeln/
    // zeigen (wuerde den Prod-Persist-Stand verfaelschen). MODE-Check statt
    // DEV, damit vitest (MODE='test') den Body ausfuehrt.
    if (import.meta.env.MODE === "development") return;

    getVersion()
      .then((current) => {
        const { lastSeenVersion, setLastSeenVersion } =
          useSettingsStore.getState();
        if (lastSeenVersion === current) return;

        setLastSeenVersion(current);
        if (lastSeenVersion === null) return; // Erstinstallation: nur Stempel

        setEntry(getWhatsNewEntry(current));
      })
      .catch((e) => logError("useWhatsNew", e));
  }, []);

  const dismiss = useCallback(() => setEntry(null), []);

  return { entry, dismiss };
}
