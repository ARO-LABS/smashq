import { describe, it, expect } from "vitest";
import { LanguageDescription } from "@codemirror/language";
import { codeLanguages } from "./languageSupport";

describe("codeLanguages (trimmed language list)", () => {
  it("exports between 15 and 25 language descriptions", () => {
    // We target ~20 languages; guard against accidental bloat or removal
    expect(codeLanguages.length).toBeGreaterThanOrEqual(15);
    expect(codeLanguages.length).toBeLessThanOrEqual(25);
  });

  it("includes all required languages for markdown code blocks", () => {
    const names = codeLanguages.map((l) => l.name);

    // Must-have languages per issue #113
    const required = [
      "JavaScript",
      "TypeScript",
      "JSON",
      "HTML",
      "CSS",
      "Rust",
      "YAML",
      "TOML",
      "Shell",
      "Python",
      "SQL",
      "Markdown",
    ];

    for (const lang of required) {
      expect(names).toContain(lang);
    }
  });

  it("resolves aliases correctly (e.g. 'bash' maps to Shell)", () => {
    const shell = codeLanguages.find((l) => l.name === "Shell");
    expect(shell).toBeDefined();
    // LanguageDescription stores aliases — verify 'bash' can be matched
    const matched = codeLanguages.find(
      (l) => l.name === "Shell" && l.alias.includes("bash"),
    );
    expect(matched).toBeDefined();
  });

  it("does not include bloat languages (e.g. APL, Brainfuck, Cobol)", () => {
    const names = codeLanguages.map((l) => l.name);
    const bloat = ["APL", "Brainfuck", "Cobol", "Fortran", "Haskell", "Perl"];

    for (const lang of bloat) {
      expect(names).not.toContain(lang);
    }
  });

  it("every entry has a load() function for lazy loading", () => {
    for (const lang of codeLanguages) {
      expect(typeof lang.load).toBe("function");
    }
  });
});

describe("codeLanguages — list integrity", () => {
  it("gives every language a non-empty name", () => {
    for (const lang of codeLanguages) {
      expect(lang.name.length).toBeGreaterThan(0);
    }
  });

  it("assigns a unique name to every language", () => {
    const names = codeLanguages.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("never reuses the same extension across two languages", () => {
    const seen = new Map<string, string>();
    for (const lang of codeLanguages) {
      for (const ext of lang.extensions) {
        expect(
          seen.has(ext),
          `extension .${ext} is claimed by both ${seen.get(ext)} and ${lang.name}`,
        ).toBe(false);
        seen.set(ext, lang.name);
      }
    }
  });

  it("gives every language either extensions or a filename matcher", () => {
    for (const lang of codeLanguages) {
      const hasExt = lang.extensions.length > 0;
      const hasFilename = lang.filename !== undefined;
      expect(hasExt || hasFilename).toBe(true);
    }
  });
});

describe("LanguageDescription.matchFilename", () => {
  const cases: Array<[string, string]> = [
    ["index.js", "JavaScript"],
    ["server.mjs", "JavaScript"],
    ["component.jsx", "JSX"],
    ["app.ts", "TypeScript"],
    ["module.mts", "TypeScript"],
    ["view.tsx", "TSX"],
    ["data.json", "JSON"],
    ["page.html", "HTML"],
    ["styles.css", "CSS"],
    ["main.rs", "Rust"],
    ["util.c", "C"],
    ["engine.cpp", "C++"],
    ["server.go", "Go"],
    ["App.java", "Java"],
    ["script.py", "Python"],
    ["config.yaml", "YAML"],
    ["config.yml", "YAML"],
    ["feed.xml", "XML"],
    ["query.sql", "SQL"],
    ["README.md", "Markdown"],
    ["build.sh", "Shell"],
    ["Cargo.toml", "TOML"],
  ];

  it.each(cases)("matches %s to the %s language", (filename, expected) => {
    const match = LanguageDescription.matchFilename(codeLanguages, filename);
    expect(match?.name).toBe(expected);
  });

  it("matches the Dockerfile filename pattern", () => {
    const match = LanguageDescription.matchFilename(
      codeLanguages,
      "Dockerfile",
    );
    expect(match?.name).toBe("Dockerfile");
  });

  it("matches the PKGBUILD filename pattern to Shell", () => {
    const match = LanguageDescription.matchFilename(codeLanguages, "PKGBUILD");
    expect(match?.name).toBe("Shell");
  });

  it("returns null for an unknown extension", () => {
    const match = LanguageDescription.matchFilename(
      codeLanguages,
      "mystery.zzz",
    );
    expect(match).toBeNull();
  });
});

describe("LanguageDescription.matchLanguageName", () => {
  const cases: Array<[string, string]> = [
    ["JavaScript", "JavaScript"],
    ["js", "JavaScript"],
    ["node", "JavaScript"],
    ["ts", "TypeScript"],
    ["py", "Python"],
    ["cpp", "C++"],
    ["bash", "Shell"],
    ["sh", "Shell"],
    ["yml", "YAML"],
  ];

  it.each(cases)("resolves the name/alias %s to %s", (name, expected) => {
    const match = LanguageDescription.matchLanguageName(codeLanguages, name);
    expect(match?.name).toBe(expected);
  });

  it("returns null for an unknown language name", () => {
    const match = LanguageDescription.matchLanguageName(
      codeLanguages,
      "cobol",
    );
    expect(match).toBeNull();
  });
});
