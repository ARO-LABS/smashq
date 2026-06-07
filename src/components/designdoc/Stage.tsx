import { Component, useCallback, useState, type ReactNode } from "react";

interface StageProps {
  id: string;
  label: string;
  state?: string;
  interactive?: boolean;
  children: ReactNode;
}

interface BoundaryState {
  hasError: boolean;
}

class StageBoundary extends Component<{ children: ReactNode; onError: () => void }, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    this.props.onError();
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <span style={{ color: "var(--color-error)", fontSize: "12px" }}>Render-Fehler</span>;
    }
    return this.props.children;
  }
}

export function Stage({ id, label, state = "default", interactive = false, children }: StageProps): JSX.Element {
  const [errored, setErrored] = useState(false);
  const onError = useCallback(() => setErrored(true), []);
  return (
    <section
      data-testid={`stage-${id}`}
      data-dg-id={id}
      data-dg-state={state}
      data-dg-interactive={String(interactive)}
      data-dg-error={errored ? "true" : undefined}
      style={{
        background: "var(--surface-raised)",
        border: "1px solid var(--neutral-700)",
        borderRadius: "var(--radius-lg)",
        padding: "16px",
      }}
    >
      <div
        style={{
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--neutral-400)",
          marginBottom: "12px",
        }}
      >
        {label}
      </div>
      <div data-dg-stage-body style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-start" }}>
        <StageBoundary onError={onError}>{children}</StageBoundary>
      </div>
    </section>
  );
}
