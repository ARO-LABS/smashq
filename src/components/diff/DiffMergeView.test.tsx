import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { DiffMergeView } from "./DiffMergeView";
import type { DiffFile } from "./types";

function makeFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path: "src/foo.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    oldContent: "const a = 1;\n",
    newContent: "const a = 2;\n",
    oversize: false,
    ...overrides,
  };
}

describe("DiffMergeView", () => {
  it("renders the merge container with both contents for a normal file", async () => {
    const { getByTestId, container } = render(
      <DiffMergeView file={makeFile()} mode="side" />,
    );
    const mount = getByTestId("diff-merge-container");
    // CodeMirror builds its DOM inside the container — assert that *something*
    // landed there rather than asserting on internal class names that may
    // change between versions.
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
    // Header shows the path.
    expect(container.textContent).toContain("src/foo.ts");
  });

  it("renders an oversize banner instead of CodeMirror when oversize=true", async () => {
    const { getByTestId } = render(
      <DiffMergeView
        file={makeFile({ oversize: true, oldContent: undefined, newContent: undefined })}
        mode="side"
      />,
    );
    const mount = getByTestId("diff-merge-container");
    await waitFor(() => {
      expect(mount.textContent).toMatch(/Performance-Budget/);
    });
  });

  it("renders the inline (unified) merge view when mode=inline", async () => {
    const { getByTestId } = render(
      <DiffMergeView file={makeFile()} mode="inline" />,
    );
    const mount = getByTestId("diff-merge-container");
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
    // Inline view shows the new content; old content survives only as markers.
    expect(mount.textContent).toContain("const a = 2;");
  });

  it("shows the additions/deletions counts in the header", () => {
    const { container } = render(
      <DiffMergeView file={makeFile({ additions: 12, deletions: 5 })} mode="side" />,
    );
    expect(container.textContent).toContain("+12");
    expect(container.textContent).toContain("-5");
  });

  it("rebuilds the merge view when mode switches from side to inline", async () => {
    const file = makeFile();
    const { getByTestId, rerender } = render(
      <DiffMergeView file={file} mode="side" />,
    );
    const mount = getByTestId("diff-merge-container");
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
    rerender(<DiffMergeView file={file} mode="inline" />);
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
    // After a mode switch the container still has CodeMirror DOM (not stale/empty).
    expect(mount.textContent).toContain("const a = 2;");
  });

  it("treats missing oldContent/newContent as empty strings without crashing", async () => {
    const { getByTestId } = render(
      <DiffMergeView
        file={makeFile({ oldContent: undefined, newContent: undefined, oversize: false })}
        mode="side"
      />,
    );
    const mount = getByTestId("diff-merge-container");
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
  });

  it("renders plain text (no language support) for an unknown file extension", async () => {
    const { getByTestId, container } = render(
      <DiffMergeView
        file={makeFile({ path: "notes.unknownext" })}
        mode="side"
      />,
    );
    const mount = getByTestId("diff-merge-container");
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
    expect(container.textContent).toContain("notes.unknownext");
  });

  it("re-renders the container when the file prop changes", async () => {
    const { getByTestId, container, rerender } = render(
      <DiffMergeView file={makeFile()} mode="side" />,
    );
    const mount = getByTestId("diff-merge-container");
    await waitFor(() => {
      expect(mount.childElementCount).toBeGreaterThan(0);
    });
    rerender(
      <DiffMergeView
        file={makeFile({ path: "src/bar.ts", newContent: "let z = 9;\n" })}
        mode="side"
      />,
    );
    await waitFor(() => {
      expect(container.textContent).toContain("src/bar.ts");
    });
  });
});
