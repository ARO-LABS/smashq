import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ICONS, ICON_SIZE } from "../../utils/icons";

const LoadingIcon = ICONS.action.loading;

// ============================================================================
// Types
// ============================================================================

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

// ============================================================================
// Styles
// ============================================================================

const baseClasses =
  "inline-flex items-center justify-center font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 disabled:cursor-not-allowed";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "rounded-md bg-accent text-neutral-950 font-medium shadow-hairline hover:bg-accent-light hover:shadow-lift disabled:bg-accent/40 disabled:shadow-none transition-shadow duration-200",
  secondary:
    "rounded-md bg-surface-raised text-neutral-200 shadow-hairline hover:bg-hover-overlay hover:shadow-lift disabled:opacity-40 disabled:shadow-none transition-shadow duration-200",
  ghost:
    "rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay disabled:opacity-40 transition-colors duration-150",
  danger:
    "rounded-md bg-error text-neutral-950 font-medium shadow-hairline hover:bg-error/90 hover:shadow-lift disabled:opacity-40 disabled:shadow-none transition-shadow duration-200",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs gap-1.5",
  md: "px-3 py-1.5 text-sm gap-2",
  lg: "px-4 py-2 text-sm gap-2",
};

// ============================================================================
// Component
// ============================================================================

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "secondary",
      size = "md",
      loading = false,
      icon,
      children,
      disabled,
      className = "",
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...rest}
      >
        {loading ? (
          <LoadingIcon className={`${ICON_SIZE.card} animate-spin`} />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
