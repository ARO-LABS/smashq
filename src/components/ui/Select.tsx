import { useId } from "react";

// ============================================================================
// Types
// ============================================================================

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string; // Breiten-Steuerung durch Aufrufer: w-full (Default) oder z.B. w-56
}

// ============================================================================
// Component
// ============================================================================

export function Select({ label, value, options, onChange, disabled, className = "w-full" }: SelectProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="text-xs font-medium text-neutral-300">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} rounded-md bg-surface-raised shadow-hairline text-neutral-200 text-sm px-3 py-2 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
