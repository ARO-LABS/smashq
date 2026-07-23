// ============================================================================
// Types
// ============================================================================

export interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  description?: string;
  disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

export function ToggleSwitch({ label, checked, onChange, description, disabled }: ToggleSwitchProps) {
  return (
    <label
      className={`flex items-start gap-2.5 text-sm transition-opacity duration-200 ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
          checked ? "bg-accent" : "bg-neutral-800 shadow-hairline"
        } disabled:cursor-not-allowed`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 h-[14px] w-[14px] rounded-full bg-neutral-100 transition-transform duration-200 ${
            checked ? "translate-x-[14px]" : "translate-x-0"
          }`}
        />
      </button>
      <span className="flex flex-col gap-0.5 min-w-0">
        <span className="text-neutral-200">{label}</span>
        {description ? <span className="text-xs text-neutral-500">{description}</span> : null}
      </span>
    </label>
  );
}
