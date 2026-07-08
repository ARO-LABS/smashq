/**
 * Kuratierte "Was ist neu"-Inhalte, ein Eintrag pro Release.
 *
 * Template/Content-Trennung: `WhatsNewModal` definiert WIE es aussieht,
 * diese Datei WAS drinsteht. Pro Release wird hier ein Eintrag gepflegt
 * (zusammen mit dem CHANGELOG.md-Abschnitt, vor dem Release-Tag) — kein
 * Design, keine CSS-Zeile. Fehlt der Eintrag zur laufenden Version, zeigt
 * die App KEIN Modal (stiller Skip): das Anzeigen ist eine redaktionelle
 * Entscheidung pro Release, kein Automatismus.
 *
 * `icon` ist bewusst ein Schluessel aus einem kleinen kuratierten Set
 * (gemappt auf die ICONS-Registry in WhatsNewModal) — Tippfehler sind
 * Compile-Fehler, und das Design bleibt ueber Releases konsistent.
 */

export type WhatsNewIconKey =
  | "restore"
  | "edit"
  | "stability"
  | "panels"
  | "design"
  | "update"
  | "terminal";

export interface WhatsNewHighlight {
  icon: WhatsNewIconKey;
  title: string;
  text: string;
}

export interface WhatsNewEntry {
  /** Muss exakt der App-Version (tauri.conf.json) des Releases entsprechen. */
  version: string;
  /** ISO-Datum des Releases. */
  date: string;
  /** Ein Satz Einordnung, erscheint unter dem Header. */
  intro: string;
  /** 3-6 kuratierte Punkte — die wichtigsten Aenderungen, nicht alle. */
  highlights: WhatsNewHighlight[];
  /** 2-4 Punkte Verhaltensaenderungen, auf die zu achten ist. */
  watchouts: string[];
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    version: "1.0.22",
    date: "2026-07-08",
    intro:
      "Dieses Update buendelt das Azure-Design, flexible Seitenpanels, den macOS-Auto-Updater und zwei Fixes in der Session-Zuordnung.",
    highlights: [
      {
        icon: "restore",
        title: "Restore setzt die richtige Session fort",
        text: "Beim App-Start wird jede Kachel ueber einen Zeitanker ihrer urspruenglichen Claude-Session zugeordnet — nicht mehr der neuesten Session im Projektordner.",
      },
      {
        icon: "edit",
        title: "Umbenennen erreicht den Verlauf",
        text: "Ein neuer Titel erscheint jetzt auch in der Verlaufs-Ansicht des Konfigurations-Panels — auch direkt nach dem Erstellen einer Session.",
      },
      {
        icon: "stability",
        title: "Stabile Zuordnung bei parallelen Sessions",
        text: "Zwei gleichzeitig gestartete Sessions im selben Projekt koennen ihre Identitaet nicht mehr vertauschen.",
      },
      {
        icon: "panels",
        title: "Seitenpanels skalierbar und einklappbar",
        text: "Linke Navigation und Konfigurations-Panel lassen sich per Drag in der Breite anpassen und komplett einklappen.",
      },
      {
        icon: "design",
        title: "Azure-Design mit klarerem Dark Mode",
        text: "Der Akzent wechselt von Cyan auf Azure; dunkle Flaechen sind deutlicher voneinander getrennt.",
      },
      {
        icon: "update",
        title: "Auto-Updates auf macOS",
        text: "macOS-Builds sind signiert und notarisiert — Updates laufen dort jetzt wie unter Windows ueber den eingebauten Updater.",
      },
    ],
    watchouts: [
      "Findet der Restore keine eindeutige Zuordnung, startet die Session frisch, statt eine falsche fortzusetzen. Aeltere Sessions lassen sich ueber den Verlauf manuell fortsetzen.",
      "Einmalig nach dem Update: Sessions aus der Vorversion haben noch keinen Zeitanker und nutzen die bisherige Zuordnung.",
      "Eine zuvor gewaehlte Cyan-Akzentfarbe wird automatisch auf Azure migriert.",
      "Terminal-Farben folgen dem App-Theme nur noch per Opt-in (Einstellungen) — laufende Programme behalten so ihre Farbwahl.",
    ],
  },
];

/** Eintrag zur exakten Version, oder null (→ kein Modal, stiller Skip). */
export function getWhatsNewEntry(version: string): WhatsNewEntry | null {
  return WHATS_NEW.find((e) => e.version === version) ?? null;
}
