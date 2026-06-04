import { describe, it, expect } from "vitest";
import { parseAgentFrontmatter } from "./parseAgentFrontmatter";

describe("parseAgentFrontmatter", () => {
  it("parses full frontmatter with all fields", () => {
    const content = [
      "---",
      "model: opus",
      "max-turns: 20",
      "allowed-tools: Read, Glob, Grep, Bash(ls *)",
      "---",
      "",
      "# Architect Agent",
      "",
      "You are a planning agent.",
    ].join("\n");

    const result = parseAgentFrontmatter(content, "architect.md");

    expect(result.metadata.name).toBe("architect");
    expect(result.metadata.model).toBe("opus");
    expect(result.metadata.maxTurns).toBe(20);
    expect(result.metadata.allowedTools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Bash(ls *)",
    ]);
    expect(result.metadata.description).toBe("Architect Agent");
    expect(result.body).toContain("You are a planning agent.");
  });

  it("uses filename as name when no name in frontmatter", () => {
    const content = "---\nmodel: sonnet\n---\n\nSome body.";
    const result = parseAgentFrontmatter(content, "test-engineer.md");

    expect(result.metadata.name).toBe("test-engineer");
    expect(result.metadata.model).toBe("sonnet");
  });

  it("handles content without frontmatter", () => {
    const content = "# Simple Agent\n\nNo frontmatter here.";
    const result = parseAgentFrontmatter(content, "simple.md");

    expect(result.metadata.name).toBe("simple");
    expect(result.metadata.model).toBe("");
    expect(result.metadata.maxTurns).toBeNull();
    expect(result.metadata.allowedTools).toEqual([]);
    expect(result.metadata.description).toBe("Simple Agent");
    expect(result.body).toBe(content);
  });

  it("handles empty content gracefully", () => {
    const result = parseAgentFrontmatter("", "empty.md");

    expect(result.metadata.name).toBe("empty");
    expect(result.metadata.description).toBe("");
    expect(result.body).toBe("");
  });

  it("falls back to 'Unknown' when no filename provided", () => {
    const result = parseAgentFrontmatter("Some content");
    expect(result.metadata.name).toBe("Unknown");
  });

  it("handles malformed frontmatter (no closing delimiter)", () => {
    const content = "---\nmodel: opus\nThis never closes";
    const result = parseAgentFrontmatter(content, "broken.md");

    expect(result.metadata.name).toBe("broken");
    // Falls back to extracting description from content
    expect(result.body).toBe(content);
  });

  it("extracts description from first non-heading line if no heading", () => {
    const content = "---\nmodel: opus\n---\n\nThis is a plain description.";
    const result = parseAgentFrontmatter(content, "agent.md");

    expect(result.metadata.description).toBe("This is a plain description.");
  });

  it("respects explicit name and description in frontmatter", () => {
    const content = [
      "---",
      "name: Custom Name",
      "description: Custom description",
      "model: haiku",
      "---",
      "",
      "# Heading ignored for description",
    ].join("\n");

    const result = parseAgentFrontmatter(content, "agent.md");

    expect(result.metadata.name).toBe("Custom Name");
    expect(result.metadata.description).toBe("Custom description");
  });

  it("strips .md extension case-insensitively from filename", () => {
    const result = parseAgentFrontmatter("body", "Planner.MD");
    expect(result.metadata.name).toBe("Planner");
  });

  it("only strips trailing .md, keeps mid-name dots", () => {
    const result = parseAgentFrontmatter("body", "agent.v2.md");
    expect(result.metadata.name).toBe("agent.v2");
  });

  it("falls back to filename when name value is empty", () => {
    const content = "---\nname:\nmodel: opus\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "fallback.md");
    expect(result.metadata.name).toBe("fallback");
  });

  it("falls back to 'Unknown' when name empty and no filename", () => {
    const content = "---\nname:   \n---\n\nBody.";
    const result = parseAgentFrontmatter(content);
    expect(result.metadata.name).toBe("Unknown");
  });

  it("ignores invalid max-turns value", () => {
    const content = "---\nmax-turns: not-a-number\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.maxTurns).toBeNull();
  });

  it("parses max-turns with leading numeric prefix", () => {
    const content = "---\nmax-turns: 15abc\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.maxTurns).toBe(15);
  });

  it("parses negative max-turns", () => {
    const content = "---\nmax-turns: -5\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.maxTurns).toBe(-5);
  });

  it("returns empty allowedTools for empty allowed-tools value", () => {
    const content = "---\nallowed-tools:\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.allowedTools).toEqual([]);
  });

  it("trims whitespace and drops empty entries in allowed-tools", () => {
    const content = "---\nallowed-tools:  Read ,  , Glob ,,\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.allowedTools).toEqual(["Read", "Glob"]);
  });

  it("handles single tool in allowed-tools", () => {
    const content = "---\nallowed-tools: Bash\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.allowedTools).toEqual(["Bash"]);
  });

  it("ignores unknown frontmatter keys", () => {
    const content = "---\nunknown-key: value\nmodel: opus\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.model).toBe("opus");
  });

  it("ignores frontmatter lines without colon", () => {
    const content = "---\njust a comment line\nmodel: opus\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.model).toBe("opus");
  });

  it("trims surrounding whitespace from frontmatter values", () => {
    const content = "---\nmodel:    sonnet   \n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.model).toBe("sonnet");
  });

  it("handles indented frontmatter lines via trim", () => {
    const content = "---\n   model: haiku\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.model).toBe("haiku");
  });

  it("derives description from a deeper heading level", () => {
    const content = "---\nmodel: opus\n---\n\n### Sub Heading\n\nText.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.description).toBe("Sub Heading");
  });

  it("skips blank lines when deriving description", () => {
    const content = "---\nmodel: opus\n---\n\n\n\nFirst real line.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.description).toBe("First real line.");
  });

  it("leaves description empty when body is empty", () => {
    const content = "---\nmodel: opus\n---\n";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.description).toBe("");
  });

  it("does not treat heading without space as a heading", () => {
    const content = "---\nmodel: opus\n---\n\n#NoSpace";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.description).toBe("#NoSpace");
  });

  it("trims the body block", () => {
    const content = "---\nmodel: opus\n---\n\n\n  Body text  \n\n";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.body).toBe("Body text");
  });

  it("keeps later duplicate key value (last wins)", () => {
    const content = "---\nmodel: opus\nmodel: haiku\n---\n\nBody.";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.model).toBe("haiku");
  });

  it("does not derive description when explicit description present even if empty heading body", () => {
    const content = "---\ndescription: explicit\n---\n\n# Heading";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.description).toBe("explicit");
  });

  it("treats empty explicit description by deriving from body", () => {
    const content = "---\ndescription:\n---\n\n# Derived";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.metadata.description).toBe("Derived");
  });

  it("handles frontmatter with no body after closing delimiter", () => {
    const content = "---\nmodel: opus\n---";
    const result = parseAgentFrontmatter(content, "a.md");
    expect(result.body).toBe("");
    expect(result.metadata.model).toBe("opus");
  });
});
