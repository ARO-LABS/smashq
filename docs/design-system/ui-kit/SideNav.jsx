// SideNav.jsx — 128px fixed left sidebar
const SideNav = ({ activeTab, onTabChange, mode, onToggleTheme }) => {
  const { Monitor, Columns3, BookOpen, FileEdit, ScrollText, Sun, Moon } = window.Icons;
  const top = [
    { id: 'sessions', label: 'Sitzungen', Icon: Monitor, badge: 3 },
    { id: 'kanban', label: 'Kanban', Icon: Columns3, badge: 12 },
    { id: 'library', label: 'Bibliothek', Icon: BookOpen },
    { id: 'editor', label: 'Editor', Icon: FileEdit },
  ];
  const bottom = [
    { id: 'logs', label: 'Protokolle', Icon: ScrollText },
  ];

  const renderItem = (item) => {
    const active = activeTab === item.id;
    return (
      <button key={item.id} onClick={() => onTabChange(item.id)}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--neutral-200)'; e.currentTarget.style.background = 'var(--hover-overlay)'; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--neutral-400)'; e.currentTarget.style.background = 'transparent'; } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 36, padding: '0 12px',
          background: active ? 'var(--accent-a10)' : 'transparent',
          color: active ? 'var(--color-accent)' : 'var(--neutral-400)',
          borderLeft: `2px solid ${active ? 'var(--color-accent)' : 'transparent'}`,
          border: 'none', borderLeftWidth: 2, borderLeftStyle: 'solid',
          borderLeftColor: active ? 'var(--color-accent)' : 'transparent',
          cursor: 'pointer', textAlign: 'left',
          transition: 'all 150ms var(--ease-out)',
        }}>
        <item.Icon size={16} />
        <span style={{ fontSize: 12, fontFamily: 'var(--font-body)' }}>{item.label}</span>
        {item.badge && (
          <span style={{
            marginLeft: 'auto', minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 9999, background: 'var(--color-error)', color: 'white', fontSize: 9, fontWeight: 700, padding: '0 4px',
          }}>{item.badge > 99 ? '99+' : item.badge}</span>
        )}
      </button>
    );
  };

  return (
    <nav style={{
      display: 'flex', flexDirection: 'column', width: 128, minWidth: 128,
      background: 'var(--surface-base)', borderRight: '1px solid var(--neutral-700)',
      padding: '8px 0', gap: 2,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px 8px',
        marginBottom: 4, borderBottom: '1px solid var(--neutral-700)',
      }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', fontWeight: 700, color: 'var(--neutral-400)' }}>v1.6.0</span>
      </div>

      {top.map(renderItem)}

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {bottom.map(renderItem)}
        <div style={{ margin: '4px 12px', borderTop: '1px solid var(--neutral-700)' }} />
        <button onClick={onToggleTheme}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--neutral-200)'; e.currentTarget.style.background = 'var(--hover-overlay)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--neutral-400)'; e.currentTarget.style.background = 'transparent'; }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 36, padding: '0 12px',
            background: 'transparent', color: 'var(--neutral-400)', border: 'none',
            borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
            cursor: 'pointer', textAlign: 'left', transition: 'all 150ms var(--ease-out)',
          }}>
          {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span style={{ fontSize: 12, fontFamily: 'var(--font-body)' }}>{mode === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </nav>
  );
};

window.SideNav = SideNav;
