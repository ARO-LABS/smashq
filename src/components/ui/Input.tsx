import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

// ============================================================================
// Types
// ============================================================================

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  icon?: ReactNode;
  size?: "sm" | "md";
}

// ============================================================================
// Styles
// ============================================================================

const sizeClasses = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-2 text-sm",
};

// ============================================================================
// Component
// ============================================================================

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, size = "md", className = "", id, ...rest }, ref) => {
    const inputId = id ?? (label ? `input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-neutral-300"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`w-full rounded-md bg-surface-raised shadow-hairline text-neutral-300 font-mono placeholder:text-neutral-500 transition-shadow duration-150 focus:outline-none focus:shadow-lift focus:ring-1 focus:ring-accent focus:ring-inset ${
              error ? "ring-1 ring-error" : ""
            } ${icon ? "pl-7" : ""} ${sizeClasses[size]} ${className}`}
            {...rest}
          />
        </div>
        {error && (
          <span className="text-xs text-error">{error}</span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
