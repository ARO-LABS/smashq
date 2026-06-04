import type { ComponentProps } from "react";

type PillTone = "success" | "warning" | "error" | "info" | "accent" | "neutral";

interface StatusPillProps extends Omit<ComponentProps<"span">, "children"> {
  tone: PillTone;
  label: string;
  size?: "sm" | "md";
}

const TONE_CLASSES: Record<PillTone, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  error:   "bg-error/15 text-error",
  info:    "bg-info/15 text-info",
  accent:  "bg-accent/15 text-accent",
  neutral: "bg-neutral-500/15 text-neutral-300",
};

const SIZE_CLASSES: Record<NonNullable<StatusPillProps["size"]>, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-xs",
};

export function StatusPill({
  tone,
  label,
  size = "sm",
  className = "",
  ...rest
}: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium uppercase tracking-wide ${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {label}
    </span>
  );
}
