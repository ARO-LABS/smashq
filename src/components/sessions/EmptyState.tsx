import { Monitor, FolderPlus } from "lucide-react";
import { Button } from "../ui/Button";

interface EmptyStateProps {
  onNewSession: () => void;
}

export function EmptyState({ onNewSession }: EmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-accent/10 blur-xl" aria-hidden="true" />
        <Monitor className="relative w-12 h-12 text-neutral-500" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-2 max-w-sm">
        <h2 className="text-lg font-semibold text-neutral-200">Keine Session aktiv</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">
          Ordner waehlen und Claude Session starten. Der Output erscheint hier in Echtzeit.
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onNewSession} icon={<FolderPlus className="w-4 h-4" />}>
        Neue Session starten
      </Button>
      <p className="text-xs text-neutral-500">
        Oder: Favorit aus der Sidebar waehlen
      </p>
    </div>
  );
}
