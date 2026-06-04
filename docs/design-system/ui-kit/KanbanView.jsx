// KanbanView.jsx
const KanbanView = () => {
  const { Panel, StatusDot } = window;
  const { GitBranch, Clock, ChevronRight } = window.Icons;
  const columns = [
    { id: 'backlog', title: 'Backlog', count: 5, accent: 'var(--neutral-500)' },
    { id: 'planning', title: 'Planning', count: 2, accent: 'oklch(70% 0.14 250)' },
    { id: 'active', title: 'Active', count: 3, accent: 'var(--color-accent)' },
    { id: 'review', title: 'Review', count: 1, accent: 'var(--color-warning)' },
    { id: 'done', title: 'Done', count: 8, accent: 'var(--color-success)' },
  ];
  const cards = {
    backlog: [
      { id: 1, title: 'Tauri v2 Migration abschließen', session: 'agentic-dashboard', tags: ['tauri', 'chore'], age: '2d' },
      { id: 2, title: 'Kanban Drag-Handle a11y', session: 'agentic-dashboard', tags: ['a11y'], age: '4d' },
      { id: 3, title: 'Favoriten-Liste Sort-Order persistieren', session: 'agentic-dashboard', tags: ['bug'], age: '1d' },
    ],
    planning: [
      { id: 4, title: 'Pipeline Graph — isometric view', session: 'agentic-dashboard', tags: ['feat', 'design'], age: '3h', status: 'planning' },
    ],
    active: [
      { id: 5, title: 'PTY handshake Windows regression', session: 'agentic-dashboard', tags: ['bug', 'urgent'], age: '42m', status: 'running' },
      { id: 6, title: 'Notes panel markdown rendering', session: 'agentic-dashboard', tags: ['feat'], age: '2h', status: 'running' },
    ],
    review: [
      { id: 7, title: 'Update Theme Toggle — OKLCH tokens', session: 'agentic-dashboard', tags: ['refactor'], age: '1h', status: 'waiting' },
    ],
    done: [
      { id: 8, title: 'StatusBadge centralization', session: 'agentic-dashboard', tags: ['refactor'], age: '6h', status: 'done' },
      { id: 9, title: 'SideNav Badge count', session: 'agentic-dashboard', tags: ['feat'], age: '1d', status: 'done' },
    ],
  };

  return (
    <Panel title="Kanban · agentic-dashboard" padding={false} scroll>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))', gap: 2, padding: 2, minWidth: 0, height: '100%' }}>
        {columns.map(col => (
          <div key={col.id} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-base)', border: '1px solid var(--neutral-700)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderBottom: '1px solid var(--neutral-700)',
              borderTop: `2px solid ${col.accent}`,
            }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--neutral-300)' }}>
                {col.title}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)' }}>{col.count}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, overflow: 'auto' }}>
              {(cards[col.id] || []).map(card => (
                <KanbanCard key={card.id} card={card} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
};

const KanbanCard = ({ card }) => {
  const { StatusDot } = window;
  const { Clock } = window.Icons;
  const tagColor = {
    bug: 'var(--color-error)', urgent: 'var(--color-error)',
    feat: 'var(--color-accent)', chore: 'var(--neutral-400)',
    refactor: 'oklch(70% 0.14 250)', a11y: 'var(--color-warning)',
    design: 'oklch(68% 0.17 310)', tauri: 'oklch(70% 0.14 250)',
  };
  return (
    <div style={{
      background: 'var(--surface-raised)', border: '1px solid var(--neutral-700)',
      borderRadius: 2, padding: 10, cursor: 'grab',
      display: 'flex', flexDirection: 'column', gap: 8,
      transition: 'border-color 150ms var(--ease-out), transform 150ms var(--ease-out)',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--neutral-500)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--neutral-700)'; }}>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, lineHeight: 1.4, color: 'var(--neutral-200)', fontWeight: 500 }}>
        {card.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {card.tags.map(t => (
          <span key={t} style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, padding: '1px 6px', borderRadius: 2,
            background: 'transparent', border: `1px solid ${tagColor[t] || 'var(--neutral-600)'}`,
            color: tagColor[t] || 'var(--neutral-400)', letterSpacing: '0.05em',
          }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)' }}>
          {card.status && <StatusDot status={card.status} size={6} />}
          <span>{card.session}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--neutral-500)' }}>
          <Clock size={10} />
          {card.age}
        </div>
      </div>
    </div>
  );
};

window.KanbanView = KanbanView;
window.KanbanCard = KanbanCard;
