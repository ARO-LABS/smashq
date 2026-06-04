// Button.jsx — AgenticExplorer button
const AEButton = ({ variant = 'secondary', size = 'md', children, icon, onClick, disabled }) => {
  const styles = {
    primary: { bg: 'var(--color-success)', fg: 'oklch(12% 0.01 250)', border: 'transparent', weight: 700, tracking: '0.06em' },
    secondary: { bg: 'transparent', fg: 'var(--neutral-400)', border: 'var(--neutral-700)', weight: 500, tracking: 'normal' },
    ghost: { bg: 'transparent', fg: 'var(--neutral-400)', border: 'transparent', weight: 500, tracking: 'normal' },
    danger: { bg: 'oklch(62% 0.22 25 / 0.10)', fg: 'oklch(62% 0.22 25)', border: 'oklch(62% 0.22 25 / 0.40)', weight: 500, tracking: 'normal' },
  }[variant];
  const sz = { sm: '4px 10px', md: '8px 16px', lg: '10px 20px' }[size];
  const fs = { sm: 11, md: 12, lg: 13 }[size];
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={(e) => { if (!disabled && variant !== 'primary') e.currentTarget.style.color = 'var(--neutral-200)'; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.color = styles.fg; }}
      style={{
        padding: sz, background: styles.bg, color: styles.fg,
        border: `1px solid ${styles.border}`, borderRadius: 0,
        fontFamily: 'var(--font-body)', fontWeight: styles.weight, fontSize: fs,
        letterSpacing: styles.tracking, textTransform: variant === 'primary' ? 'uppercase' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'color 100ms var(--ease-out), border-color 100ms var(--ease-out), background 100ms var(--ease-out)',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
      {icon && <span style={{ display: 'inline-flex' }}>{icon}</span>}
      {children}
    </button>
  );
};

window.AEButton = AEButton;
