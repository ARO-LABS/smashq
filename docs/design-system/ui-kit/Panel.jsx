// Panel.jsx — bordered panel with uppercase header
const Panel = ({ title, actions, children, active, glow, padding = true, scroll = false, style = {} }) => {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface-raised)',
      border: `1px solid ${active ? 'var(--color-accent)' : 'var(--neutral-700)'}`,
      boxShadow: glow ? 'var(--glow-accent)' : 'none',
      minWidth: 0, minHeight: 0,
      transition: 'border-color 200ms var(--ease-out), box-shadow 200ms var(--ease-out)',
      ...style,
    }}>
      {title && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', borderBottom: '1px solid var(--neutral-700)', flexShrink: 0,
        }}>
          <h3 style={{
            margin: 0, fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: active ? 'var(--color-accent)' : 'var(--neutral-300)',
          }}>{title}</h3>
          {actions && <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{actions}</div>}
        </div>
      )}
      <div style={{
        padding: padding ? 12 : 0, flex: 1, minHeight: 0,
        overflow: scroll ? 'auto' : 'visible',
      }}>{children}</div>
    </div>
  );
};

const StatusDot = ({ status, size = 8 }) => {
  const colorMap = {
    running: 'var(--color-accent)', active: 'var(--color-success)', idle: 'var(--neutral-500)',
    waiting: 'var(--color-warning)', done: 'var(--color-success)', error: 'var(--color-error)',
    planning: 'oklch(70% 0.14 250)',
  };
  const color = colorMap[status] || 'var(--neutral-500)';
  const pulse = status === 'running' || status === 'active' || status === 'planning';
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: 9999,
      background: color, flexShrink: 0,
      boxShadow: pulse ? `0 0 0 2px ${color}40` : 'none',
      animation: pulse ? 'ae-pulse 2s ease-in-out infinite' : 'none',
    }} />
  );
};

const StatusBadge = ({ status, label }) => {
  const map = {
    running: { color: 'var(--color-accent)', bg: 'var(--accent-a10)', text: 'LÄUFT' },
    idle: { color: 'var(--neutral-400)', bg: 'var(--hover-overlay)', text: 'IDLE' },
    waiting: { color: 'var(--color-warning)', bg: 'oklch(75% 0.14 70 / 0.12)', text: 'WARTET' },
    done: { color: 'var(--color-success)', bg: 'oklch(68% 0.17 155 / 0.12)', text: 'FERTIG' },
    error: { color: 'var(--color-error)', bg: 'oklch(62% 0.22 25 / 0.12)', text: 'FEHLER' },
    active: { color: 'var(--color-success)', bg: 'oklch(68% 0.17 155 / 0.10)', text: 'AKTIV' },
  };
  const s = map[status] || map.idle;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px', background: s.bg, color: s.color,
      border: `1px solid ${s.color}40`, fontSize: 10, fontWeight: 600,
      letterSpacing: '0.1em', textTransform: 'uppercase',
      fontFamily: 'var(--font-mono)',
    }}>
      <StatusDot status={status} size={6} />
      {label || s.text}
    </span>
  );
};

window.Panel = Panel;
window.StatusDot = StatusDot;
window.StatusBadge = StatusBadge;
