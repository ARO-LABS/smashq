import { describe, it, expect } from "vitest";
import { shortenPath, folderLabel } from "./pathUtils";

describe("shortenPath", () => {
  it("returns as-is for 3 or fewer segments", () => {
    expect(shortenPath("a/b/c")).toBe("a/b/c");
  });

  it("returns as-is for a single segment", () => {
    expect(shortenPath("project")).toBe("project");
  });

  it("shortens paths with more than 3 segments", () => {
    expect(shortenPath("home/user/projects/myapp")).toBe("~/projects/myapp");
  });

  it("preserves original path for <=3 segments with backslashes", () => {
    expect(shortenPath("C:\\Users\\dev")).toBe("C:\\Users\\dev");
  });

  it("handles mixed separators and shortens", () => {
    expect(shortenPath("C:\\Users/projects\\myapp")).toBe("~/projects/myapp");
  });

  it("returns empty string for empty input", () => {
    expect(shortenPath("")).toBe("");
  });
});

describe("folderLabel", () => {
  it("returns the last segment with forward slashes", () => {
    expect(folderLabel("home/user/projects")).toBe("projects");
  });

  it("returns the last segment with backslashes", () => {
    expect(folderLabel("C:\\Users\\myapp")).toBe("myapp");
  });

  it("returns the path itself when no separators", () => {
    expect(folderLabel("myproject")).toBe("myproject");
  });

  it("ignores a trailing forward slash", () => {
    expect(folderLabel("home/user/projects/")).toBe("projects");
  });

  it("ignores a trailing backslash", () => {
    expect(folderLabel("C:\\Users\\myapp\\")).toBe("myapp");
  });

  it("handles mixed separators", () => {
    expect(folderLabel("C:\\Users/dev\\target")).toBe("target");
  });

  it("returns the path itself for an empty string", () => {
    expect(folderLabel("")).toBe("");
  });

  it("returns the path itself for only separators", () => {
    expect(folderLabel("///")).toBe("///");
  });

  it("ignores multiple trailing separators", () => {
    expect(folderLabel("a/b/c///")).toBe("c");
  });

  it("collapses repeated internal separators", () => {
    expect(folderLabel("a//b///leaf")).toBe("leaf");
  });

  it("returns the segment for a single absolute Unix path", () => {
    expect(folderLabel("/leaf")).toBe("leaf");
  });
});

describe("shortenPath", () => {
  it("returns as-is for exactly 3 segments", () => {
    expect(shortenPath("a/b/c")).toBe("a/b/c");
  });

  it("shortens exactly 4 segments to last 2", () => {
    expect(shortenPath("a/b/c/d")).toBe("~/c/d");
  });

  it("shortens deep paths to the last 2 segments", () => {
    expect(shortenPath("a/b/c/d/e/f/g")).toBe("~/f/g");
  });

  it("shortens a deep Windows path with backslashes", () => {
    expect(shortenPath("C:\\Users\\dev\\projects\\app")).toBe("~/projects/app");
  });

  it("returns Windows path as-is when it has exactly 3 segments", () => {
    expect(shortenPath("C:\\Users\\dev")).toBe("C:\\Users\\dev");
  });

  it("treats a drive letter as a segment when counting", () => {
    // C:, Users, dev, app -> 4 segments -> shortened
    expect(shortenPath("C:\\Users\\dev\\app")).toBe("~/dev/app");
  });

  it("ignores trailing separators when counting segments", () => {
    expect(shortenPath("a/b/c/")).toBe("a/b/c/");
  });

  it("ignores repeated internal separators when counting", () => {
    // a, b, c -> 3 segments -> as-is despite doubled slashes
    expect(shortenPath("a//b//c")).toBe("a//b//c");
  });

  it("shortens an absolute Unix path with leading slash", () => {
    // home, user, projects, myapp -> 4 segments
    expect(shortenPath("/home/user/projects/myapp")).toBe("~/projects/myapp");
  });

  it("uses forward slashes in the shortened output regardless of input separator", () => {
    expect(shortenPath("a\\b\\c\\d")).toBe("~/c/d");
  });
});
