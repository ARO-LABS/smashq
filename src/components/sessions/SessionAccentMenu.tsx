import { useEffect, useRef } from "react";
import { ACCENT_HUES, ACCENT_NAMES, type AccentName } from "../../utils/sessionAccent";

interface SessionAccentMenuProps {
  x: number;
  y: number;
  current: AccentName;
  hasOverride: boolean;
  onSelect: (name: AccentName) => void;
  onReset: () => void;
  onClose: () => void;
}

/** Kleines Kontextmenü: Farb-Swatches + (optional) "Zurücksetzen". */
export function SessionAccentMenu({
  x,
  y,
  current,
  hasOverride,
  onSelect,
  onReset,
  onClose,
}: SessionAccentMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Akzentfarbe wählen"
      className="fixed z-50 flex flex-col gap-2 rounded-md bg-surface-overlay shadow-lift p-2"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex gap-1.5">
        {ACCENT_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            title={name}
            onClick={() => onSelect(name)}
            className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
              name === current ? "ring-2 ring-offset-1 ring-neutral-200" : ""
            }`}
            style={{ background: `oklch(72% 0.16 ${ACCENT_HUES[name]})` }}
          />
        ))}
      </div>
      {hasOverride && (
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-neutral-400 hover:text-accent text-left px-1 py-0.5 rounded-sm"
        >
          Auf Standard zurücksetzen
        </button>
      )}
    </div>
  );
}
