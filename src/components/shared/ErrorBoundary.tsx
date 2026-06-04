import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { logError } from "../../utils/errorLogger";
import { useUIStore } from "../../store/uiStore";

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

  handleReload = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="rounded-none border-2 border-error bg-surface-raised p-6 m-4 glow-error"
        >
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-error" />
            <span className="text-error font-bold text-sm uppercase tracking-widest">
              RUNTIME ERROR
            </span>
          </div>

          <div className="retro-terminal p-3 mb-4">
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
            onClick={this.handleReload}
            className="flex items-center gap-2 px-4 py-2 rounded-none font-medium text-sm bg-red-900/30 border border-error text-error hover:bg-red-900/50 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            RELOAD
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
