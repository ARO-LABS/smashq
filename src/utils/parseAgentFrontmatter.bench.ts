/**
 * Performance baseline for `parseAgentFrontmatter`.
 *
 * Run with `npm run bench` (compare against the checked-in baseline via
 * `npm run bench:compare`). The four cases span the realistic input range —
 * from a five-line agent file to a multi-KB definition — so a regression in
 * any size class shows up as a drop in ops/sec versus `perf/baseline.frontend.json`.
 */
import { bench, describe } from "vitest";
import { parseAgentFrontmatter } from "./parseAgentFrontmatter";

/** Minimal agent: only the keys the parser branches on. */
const SMALL = `---
name: tidy
model: haiku
allowed-tools: Read, Glob
---
# Tidy
Keeps the workspace clean.`;

/** Typical agent: full frontmatter plus a ~40-line markdown body. */
const MEDIUM = `---
name: code-reviewer
description: Reviews a finished step against the plan and coding standards.
model: opus
max-turns: 25
allowed-tools: Read, Glob, Grep, Bash(git diff *), Edit
---
# Code Reviewer

${Array.from({ length: 40 }, (_, i) => `- Review checklist item ${i + 1}: verify intent, scope, and tests.`).join("\n")}`;

/** Large agent: ~10 KB body — exercises the body `.trim()` + heading scan. */
const LARGE = `---
name: architect
description: Designs implementation plans for non-trivial features.
model: opus
max-turns: 40
allowed-tools: Read, Glob, Grep
---
# Architect

${Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}. ${"lorem ipsum dolor sit amet ".repeat(4)}`).join("\n\n")}`;

/** Edge case: no frontmatter at all — hits the early-return + heading fallback. */
const NO_FRONTMATTER = `# Standalone Agent

This file has no YAML frontmatter, so the parser must fall back to deriving
a description from the first heading.`;

describe("parseAgentFrontmatter", () => {
  bench("small (5-line frontmatter)", () => {
    parseAgentFrontmatter(SMALL, "tidy.md");
  });

  bench("medium (~40-line body)", () => {
    parseAgentFrontmatter(MEDIUM, "code-reviewer.md");
  });

  bench("large (~10 KB body)", () => {
    parseAgentFrontmatter(LARGE, "architect.md");
  });

  bench("edge (no frontmatter)", () => {
    parseAgentFrontmatter(NO_FRONTMATTER, "standalone.md");
  });
});
