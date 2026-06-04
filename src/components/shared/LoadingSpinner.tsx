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
    glow: "0 0 8px oklch(72% 0.16 155), 0 0 16px oklch(72% 0.16 155 / 0.3)",
  },
  blue: {
    border: "border-accent",
    glow: "0 0 8px oklch(72% 0.14 190), 0 0 16px oklch(72% 0.14 190 / 0.3)",
  },
  purple: {
    border: "border-info",
    glow: "0 0 8px oklch(60% 0.20 300), 0 0 16px oklch(60% 0.20 300 / 0.3)",
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
