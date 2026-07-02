import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { DURATION, EASE } from "../../utils/motion";

/**
 * Verzoegerung bis zum Einblenden. Deutlich unter dem nicht konfigurierbaren
 * ~1-s-Delay des nativen title-Attributs — der Grund, warum diese Komponente
 * existiert (Dock-Hover fuehlte sich "verzoegert" an).
 */
const SHOW_DELAY_MS = 300;

interface TooltipProps {
  /** Tooltip-Text. Ersetzt das native `title`-Attribut des Triggers. */
  content: string;
  /** Trigger-Element (typisch ein Icon-Button). `aria-label` bleibt am Trigger. */
  children: ReactNode;
  /** Oeffnungsrichtung — der Dock am unteren Fensterrand braucht "top". */
  side?: "top" | "bottom";
}

/**
 * Leichtgewichtiger Hover-/Fokus-Tooltip. Blendet nach kurzem Delay mit
 * Fade ein und verschwindet beim Verlassen sofort (Standard-Verhalten von
 * Tooltips; ein Exit-Fade wuerde beim schnellen Ueberstreichen mehrerer
 * Icons als Geister-Spur nachziehen).
 */
export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function show() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
  }

  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setVisible(false);
  }

  const sideClasses =
    side === "top" ? "bottom-full left-1/2 mb-1.5" : "top-full left-1/2 mt-1.5";

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {visible && (
        <motion.span
          role="tooltip"
          initial={{ opacity: 0, x: "-50%" }}
          animate={{ opacity: 1, x: "-50%" }}
          transition={{ duration: DURATION.instant, ease: EASE.out }}
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-sm bg-surface-raised px-2 py-1 text-[11px] text-neutral-200 shadow-hairline ${sideClasses}`}
        >
          {content}
        </motion.span>
      )}
    </span>
  );
}
