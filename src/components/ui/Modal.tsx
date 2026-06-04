import { useEffect, useCallback, useId, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { IconButton } from "./IconButton";

// ============================================================================
// Types
// ============================================================================

export type ModalSize = "sm" | "md" | "lg" | "none";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  size?: ModalSize;
  className?: string;
}

// ============================================================================
// Styles
// ============================================================================

const sizeClasses: Record<ModalSize, string> = {
  sm: "w-full max-w-sm",
  md: "w-full max-w-md",
  lg: "w-full max-w-lg",
  none: "",
};

// ============================================================================
// Component
// ============================================================================

export function Modal({
  open,
  onClose,
  children,
  title,
  size = "md",
  className = "",
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  // Focus trap: focus content on open
  useEffect(() => {
    if (open) {
      contentRef.current?.focus();
    }
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Dialog */}
          <motion.div
            ref={contentRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title !== undefined ? titleId : undefined}
            tabIndex={-1}
            className={`relative flex flex-col bg-surface-raised rounded-lg shadow-modal focus:outline-none ${sizeClasses[size]} ${className}`}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            {/* Header (optional) */}
            {title !== undefined && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
                <div id={titleId} className="flex-1 min-w-0">{title}</div>
                <IconButton
                  icon={<X className="w-5 h-5" />}
                  label="Schliessen"
                  onClick={onClose}
                />
              </div>
            )}

            {/* Content */}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
