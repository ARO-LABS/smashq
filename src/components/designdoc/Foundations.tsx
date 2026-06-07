const COLOR_TOKENS = [
  "--color-accent", "--color-success", "--color-error", "--color-warning", "--color-info",
];
const NEUTRALS = ["--neutral-50","--neutral-100","--neutral-200","--neutral-300","--neutral-400","--neutral-500","--neutral-600","--neutral-700","--neutral-800","--neutral-900","--neutral-950"];
const RADII = ["--radius-xs","--radius-sm","--radius-md","--radius-lg","--radius-full"];

function readVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function testIdFor(token: string): string {
  return `token-${token.replace(/^--/, "")}`;
}

export function Foundations(): JSX.Element {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
      {COLOR_TOKENS.map((t) => (
        <div key={t} data-testid={testIdFor(t)} style={{ display: "flex", flexDirection: "column", gap: "6px", width: "112px" }}>
          <div style={{ width: "56px", height: "56px", borderRadius: "var(--radius-md)", border: "1px solid var(--neutral-700)", background: `var(${t})` }} />
          <code style={{ fontSize: "10px", color: "var(--neutral-400)" }}>{t}</code>
          <code style={{ fontSize: "9px", color: "var(--neutral-500)" }}>{readVar(t)}</code>
        </div>
      ))}
      <div style={{ display: "flex", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--neutral-700)" }}>
        {NEUTRALS.map((t) => (
          <div key={t} title={t} style={{ width: "32px", height: "56px", background: `var(${t})` }} />
        ))}
      </div>
      {RADII.map((t) => (
        <div key={t} style={{ width: "56px", height: "56px", background: "var(--accent-a15)", border: "1px solid var(--color-accent)", borderRadius: `var(${t})`, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <code style={{ fontSize: "9px", color: "var(--neutral-400)" }}>{t.replace("--radius-", "")}</code>
        </div>
      ))}
    </div>
  );
}
