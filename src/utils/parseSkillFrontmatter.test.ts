import { describe, it, expect } from "vitest";
import { parseSkillFrontmatter } from "./parseSkillFrontmatter";

describe("parseSkillFrontmatter", () => {
  describe("no frontmatter", () => {
    it("returns defaults when content has no ---", () => {
      const result = parseSkillFrontmatter("Just some content");
      expect(result.metadata.name).toBe("Unknown");
      expect(result.metadata.userInvokable).toBe(false);
      expect(result.body).toBe("Just some content");
    });

    it("returns defaults when opening --- has no closing ---", () => {
      const result = parseSkillFrontmatter("---\nname: Test\nNo closing delimiter");
      expect(result.metadata.name).toBe("Unknown");
      expect(result.body).toBe("---\nname: Test\nNo closing delimiter");
    });
  });

  describe("basic fields", () => {
    it("parses name and description", () => {
      const content = "---\nname: MySkill\ndescription: Does things\n---\nBody here";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.name).toBe("MySkill");
      expect(result.metadata.description).toBe("Does things");
    });

    it("parses user-invokable true", () => {
      const content = "---\nuser-invokable: true\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.userInvokable).toBe(true);
    });

    it("parses user-invokable yes", () => {
      const content = "---\nuser-invokable: yes\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.userInvokable).toBe(true);
    });

    it("parses user-invokable false", () => {
      const content = "---\nuser-invokable: false\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.userInvokable).toBe(false);
    });

    it("defaults user-invokable to false when missing", () => {
      const content = "---\nname: Test\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.userInvokable).toBe(false);
    });
  });

  describe("args parsing", () => {
    it("parses a single arg", () => {
      const content = [
        "---",
        "args:",
        "  - name: file",
        "    description: The file path",
        "    required: true",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toHaveLength(1);
      expect(result.metadata.args[0]).toEqual({
        name: "file",
        description: "The file path",
        required: true,
      });
    });

    it("parses multiple args", () => {
      const content = [
        "---",
        "args:",
        "  - name: input",
        "    description: Input file",
        "    required: true",
        "  - name: output",
        "    description: Output file",
        "    required: false",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toHaveLength(2);
      expect(result.metadata.args[0].name).toBe("input");
      expect(result.metadata.args[1].name).toBe("output");
      expect(result.metadata.args[1].required).toBe(false);
    });

    it("defaults required to false and description to empty", () => {
      const content = "---\nargs:\n  - name: flag\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args[0]).toEqual({
        name: "flag",
        description: "",
        required: false,
      });
    });

    it("returns empty args when no args defined", () => {
      const content = "---\nname: NoArgs\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toEqual([]);
    });
  });

  describe("body extraction", () => {
    it("extracts body after closing ---", () => {
      const content = "---\nname: Test\n---\nThis is the body.\nSecond line.";
      const result = parseSkillFrontmatter(content);
      expect(result.body).toBe("This is the body.\nSecond line.");
    });

    it("returns empty body when nothing after closing ---", () => {
      const content = "---\nname: Test\n---\n";
      const result = parseSkillFrontmatter(content);
      expect(result.body).toBe("");
    });

    it("trims surrounding whitespace from body", () => {
      const content = "---\nname: Test\n---\n\n   Body padded   \n\n";
      const result = parseSkillFrontmatter(content);
      expect(result.body).toBe("Body padded");
    });
  });

  describe("boolean parsing", () => {
    it("parses user-invokable with uppercase TRUE", () => {
      const result = parseSkillFrontmatter("---\nuser-invokable: TRUE\n---\n");
      expect(result.metadata.userInvokable).toBe(true);
    });

    it("parses user-invokable with uppercase YES", () => {
      const result = parseSkillFrontmatter("---\nuser-invokable: YES\n---\n");
      expect(result.metadata.userInvokable).toBe(true);
    });

    it("parses user-invokable with surrounding whitespace", () => {
      const result = parseSkillFrontmatter("---\nuser-invokable:   true  \n---\n");
      expect(result.metadata.userInvokable).toBe(true);
    });

    it("treats '1' as falsy for user-invokable", () => {
      const result = parseSkillFrontmatter("---\nuser-invokable: 1\n---\n");
      expect(result.metadata.userInvokable).toBe(false);
    });

    it("treats 'no' as falsy for user-invokable", () => {
      const result = parseSkillFrontmatter("---\nuser-invokable: no\n---\n");
      expect(result.metadata.userInvokable).toBe(false);
    });
  });

  describe("field edge cases", () => {
    it("uses last value for duplicate name keys", () => {
      const result = parseSkillFrontmatter("---\nname: First\nname: Second\n---\n");
      expect(result.metadata.name).toBe("Second");
    });

    it("ignores unknown frontmatter keys", () => {
      const result = parseSkillFrontmatter("---\ncategory: tools\nname: Keep\n---\n");
      expect(result.metadata.name).toBe("Keep");
    });

    it("ignores lines without a colon", () => {
      const result = parseSkillFrontmatter("---\na plain line\nname: Real\n---\n");
      expect(result.metadata.name).toBe("Real");
    });

    it("sets name to empty string when name value is empty", () => {
      const result = parseSkillFrontmatter("---\nname:\n---\n");
      expect(result.metadata.name).toBe("");
    });

    it("trims whitespace from name value", () => {
      const result = parseSkillFrontmatter("---\nname:   Spaced   \n---\n");
      expect(result.metadata.name).toBe("Spaced");
    });

    it("keeps description empty when missing", () => {
      const result = parseSkillFrontmatter("---\nname: X\n---\n");
      expect(result.metadata.description).toBe("");
    });
  });

  describe("args parsing edge cases", () => {
    it("ignores sub-keys appearing before any arg item", () => {
      const content = [
        "---",
        "args:",
        "  description: orphan desc",
        "  - name: real",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toHaveLength(1);
      expect(result.metadata.args[0].name).toBe("real");
      expect(result.metadata.args[0].description).toBe("");
    });

    it("stops the args block at a non-indented key", () => {
      const content = [
        "---",
        "args:",
        "  - name: first",
        "    required: true",
        "name: AfterArgs",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toHaveLength(1);
      expect(result.metadata.name).toBe("AfterArgs");
    });

    it("trims whitespace from arg name and description", () => {
      const content = [
        "---",
        "args:",
        "  - name:    spacedName   ",
        "    description:   spaced desc   ",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args[0].name).toBe("spacedName");
      expect(result.metadata.args[0].description).toBe("spaced desc");
    });

    it("parses arg with tab indentation", () => {
      const content = ["---", "args:", "\t- name: tabbed", "---", ""].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toHaveLength(1);
      expect(result.metadata.args[0].name).toBe("tabbed");
    });

    it("skips blank lines within the args block", () => {
      const content = [
        "---",
        "args:",
        "  - name: a",
        "",
        "    description: desc a",
        "  - name: b",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toHaveLength(2);
      expect(result.metadata.args[0].description).toBe("desc a");
    });

    it("parses required false via 'no'", () => {
      const content = [
        "---",
        "args:",
        "  - name: opt",
        "    required: no",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args[0].required).toBe(false);
    });

    it("ignores an arg item with empty name", () => {
      const content = ["---", "args:", "  - name:", "---", ""].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.args).toEqual([]);
    });

    it("handles args block running to end of frontmatter", () => {
      const content = [
        "---",
        "name: HasArgs",
        "args:",
        "  - name: last",
        "    required: true",
        "---",
        "",
      ].join("\n");
      const result = parseSkillFrontmatter(content);
      expect(result.metadata.name).toBe("HasArgs");
      expect(result.metadata.args).toHaveLength(1);
      expect(result.metadata.args[0].required).toBe(true);
    });
  });
});
