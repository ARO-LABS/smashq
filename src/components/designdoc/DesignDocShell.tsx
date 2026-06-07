import { catalog } from "./catalog";
import { Stage } from "./Stage";

export function DesignDocShell(): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--surface-base)",
        color: "var(--neutral-200)",
        fontFamily: "var(--font-body)",
      }}
    >
      <nav
        style={{
          width: 200,
          minWidth: 200,
          borderRight: "1px solid var(--neutral-700)",
          padding: "24px 12px",
          position: "sticky",
          top: 0,
          alignSelf: "flex-start",
          height: "100vh",
          overflowY: "auto",
        }}
      >
        {catalog.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            style={{
              display: "block",
              padding: "6px 8px",
              color: "var(--neutral-300)",
              textDecoration: "none",
              fontSize: "13px",
            }}
          >
            {s.title}
          </a>
        ))}
      </nav>
      <main style={{ flex: 1, minWidth: 0, padding: "32px 40px" }}>
        {catalog.map((section) => (
          <section
            key={section.id}
            id={section.id}
            style={{ marginBottom: "48px" }}
          >
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "20px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--color-accent)",
                marginBottom: "16px",
              }}
            >
              {section.title}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: "16px",
              }}
            >
              {section.entries.map((entry) => (
                <Stage
                  key={entry.id}
                  id={entry.id}
                  label={entry.label}
                  state={entry.state}
                  interactive={entry.interactive}
                >
                  {entry.render()}
                </Stage>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
