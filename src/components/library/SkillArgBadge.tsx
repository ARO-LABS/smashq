import type { DiscoveredSkill } from "../../store/configDiscoveryStore";

// ── SkillArgBadge ────────────────────────────────────────────────────
// Shared badge renderer for skill arguments.
// Used in both SkillCard (list view) and SkillFrontmatterTable (detail view).

interface SkillArgBadgeProps {
  arg: DiscoveredSkill["args"][number];
}

export function SkillArgBadge({ arg }: SkillArgBadgeProps): JSX.Element {
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded ${
        arg.required
          ? "bg-amber-500/15 text-amber-400"
          : "bg-neutral-800 text-neutral-500"
      }`}
      title={arg.description || undefined}
    >
      {arg.name}{arg.required ? "*" : ""}
    </span>
  );
}
