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
  | "terminal"
  | "logs";

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
  // RUMPF fuer den naechsten Release — beim Release-Tag kuratieren:
  // version/date gegen die Manifeste pruefen (exakter Match Pflicht, sonst
  // stiller Skip) und Highlights/Watchouts aus dem CHANGELOG ergaenzen.
  {
    version: "1.0.24",
    date: "2026-07-08",
    intro: "Dieses Update behebt die Anzeige der Update-Hinweise nach einem Update von aelteren Versionen.",
    highlights: [
      {
        icon: "update",
        title: "Update-Hinweise erscheinen jetzt fuer alle",
        text: "Das \"Was ist neu\"-Fenster oeffnete sich nach einem Update von Versionen vor 1.0.23 nicht — die App hielt Bestands-Installationen faelschlich fuer Neuinstallationen. Ab jetzt erscheint es nach jedem Update einmalig.",
      },
    ],
    watchouts: [
      "Dieses Fenster wurde beim 1.0.23-Update uebersprungen — die 1.0.23-Aenderungen (Session-Zuordnung, macOS, Azure-Design) stehen im vollstaendigen Changelog.",
    ],
  },
  {
    version: "1.0.23",
    date: "2026-07-08",
    intro:
      "Dieses Update repariert die Session-Zuordnung, bringt macOS voll ans Laufen, macht die Seitenpanels flexibel und stellt das Design auf Azure um.",
    highlights: [
      {
        icon: "restore",
        title: "Restore setzt die richtige Session fort",
        text: "Beim App-Start wird jede Kachel ueber einen Zeitanker ihrer urspruenglichen Claude-Session zugeordnet — nicht mehr der neuesten im Projektordner. Parallel gestartete Sessions koennen ihre Identitaet nicht mehr vertauschen.",
      },
      {
        icon: "edit",
        title: "Umbenennen erreicht den Verlauf",
        text: "Ein neuer Titel erscheint jetzt auch in der Verlaufs-Ansicht des Konfigurations-Panels — auch direkt nach dem Erstellen einer Session. Die Leertaste funktioniert im Umbenennen-Feld wieder.",
      },
      {
        icon: "update",
        title: "macOS: Sessions starten, Updates laufen",
        text: "Sessions starten auf macOS jetzt zuverlaessig (Shell-Fallback plus PATH aus der Login-Shell). Builds sind signiert und notarisiert — Auto-Updates laufen wie unter Windows.",
      },
      {
        icon: "logs",
        title: "Protokolle mit mehr Kontrolle",
        text: "Neue Scope- (Session/Alle) und Sortier-Steuerung, Loeschen wirkt in allen Fenstern, und der Papierkorb entfernt die Log-Datei jetzt wirklich von der Platte.",
      },
      {
        icon: "panels",
        title: "Seitenpanels skalierbar und einklappbar",
        text: "Linke Navigation und Konfigurations-Panel lassen sich per Drag in der Breite anpassen und komplett einklappen.",
      },
      {
        icon: "design",
        title: "Azure-Design mit klarerem Dark Mode",
        text: "Der Akzent wechselt von Cyan auf Azure (eine gewaehlte Cyan-Projektfarbe wird automatisch migriert); dunkle Flaechen sind deutlicher voneinander getrennt.",
      },
    ],
    watchouts: [
      "Findet der Restore keine eindeutige Zuordnung, startet die Session frisch, statt eine falsche fortzusetzen. Aeltere Sessions lassen sich ueber den Verlauf manuell fortsetzen.",
      "Einmalig nach dem Update: Sessions aus der Vorversion haben noch keinen Zeitanker und nutzen die bisherige Zuordnung.",
      "Der Papierkorb in den Protokollen loescht die Log-Datei jetzt endgueltig (inklusive rotierter Dateien) — vorher wurde nur die Ansicht geleert.",
      "Terminal-Farben folgen dem App-Theme nur noch per Opt-in (Einstellungen) — laufende Programme behalten so ihre Farbwahl.",
    ],
  },
];

/** Eintrag zur exakten Version, oder null (→ kein Modal, stiller Skip). */
export function getWhatsNewEntry(version: string): WhatsNewEntry | null {
  return WHATS_NEW.find((e) => e.version === version) ?? null;
}
