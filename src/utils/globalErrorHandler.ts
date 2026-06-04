/**
 * Global Error Handlers
 *
 * Catches all uncaught errors and unhandled promise rejections.
 * Logs them via errorLogger and shows a toast to the user.
 */

import { logError } from "./errorLogger";
import { useUIStore } from "../store/uiStore";

function showErrorToast(message: string): void {
  const addToast = useUIStore.getState().addToast;
  addToast({
    type: "error",
    title: "Fehler",
    message,
    duration: 8000,
  });
}

function truncateMessage(msg: string, maxLen = 120): string {
  return msg.length > maxLen ? msg.slice(0, maxLen) + "…" : msg;
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message || "Unbekannter Fehler");
    logError("window", error);
    showErrorToast(truncateMessage(error?.message ?? event.message ?? "Ein unbekannter Fehler ist aufgetreten."));
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logError("promise", reason);

    let message: string;
    if (reason instanceof Error) {
      message = reason.message;
    } else if (typeof reason === "string") {
      message = reason;
    } else {
      message = "Unbehandelte Promise-Rejection";
    }
    showErrorToast(truncateMessage(message));
  });
}
