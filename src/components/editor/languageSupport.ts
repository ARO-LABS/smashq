/**
 * Trimmed language list for CodeMirror markdown code blocks.
 *
 * Replaces the full `@codemirror/language-data` export (~120 languages)
 * with only the ~20 languages relevant for this app's markdown editor.
 * Saves ~400-600 KB in the production build.
 *
 * Each language uses dynamic import() so chunks are only loaded when
 * a matching fenced code block is encountered.
 */
import {
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";

function legacy(
  parser: Parameters<typeof StreamLanguage.define>[0],
): LanguageSupport {
  return new LanguageSupport(StreamLanguage.define(parser));
}

/**
 * Curated list of ~20 languages for markdown code block highlighting.
 * Covers: web (JS/TS/HTML/CSS/JSON), systems (Rust, C/C++, Go, Python, Java),
 * config (YAML, TOML, XML, SQL), scripting (Shell/Bash), and containers (Dockerfile).
 */
export const codeLanguages: LanguageDescription[] = [
  // ── Web ────────────────────────────────────────────────────────────
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["ecmascript", "js", "node"],
    extensions: ["js", "mjs", "cjs"],
    load() {
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript(),
      );
    },
  }),
  LanguageDescription.of({
    name: "JSX",
    extensions: ["jsx"],
    load() {
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true }),
      );
    },
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts"],
    extensions: ["ts", "mts", "cts"],
    load() {
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ typescript: true }),
      );
    },
  }),
  LanguageDescription.of({
    name: "TSX",
    extensions: ["tsx"],
    load() {
      return import("@codemirror/lang-javascript").then((m) =>
        m.javascript({ jsx: true, typescript: true }),
      );
    },
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json5"],
    extensions: ["json", "map"],
    load() {
      return import("@codemirror/lang-json").then((m) => m.json());
    },
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["xhtml"],
    extensions: ["html", "htm", "handlebars", "hbs"],
    load() {
      return import("@codemirror/lang-html").then((m) => m.html());
    },
  }),
  LanguageDescription.of({
    name: "CSS",
    extensions: ["css"],
    load() {
      return import("@codemirror/lang-css").then((m) => m.css());
    },
  }),

  // ── Systems ────────────────────────────────────────────────────────
  LanguageDescription.of({
    name: "Rust",
    extensions: ["rs"],
    load() {
      return import("@codemirror/lang-rust").then((m) => m.rust());
    },
  }),
  LanguageDescription.of({
    name: "C",
    extensions: ["c", "h", "ino"],
    load() {
      return import("@codemirror/lang-cpp").then((m) => m.cpp());
    },
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp"],
    extensions: ["cpp", "c++", "cc", "cxx", "hpp", "h++", "hh", "hxx"],
    load() {
      return import("@codemirror/lang-cpp").then((m) => m.cpp());
    },
  }),
  LanguageDescription.of({
    name: "Go",
    extensions: ["go"],
    load() {
      return import("@codemirror/lang-go").then((m) => m.go());
    },
  }),
  LanguageDescription.of({
    name: "Java",
    extensions: ["java"],
    load() {
      return import("@codemirror/lang-java").then((m) => m.java());
    },
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    extensions: ["py", "pyi", "pyc", "pyd", "pyw"],
    load() {
      return import("@codemirror/lang-python").then((m) => m.python());
    },
  }),

  // ── Config / Data ──────────────────────────────────────────────────
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    extensions: ["yaml", "yml"],
    load() {
      return import("@codemirror/lang-yaml").then((m) => m.yaml());
    },
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["rss", "wsdl", "xsd"],
    extensions: ["xml", "xsl", "xsd", "svg"],
    load() {
      return import("@codemirror/lang-xml").then((m) => m.xml());
    },
  }),
  LanguageDescription.of({
    name: "SQL",
    extensions: ["sql"],
    load() {
      return import("@codemirror/lang-sql").then((m) => m.sql());
    },
  }),
  LanguageDescription.of({
    name: "Markdown",
    extensions: ["md", "markdown", "mkd"],
    load() {
      return import("@codemirror/lang-markdown").then((m) => m.markdown());
    },
  }),

  // ── Legacy modes (StreamLanguage) ──────────────────────────────────
  LanguageDescription.of({
    name: "Shell",
    alias: ["bash", "sh", "zsh"],
    extensions: ["sh", "ksh", "bash"],
    filename: /^PKGBUILD$/,
    load() {
      return import("@codemirror/legacy-modes/mode/shell").then((m) =>
        legacy(m.shell),
      );
    },
  }),
  LanguageDescription.of({
    name: "TOML",
    extensions: ["toml"],
    load() {
      return import("@codemirror/legacy-modes/mode/toml").then((m) =>
        legacy(m.toml),
      );
    },
  }),
  LanguageDescription.of({
    name: "Dockerfile",
    filename: /^Dockerfile$/,
    load() {
      return import("@codemirror/legacy-modes/mode/dockerfile").then((m) =>
        legacy(m.dockerFile),
      );
    },
  }),
];
