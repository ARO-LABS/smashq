import { BookOpen } from "lucide-react";

// ── InstancePanel ────────────────────────────────────────────────────
// Right column of the Library Detail Modal.
// M1: static placeholder — Best-Practice content arrives in M4.

export function InstancePanel(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[120px] gap-3 px-4 py-6 text-center">
      <BookOpen className="w-8 h-8 text-neutral-600 shrink-0" />
      <p className="text-xs font-medium text-neutral-500">Best Practices</p>
      <p className="text-[11px] text-neutral-600 max-w-[200px] leading-relaxed">
        Indikator-Chips, Quotes und vollständige Dokumentation folgen in M4.
      </p>
    </div>
  );
}
