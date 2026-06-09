import { useEffect } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { DURATION, EASE } from "../../utils/motion";
import { ICONS, ICON_SIZE } from "../../utils/icons";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  id: string;
  type: "success" | "error" | "achievement" | "info";
  title: string;
  message?: string;
  duration?: number;
  action?: ToastAction;
  /** 0–100 download/operation progress. When set, the toast renders a bar. */
  progress?: number;
}

/** Clamp a raw progress value to a safe integer percentage. */
const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const TOAST_CONFIG: Record<
  ToastData["type"],
  { icon: LucideIcon; border: string; text: string; glow: string }
> = {
  success: {
    icon: ICONS.toast.success,
    border: "border-success",
    text: "text-success",
    glow: "0 0 8px oklch(72% 0.16 155), 0 0 12px oklch(72% 0.16 155 / 0.2)",
  },
  error: {
    icon: ICONS.toast.error,
    border: "border-error",
    text: "text-error",
    glow: "0 0 8px oklch(62% 0.22 25), 0 0 12px oklch(62% 0.22 25 / 0.2)",
  },
  achievement: {
    icon: ICONS.toast.achievement,
    border: "border-warning",
    text: "text-warning",
    glow: "0 0 8px oklch(75% 0.14 70), 0 0 12px oklch(75% 0.14 70 / 0.2)",
  },
  info: {
    icon: ICONS.toast.info,
    border: "border-accent",
    text: "text-accent",
    glow: "0 0 8px oklch(72% 0.14 190), 0 0 12px oklch(72% 0.14 190 / 0.2)",
  },
};

const DEFAULT_DURATION = 5000;

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const config = TOAST_CONFIG[toast.type];
  const Icon = config.icon;
  const CloseIcon = ICONS.action.close;
  const duration = toast.duration ?? DEFAULT_DURATION;

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 80, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 80, scale: 0.95 }}
      transition={{ duration: DURATION.base, ease: EASE.out }}
      className={`w-80 rounded-none border-2 ${config.border} bg-surface-raised pointer-events-auto`}
      style={{ boxShadow: config.glow }}
      role="alert"
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Icon className={`${ICON_SIZE.close} ${config.text} shrink-0 mt-0.5`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold uppercase tracking-widest ${config.text}`}>
            {toast.title}
          </p>
          {toast.message && (
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              {toast.message}
            </p>
          )}
          {typeof toast.progress === "number" && (
            <div className="mt-2">
              <div
                className="h-1 w-full rounded-full bg-neutral-700/50 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={clampPct(toast.progress)}
              >
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: `${clampPct(toast.progress)}%` }}
                  transition={{ duration: DURATION.fast, ease: EASE.out }}
                />
              </div>
              <p className="text-xs text-neutral-400 mt-1">{clampPct(toast.progress)} %</p>
            </div>
          )}
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                // Always dismiss, even when the action throws — otherwise the
                // toast stays mounted forever and the user gets no feedback.
                try {
                  const result: unknown = toast.action!.onClick();
                  if (result instanceof Promise) {
                    result.catch(() => { /* swallowed: globalErrorHandler surfaces it */ });
                  }
                } catch {
                  // Surfaced via globalErrorHandler if it bubbles to window.
                } finally {
                  onDismiss(toast.id);
                }
              }}
              className={`mt-2 text-xs font-bold uppercase tracking-widest ${config.text} hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2`}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="text-neutral-500 hover:text-neutral-300 transition-colors shrink-0"
          aria-label="Benachrichtigung schließen"
        >
          <CloseIcon className={ICON_SIZE.nav} aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}
