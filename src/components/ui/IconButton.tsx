import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

// ============================================================================
// Types
// ============================================================================

export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  size?: IconButtonSize;
  label: string;
}

// ============================================================================
// Styles
// ============================================================================

const baseClasses =
  "inline-flex items-center justify-center rounded-md text-neutral-400 hover:text-accent hover:bg-hover-overlay transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-40 disabled:cursor-not-allowed";

const sizeClasses: Record<IconButtonSize, string> = {
  sm: "p-0.5",
  md: "p-1.5",
  lg: "p-2",
};

// ============================================================================
// Component
// ============================================================================

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, size = "md", label, className = "", ...rest }, ref) => {
    return (
      <button
        ref={ref}
        title={label}
        aria-label={label}
        className={`${baseClasses} ${sizeClasses[size]} ${className}`}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";
