import { AnimatePresence } from "framer-motion";
import { useUIStore } from "../../store/uiStore";
import { Toast } from "./Toast";
import type { ToastData } from "./Toast";

const MAX_VISIBLE_TOASTS = 5;

/** Maps uiStore Toast type to ToastData type */
function mapToastType(
  storeType: "achievement" | "error" | "info" | "success"
): ToastData["type"] {
  return storeType;
}

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  const visibleToasts = toasts.slice(-MAX_VISIBLE_TOASTS);

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 pointer-events-none" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {visibleToasts.map((t) => (
          <Toast
            key={t.id}
            toast={{
              id: t.id,
              type: mapToastType(t.type),
              title: t.title,
              message: t.message,
              duration: t.duration,
              action: t.action,
              progress: t.progress,
            }}
            onDismiss={removeToast}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
