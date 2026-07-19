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
  {
    version: "1.0.24",
    date: "2026-07-19",
    intro:
      "Dieses Update macht das Speichern von Einstellungen zuverlässig, führt einen wählbaren Permission-Modus für neue Sessions ein und repariert das Terminal auf macOS.",
    highlights: [
      {
        icon: "stability",
        title: "Einstellungen speichern jetzt zuverlässig",
        text: "Standard-Terminal, Standard-Projektordner, Permission-Modus, Benachrichtigungen und Sound gingen beim Schließen des Einstellungen-Fensters verloren, obwohl „Gespeichert“ angezeigt wurde. Diese Werte erreichen jetzt zuverlässig die Festplatte.",
      },
      {
        icon: "edit",
        title: "Permission-Modus für neue Sessions wählbar",
        text: "Unter Einstellungen → Sessions lässt sich festlegen, wie Claude startet: Standard (Nachfragen), Auto, Plan oder Bypass / YOLO. Gilt für neue Sessions und Resumes.",
      },
      {
        icon: "terminal",
        title: "macOS-Terminal repariert",
        text: "Farben werden dargestellt, Umlaute und Rahmenzeichen kommen nicht mehr verstümmelt an, und die Schrift nutzt macOS-System-Monospace statt eines generischen Fallbacks.",
      },
      {
        icon: "panels",
        title: "Neue Einstellungs-Sektion „Über“",
        text: "Zeigt App-Version, Build-Commit, Build-Datum und Plattform — mit „Diagnose kopieren“ für Bug-Reports sowie Links zu Repository, Issues und Releases.",
      },
      {
        icon: "update",
        title: "Update-Hinweise erscheinen jetzt für alle",
        text: "Dieses „Was ist neu“-Fenster öffnete sich nach einem Update von Versionen vor 1.0.23 nicht — die App hielt Bestands-Installationen fälschlich für Neuinstallationen. Ab jetzt erscheint es nach jedem Update einmalig.",
      },
    ],
    watchouts: [
      "Verhaltensänderung: Neue Sessions starten jetzt im Modus Standard (Nachfragen) statt wie bisher ohne Rückfragen. Wer das alte Verhalten will, stellt einmalig auf Bypass / YOLO um (Einstellungen → Sessions).",
      "Einstellungen, die bisher vom Speicher-Bug betroffen waren (Benachrichtigungen, Sound, Session-Standards), einmalig prüfen und neu setzen — frühere Änderungen haben die Festplatte nie erreicht.",
      "Dieses Fenster wurde beim 1.0.23-Update übersprungen — die 1.0.23-Änderungen (Session-Zuordnung, macOS, Azure-Design) stehen im vollständigen Changelog.",
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
