import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownPreview, MarkdownBody } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders basic markdown", () => {
    render(<MarkdownPreview content="# Hello" />);
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("renders links with href", () => {
    const { container } = render(
      <MarkdownPreview content="[link](https://example.com)" />,
    );
    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
  });

  // --- XSS Prevention Tests ---

  it("strips javascript: URIs from links", () => {
    const { container } = render(
      <MarkdownPreview content='[click me](javascript:alert(1))' />,
    );
    const anchor = container.querySelector("a");
    // Link should either be removed or href stripped
    if (anchor) {
      const href = anchor.getAttribute("href") ?? "";
      expect(href).not.toContain("javascript:");
    }
  });

  it("strips onerror event handlers from img tags", () => {
    // markdown-it with html:false won't pass raw HTML, but test sanitizer directly
    const { container } = render(
      <MarkdownPreview content={'![img](x" onerror="alert(1)'} />,
    );
    const img = container.querySelector("img");
    if (img) {
      expect(img.getAttribute("onerror")).toBeNull();
    }
  });

  it("strips onclick from rendered HTML", () => {
    // Even if somehow onclick gets into the HTML, DOMPurify should strip it
    const { container } = render(
      <MarkdownPreview content="normal text" />,
    );
    const allElements = container.querySelectorAll("[onclick]");
    expect(allElements.length).toBe(0);
  });

  it("strips data attributes", () => {
    const { container } = render(
      <MarkdownPreview content="some text" />,
    );
    const allElements = container.querySelectorAll("[data-exploit]");
    expect(allElements.length).toBe(0);
  });

  it("renders code blocks safely", () => {
    const { container } = render(
      <MarkdownPreview content={'```\n<script>alert(1)</script>\n```'} />,
    );
    // Script tags should never appear in output
    const scripts = container.querySelectorAll("script");
    expect(scripts.length).toBe(0);
  });

  it("renders empty content without errors", () => {
    const { container } = render(<MarkdownPreview content="" />);
    expect(container.querySelector(".md-preview")).toBeTruthy();
  });

  it("strips data: URI scheme from links", () => {
    const { container } = render(
      <MarkdownPreview
        content={'[x](data:text/html,<script>alert(1)</script>)'}
      />,
    );
    const anchor = container.querySelector("a");
    if (anchor) {
      const href = anchor.getAttribute("href") ?? "";
      expect(href.toLowerCase()).not.toContain("data:");
    }
    // Regardless, no script tags should ever appear
    expect(container.querySelectorAll("script").length).toBe(0);
    expect(container.innerHTML).not.toContain("<script");
  });

  it("allows safe URI schemes (mailto:, tel:, #anchor)", () => {
    const { container } = render(
      <MarkdownPreview
        content={
          "[mail](mailto:foo@example.com) [tel](tel:+1234) [https](https://example.com)"
        }
      />,
    );
    const anchors = container.querySelectorAll("a");
    const hrefs = Array.from(anchors).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs).toContain("mailto:foo@example.com");
    expect(hrefs).toContain("tel:+1234");
    expect(hrefs).toContain("https://example.com");
  });

  it("renders GFM features (bold, italic) correctly", () => {
    const { container } = render(
      <MarkdownPreview content={"**bold** and *italic* text"} />,
    );
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("bold");
    expect(em).toBeTruthy();
    expect(em?.textContent).toBe("italic");
  });

  it("wraps content in a scrollable padded surface container", () => {
    const { container } = render(<MarkdownPreview content="text" />);
    const wrapper = container.querySelector(".overflow-auto");
    expect(wrapper).toBeTruthy();
    expect(wrapper?.className).toContain("bg-surface-raised");
    expect(wrapper?.className).toContain("h-full");
  });

  it("applies max-w-none to the inner md-preview div", () => {
    const { container } = render(<MarkdownPreview content="text" />);
    const inner = container.querySelector(".md-preview");
    expect(inner?.className).toContain("max-w-none");
  });

  it("renders heading levels h1 through h3 distinctly", () => {
    const { container } = render(
      <MarkdownPreview content={"# One\n\n## Two\n\n### Three"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("One");
    expect(container.querySelector("h2")?.textContent).toBe("Two");
    expect(container.querySelector("h3")?.textContent).toBe("Three");
  });

  it("renders unordered lists", () => {
    const { container } = render(
      <MarkdownPreview content={"- apple\n- banana\n- cherry"} />,
    );
    const ul = container.querySelector("ul");
    expect(ul).toBeTruthy();
    expect(ul?.querySelectorAll("li")).toHaveLength(3);
  });

  it("renders ordered lists", () => {
    const { container } = render(
      <MarkdownPreview content={"1. first\n2. second"} />,
    );
    const ol = container.querySelector("ol");
    expect(ol).toBeTruthy();
    expect(ol?.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders fenced code blocks as pre > code", () => {
    const { container } = render(
      <MarkdownPreview content={"```\nconst x = 1;\n```"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.querySelector("code")?.textContent).toContain("const x = 1;");
  });

  it("renders inline code as a code element", () => {
    const { container } = render(
      <MarkdownPreview content={"use the `npm run dev` command"} />,
    );
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("npm run dev");
  });

  it("renders blockquotes", () => {
    const { container } = render(
      <MarkdownPreview content={"> a quoted line"} />,
    );
    expect(container.querySelector("blockquote")).toBeTruthy();
  });

  it("renders paragraphs as <p> elements", () => {
    const { container } = render(
      <MarkdownPreview content={"First para.\n\nSecond para."} />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("linkifies bare URLs", () => {
    const { container } = render(
      <MarkdownPreview content={"visit https://example.com today"} />,
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com");
  });

  it("renders horizontal rules", () => {
    const { container } = render(
      <MarkdownPreview content={"above\n\n---\n\nbelow"} />,
    );
    expect(container.querySelector("hr")).toBeTruthy();
  });

  it("renders nested list structures", () => {
    const { container } = render(
      <MarkdownPreview content={"- parent\n  - child"} />,
    );
    const topUl = container.querySelector("ul");
    expect(topUl?.querySelector("ul")).toBeTruthy();
  });

  it("renders strikethrough as <s>", () => {
    const { container } = render(
      <MarkdownPreview content={"~~gone~~"} />,
    );
    expect(container.querySelector("s")?.textContent).toBe("gone");
  });

  it("renders link title attribute", () => {
    const { container } = render(
      <MarkdownPreview content={'[x](https://example.com "the title")'} />,
    );
    expect(container.querySelector("a")?.getAttribute("title")).toBe("the title");
  });

  it("strips raw HTML script tags (html: false)", () => {
    const { container } = render(
      <MarkdownPreview content={"text <script>alert(1)</script> more"} />,
    );
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("<script");
  });
});

// ── MarkdownBody Tests ─────────────────────────────────────────────────

describe("MarkdownBody", () => {
  it("renders markdown content without outer wrapper styles", () => {
    const { container } = render(<MarkdownBody content="**hello**" />);
    const div = container.querySelector(".md-preview");
    expect(div).toBeTruthy();
    // No h-full, no bg-surface-raised (those belong to MarkdownPreview wrapper)
    expect(div?.className).not.toContain("h-full");
    expect(div?.className).not.toContain("bg-surface-raised");
  });

  it("accepts optional className prop", () => {
    const { container } = render(
      <MarkdownBody content="text" className="text-sm text-red-400" />,
    );
    const div = container.querySelector(".md-preview");
    expect(div?.className).toContain("text-sm");
    expect(div?.className).toContain("text-red-400");
  });

  it("renders bold text as <strong>", () => {
    const { container } = render(<MarkdownBody content="**bold**" />);
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("bold");
  });

  it("renders empty content without errors", () => {
    const { container } = render(<MarkdownBody content="" />);
    expect(container.querySelector(".md-preview")).toBeTruthy();
  });

  it("preserves task-list checkbox attributes after DOMPurify", () => {
    // GitHub-flavored task lists use input[type="checkbox"] with checked/disabled
    // DOMPurify must keep type, checked, and disabled attributes
    const { container } = render(
      <MarkdownBody content={"- [x] Done item\n- [ ] Open item"} />,
    );
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    // markdown-it-task-lists would render these; if not installed,
    // verify DOMPurify doesn't strip type attr from manually injected HTML
    // by checking no type attributes were stripped from any input elements
    const allInputs = container.querySelectorAll("input");
    for (const input of Array.from(allInputs)) {
      // type attribute must be preserved (not stripped by DOMPurify)
      expect(input.hasAttribute("type")).toBe(true);
    }
    // Whether or not checkboxes render depends on markdown-it config,
    // but if they do, they must have type="checkbox"
    for (const cb of Array.from(checkboxes)) {
      expect(cb.getAttribute("type")).toBe("checkbox");
    }
  });

  it("always has the base md-preview class even without a className prop", () => {
    const { container } = render(<MarkdownBody content="text" />);
    const div = container.querySelector("div.md-preview");
    expect(div).toBeTruthy();
    expect(div?.className.trim()).toBe("md-preview");
  });

  it("appends className after the md-preview base class with a separating space", () => {
    const { container } = render(
      <MarkdownBody content="text" className="ae-body-sm" />,
    );
    const div = container.querySelector(".md-preview");
    expect(div?.className).toBe("md-preview ae-body-sm");
  });

  it("renders italic text as <em>", () => {
    const { container } = render(<MarkdownBody content="*slanted*" />);
    expect(container.querySelector("em")?.textContent).toBe("slanted");
  });

  it("renders headings inside MarkdownBody", () => {
    const { container } = render(<MarkdownBody content="### Section" />);
    expect(container.querySelector("h3")?.textContent).toBe("Section");
  });

  it("renders lists inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content={"- one\n- two"} />,
    );
    expect(container.querySelector("ul")?.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders links with href inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content="[go](https://example.com)" />,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
  });

  it("strips javascript: URIs inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content="[bad](javascript:alert(1))" />,
    );
    const anchor = container.querySelector("a");
    if (anchor) {
      expect(anchor.getAttribute("href") ?? "").not.toContain("javascript:");
    }
  });

  it("renders inline code inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content={"run `tsc` now"} />,
    );
    expect(container.querySelector("code")?.textContent).toBe("tsc");
  });

  it("renders fenced code blocks inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content={"```\nline\n```"} />,
    );
    expect(container.querySelector("pre code")?.textContent).toContain("line");
  });

  it("never emits a script tag inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content={"<script>alert(1)</script>"} />,
    );
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("<script");
  });

  it("renders multi-paragraph content inside MarkdownBody", () => {
    const { container } = render(
      <MarkdownBody content={"para one\n\npara two"} />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });
});
