import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { logError } from "../../utils/errorLogger";
import { useUIStore } from "../../store/uiStore";

const WarningIcon = ICONS.toast.error;
const RetryIcon = ICONS.action.retry;

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logError("ErrorBoundary", error);
    logError("ErrorBoundary", errorInfo.componentStack ?? "Unknown component stack");
    useUIStore.getState().addToast({
      type: "error",
      title: "Fehler",
      message: error?.message ?? "Ein unbekannter Render-Fehler ist aufgetreten.",
      duration: 8000,
    });
  }

  // Recover the subtree by clearing the error state so the children re-mount.
  handleRecover = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-lg border border-error bg-surface-raised p-6 m-4">
          <div className="flex items-center gap-3 mb-4">
            <WarningIcon className={`${ICON_SIZE.nav} text-error`} />
            <span className="text-error font-bold text-sm uppercase tracking-widest">
              LAUFZEITFEHLER
            </span>
          </div>

          <div className="rounded-md border border-neutral-800 bg-surface-raised p-3 mb-4">
            <p className="text-xs text-error font-mono break-all">
              {this.state.error?.message ?? "Ein unbekannter Fehler ist aufgetreten."}
            </p>
            {this.state.error?.stack && (
              <pre className="text-xs text-neutral-500 mt-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {this.state.error.stack}
              </pre>
            )}
          </div>

          <button
            onClick={this.handleRecover}
            className="flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm bg-surface-raised border border-error text-error hover:bg-hover-overlay focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 transition-colors duration-150"
          >
            <RetryIcon className={ICON_SIZE.nav} />
            Neu laden
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
