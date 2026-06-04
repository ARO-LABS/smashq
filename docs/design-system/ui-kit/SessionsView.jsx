// SessionCard.jsx + SessionsView
const SessionCard = ({ session, active, onClick, onClose }) => {
  const { FolderOpen, Terminal, X, ExternalLink } = window.Icons;
  const { StatusDot } = window;
  const [hover, setHover] = React.useState(false);

  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6,
        padding: '10px 12px',
        background: active ? 'var(--accent-a10)' : 'var(--surface-raised)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--neutral-700)'}`,
        borderLeftWidth: 2, borderLeftStyle: 'solid',
        borderLeftColor: active ? 'var(--color-accent)' : 'var(--neutral-700)',
        cursor: 'pointer',
        transition: 'all 150ms var(--ease-out)',
        position: 'relative',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <StatusDot status={session.status} size={8} />
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
          color: active ? 'var(--color-accent)' : 'var(--neutral-200)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
        }}>{session.name}</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)',
          letterSpacing: '0.05em',
        }}>{session.elapsed}</span>
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{session.path}</div>

      <div style={{
        position: 'absolute', top: 8, right: 8, display: 'flex', gap: 2,
        opacity: hover ? 1 : 0, transition: 'opacity 100ms var(--ease-out)', pointerEvents: hover ? 'auto' : 'none',
      }}>
        <IconBtn title="Ordner öffnen" onClick={(e) => e.stopPropagation()}><FolderOpen size={12} /></IconBtn>
        <IconBtn title="Terminal" onClick={(e) => e.stopPropagation()}><Terminal size={12} /></IconBtn>
        <IconBtn title="Ablösen" onClick={(e) => e.stopPropagation()}><ExternalLink size={12} /></IconBtn>
        <IconBtn title="Schließen" onClick={(e) => { e.stopPropagation(); onClose?.(); }} danger><X size={12} /></IconBtn>
      </div>
    </div>
  );
};

const IconBtn = ({ children, onClick, title, danger }) => (
  <button onClick={onClick} title={title}
    onMouseEnter={(e) => { e.currentTarget.style.background = danger ? 'oklch(62% 0.22 25 / 0.18)' : 'var(--hover-overlay)'; e.currentTarget.style.color = danger ? 'var(--color-error)' : 'var(--neutral-200)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--neutral-400)'; }}
    style={{
      width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: 'transparent', border: 'none', color: 'var(--neutral-400)', cursor: 'pointer',
      transition: 'all 100ms var(--ease-out)',
    }}>{children}</button>
);

// SessionsView — the Sitzungen tab: list on left, terminal + details on right
const SessionsView = ({ sessions, activeId, setActiveId, onCloseSession, onNewSession }) => {
  const { Panel } = window;
  const { Plus, Search, ChevronRight } = window.Icons;
  const active = sessions.find(s => s.id === activeId) || sessions[0];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 280px', gap: 2, height: '100%', minHeight: 0 }}>
      <Panel title="Sitzungen" padding={false}
        actions={<>
          <button onClick={onNewSession} title="Neue Sitzung"
            style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--neutral-700)', color: 'var(--color-accent)', cursor: 'pointer' }}>
            <Plus size={12} />
          </button>
        </>}>
        <div style={{ padding: 8, borderBottom: '1px solid var(--neutral-700)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Search size={12} />
          <input placeholder="Filter..." style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--neutral-200)', fontFamily: 'var(--font-mono)', fontSize: 11,
          }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 8, overflow: 'auto' }}>
          {sessions.map(s => (
            <SessionCard key={s.id} session={s} active={s.id === activeId}
              onClick={() => setActiveId(s.id)} onClose={() => onCloseSession(s.id)} />
          ))}
        </div>
      </Panel>

      <Panel title={active ? `Terminal · ${active.name}` : 'Terminal'} padding={false} active glow
        actions={<span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)' }}>{active?.path}</span>}>
        <TerminalView session={active} />
      </Panel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
        <Panel title="Details">
          {active ? <DetailsPane session={active} /> : <Empty label="Keine Sitzung ausgewählt" />}
        </Panel>
        <Panel title="Notizen" style={{ flex: 1, minHeight: 0 }} scroll>
          <NotesPane />
        </Panel>
      </div>
    </div>
  );
};

const TerminalView = ({ session }) => {
  if (!session) return <Empty label="Keine Sitzung ausgewählt" />;
  const lines = session.log || [];
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55,
      padding: 14, overflow: 'auto', height: '100%', minHeight: 0,
      background: 'oklch(11% 0.01 250)', color: 'var(--neutral-200)',
    }}>
      {lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: 'pre-wrap', color: line.color || 'var(--neutral-200)' }}>
          {line.text}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        <span style={{ color: 'var(--color-accent)' }}>❯</span>
        <span style={{ display: 'inline-block', width: 7, height: 14, background: 'var(--color-accent)', animation: 'ae-pulse 1s steps(2) infinite' }} />
      </div>
    </div>
  );
};

const DetailsPane = ({ session }) => {
  const { StatusBadge } = window;
  const rows = [
    ['Status', <StatusBadge status={session.status} />],
    ['Laufzeit', <Mono>{session.elapsed}</Mono>],
    ['Branch', <Mono>{session.branch || 'main'}</Mono>],
    ['Modell', <Mono>{session.model || 'sonnet-4.5'}</Mono>],
    ['Tokens', <Mono>{session.tokens || '12.4k / 200k'}</Mono>],
    ['PID', <Mono>{session.pid || '48213'}</Mono>],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 10, fontFamily: 'var(--font-display)', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--neutral-500)' }}>{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
};

const Mono = ({ children }) => (
  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--neutral-200)' }}>{children}</span>
);

const NotesPane = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    {[
      { t: '14:32', body: 'PTY handshake rewritten — check Windows behavior before merge.' },
      { t: '14:08', body: 'Kanban DnD fires twice in strict mode; wrap in useCallback.' },
      { t: '13:45', body: 'Favoriten-Liste migrated to Zustand store.' },
    ].map((n, i) => (
      <div key={i} style={{ paddingLeft: 10, borderLeft: '2px solid var(--accent-a30)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)', marginBottom: 2 }}>{n.t}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--neutral-300)', lineHeight: 1.5 }}>{n.body}</div>
      </div>
    ))}
  </div>
);

const Empty = ({ label }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24, color: 'var(--neutral-500)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{label}</div>
);

window.SessionsView = SessionsView;
window.SessionCard = SessionCard;
window.Empty = Empty;
window.Mono = Mono;
