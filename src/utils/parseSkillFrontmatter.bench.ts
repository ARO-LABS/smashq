/**
 * Performance baseline for `parseSkillFrontmatter`.
 *
 * Run with `npm run bench` (compare via `npm run bench:compare`). The skill
 * parser is heavier than the agent parser because of the nested `parseArgs`
 * loop, so the cases below deliberately scale the `args:` block — that is the
 * part most likely to regress. Results land in `perf/baseline.frontend.json`.
 */
import { bench, describe } from "vitest";
import { parseSkillFrontmatter } from "./parseSkillFrontmatter";

/** Minimal skill: no args block. */
const SMALL = `---
name: greet
description: Prints a greeting.
user-invokable: true
---
# Greet
Says hello.`;

/** Typical skill: a handful of args, each with description + required. */
const MEDIUM = `---
name: deploy
description: Deploys the app to a target environment.
user-invokable: true
args:
${Array.from(
  { length: 6 },
  (_, i) => `  - name: arg${i + 1}\n    description: Description for argument ${i + 1}.\n    required: ${i % 2 === 0}`,
).join("\n")}
---
# Deploy

${Array.from({ length: 30 }, (_, i) => `Step ${i + 1} of the deployment runbook.`).join("\n")}`;

/** Large skill: 50 args — stresses the nested `parseArgs` iteration. */
const LARGE = `---
name: orchestrate
description: Orchestrates a complex multi-stage workflow.
user-invokable: false
args:
${Array.from(
  { length: 50 },
  (_, i) => `  - name: param${i + 1}\n    description: ${"detailed explanation ".repeat(6)}\n    required: ${i % 3 === 0}`,
).join("\n")}
---
# Orchestrate

${Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. ${"lorem ipsum ".repeat(5)}`).join("\n\n")}`;

/** Edge case: no frontmatter — hits the early-return path. */
const NO_FRONTMATTER = `# Plain Skill

No YAML frontmatter here; the parser returns default metadata immediately.`;

describe("parseSkillFrontmatter", () => {
  bench("small (no args)", () => {
    parseSkillFrontmatter(SMALL);
  });

  bench("medium (6 args)", () => {
    parseSkillFrontmatter(MEDIUM);
  });

  bench("large (50 args)", () => {
    parseSkillFrontmatter(LARGE);
  });

  bench("edge (no frontmatter)", () => {
    parseSkillFrontmatter(NO_FRONTMATTER);
  });
});
