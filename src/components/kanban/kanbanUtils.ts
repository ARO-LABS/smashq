/** Shared utilities for Kanban components */

export function labelStyle(color: string): React.CSSProperties {
  const hex = color.startsWith("#") ? color : `#${color}`;
  return {
    backgroundColor: `${hex}20`,
    color: hex,
    borderColor: `${hex}40`,
  };
}
