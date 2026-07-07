type SpinnerSize = "sm" | "md" | "lg";
type SpinnerColor = "green" | "blue" | "purple";

const SIZE_MAP: Record<SpinnerSize, string> = {
  sm: "w-5 h-5 border-2",
  md: "w-8 h-8 border-2",
  lg: "w-12 h-12 border-[3px]",
};

const COLOR_MAP: Record<SpinnerColor, { border: string; glow: string }> = {
  green: {
    border: "border-success",
    glow: "0 0 8px var(--color-success), 0 0 16px color-mix(in oklch, var(--color-success) 30%, transparent)",
  },
  blue: {
    border: "border-accent",
    glow: "0 0 8px var(--color-accent), 0 0 16px color-mix(in oklch, var(--color-accent) 30%, transparent)",
  },
  purple: {
    border: "border-info",
    glow: "0 0 8px var(--color-info), 0 0 16px color-mix(in oklch, var(--color-info) 30%, transparent)",
  },
};

interface LoadingSpinnerProps {
  size?: SpinnerSize;
  color?: SpinnerColor;
}

export function LoadingSpinner({ size = "md", color = "blue" }: LoadingSpinnerProps) {
  const sizeClass = SIZE_MAP[size];
  const colorConfig = COLOR_MAP[color];

  return (
    <div className="flex items-center justify-center w-full h-full min-h-[48px]">
      <div
        className={`${sizeClass} ${colorConfig.border} border-t-transparent rounded-full neon-spin-animation`}
        style={{ boxShadow: colorConfig.glow }}
      />
    </div>
  );
}
