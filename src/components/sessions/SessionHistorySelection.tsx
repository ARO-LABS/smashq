import React from "react";

/**
 * Präsentations-Komponenten für den Auswahl-Modus des History-Tabs (Task 6).
 * Bewusst store-frei — der Viewer hält den gesamten Auswahl-State und reicht
 * nur Werte + Callbacks durch, damit die Komponenten trivial testbar bleiben
 * und der Viewer die einzige Wahrheitsquelle für Selektion/Bestätigung ist.
 */

export interface SessionHistorySelectionRowProps {
  effectiveTitle: string;
  /** Läuft gerade als Live-Session — nicht auswählbar (Doppel-Delete-Schutz). */
  isActive: boolean;
  checked: boolean;
  onToggle: () => void;
}

/**
 * Kompakte Auswahl-Zeile: Checkbox + einzeilige Titel-Zeile. Vorschau, Meta
 * und Aktionen entfallen bewusst — im Auswahl-Modus zählt nur „welche".
 * Aktive Sessions rendern einen gestrichelten, nicht-interaktiven
 * Checkbox-Platzhalter statt einer echten Checkbox.
 */
export const SessionHistorySelectionRow: React.FC<SessionHistorySelectionRowProps> = ({
  effectiveTitle,
  isActive,
  checked,
  onToggle,
}) => {
  if (isActive) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 mx-1.5 rounded-md opacity-45">
        <span
          className="w-3.5 h-3.5 rounded-sm border border-dashed border-neutral-600 shrink-0"
          aria-hidden="true"
        />
        <span className="flex-1 truncate text-xs font-medium text-neutral-200" title={effectiveTitle}>
          {effectiveTitle}
        </span>
        <span className="px-1.5 py-px rounded-full bg-success/15 text-success text-[9.5px] font-bold tracking-wide uppercase shrink-0">
          Aktiv
        </span>
      </div>
    );
  }

  return (
    <label className="flex items-center gap-2 px-4 py-1.5 mx-1.5 rounded-md hover:bg-hover-overlay cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        aria-label={`Session auswählen: ${effectiveTitle}`}
        className="w-3.5 h-3.5 shrink-0 accent-accent"
      />
      <span className="flex-1 truncate text-xs font-medium text-neutral-200" title={effectiveTitle}>
        {effectiveTitle}
      </span>
    </label>
  );
};

export interface SessionHistorySelectionFooterProps {
  count: number;
  /** Bestätigungsstufe scharf — nächster Klick auf den Lösch-Button löscht. */
  confirmArmed: boolean;
  onCancel: () => void;
  onDeleteClick: () => void;
}

/**
 * Footer-Leiste des Auswahl-Modus: Zähler links, Abbrechen + zweistufiger
 * Lösch-Button rechts. Die Arm/Execute-Entscheidung trifft der Viewer —
 * der Footer rendert nur das Label passend zur Stufe.
 */
export const SessionHistorySelectionFooter: React.FC<SessionHistorySelectionFooterProps> = ({
  count,
  confirmArmed,
  onCancel,
  onDeleteClick,
}) => (
  <div className="mt-auto flex items-center justify-between px-4 py-2 border-t border-neutral-800 bg-surface-raised">
    <span className="text-xs text-neutral-400 tabular-nums">{count} ausgewählt</span>
    <div className="flex items-center gap-2">
      <button
        onClick={onCancel}
        className="px-2 py-1 rounded text-xs text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay transition-colors"
      >
        Abbrechen
      </button>
      <button
        onClick={onDeleteClick}
        disabled={count === 0}
        className="px-2 py-1 rounded text-xs font-medium bg-error/15 text-error hover:bg-error/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {confirmArmed ? `Wirklich löschen? (${count})` : "Löschen"}
      </button>
    </div>
  </div>
);
