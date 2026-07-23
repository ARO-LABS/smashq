import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewSessionDefaultsSection } from "./NewSessionDefaultsSection";
import { useSettingsStore } from "../../../store/settingsStore";

const openMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

const invokeMock = vi.fn();
vi.mock("../../../utils/perfLogger", () => ({
  wrapInvoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("NewSessionDefaultsSection", () => {
  beforeEach(() => {
    openMock.mockReset();
    useSettingsStore.setState({
      defaultShell: "auto",
      defaultProjectPath: "",
      defaultPermissionMode: "default",
    });
  });

  it("persists the shell selection when changed", () => {
    render(<NewSessionDefaultsSection />);
    const select = screen.getByLabelText(/Standard-Shell/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "powershell" } });
    expect(useSettingsStore.getState().defaultShell).toBe("powershell");
  });

  it("writes the picked folder to defaultProjectPath", async () => {
    openMock.mockResolvedValue("C:/work/repo");
    render(<NewSessionDefaultsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Wählen/i }));
    await waitFor(() => {
      expect(useSettingsStore.getState().defaultProjectPath).toBe("C:/work/repo");
    });
  });

  it("does nothing when the picker is cancelled", async () => {
    openMock.mockResolvedValue(null);
    render(<NewSessionDefaultsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Wählen/i }));
    await waitFor(() => {
      expect(openMock).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().defaultProjectPath).toBe("");
  });

  it("offers a Leeren button when a default is set", () => {
    useSettingsStore.setState({ defaultProjectPath: "C:/old/path" });
    render(<NewSessionDefaultsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Leeren/i }));
    expect(useSettingsStore.getState().defaultProjectPath).toBe("");
  });

  it("renders the static fallback options outside Tauri", () => {
    render(<NewSessionDefaultsSection />);
    const select = screen.getByLabelText(/Standard-Shell/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["auto", "powershell", "cmd", "bash", "zsh"]);
    // Ohne detect_shells-Antwort darf der Nur-gefundene-Shells-Hinweis fehlen.
    expect(screen.queryByText(/nur Shells, die auf diesem Gerät/i)).toBeNull();
  });

  describe("shell detection (in Tauri)", () => {
    beforeEach(() => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    });

    afterEach(() => {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });

    it("shows only detected shells plus auto", async () => {
      invokeMock.mockResolvedValue([
        { id: "powershell", label: "PowerShell" },
        { id: "zsh", label: "Zsh" },
      ]);
      render(<NewSessionDefaultsSection />);
      const select = screen.getByLabelText(/Standard-Shell/i) as HTMLSelectElement;
      await waitFor(() => {
        expect(Array.from(select.options).map((o) => o.value)).toEqual([
          "auto",
          "powershell",
          "zsh",
        ]);
      });
      expect(invokeMock).toHaveBeenCalledWith("detect_shells");
      expect(screen.getByText(/nur Shells, die auf diesem Gerät/i)).toBeTruthy();
    });

    it("keeps a stored shell visible with a 'nicht gefunden' marker", async () => {
      useSettingsStore.setState({ defaultShell: "bash" });
      invokeMock.mockResolvedValue([{ id: "powershell", label: "PowerShell" }]);
      render(<NewSessionDefaultsSection />);
      await waitFor(() => {
        expect(screen.getByText("Bash (nicht gefunden)")).toBeTruthy();
      });
      const select = screen.getByLabelText(/Standard-Shell/i) as HTMLSelectElement;
      expect(select.value).toBe("bash");
    });

    it("falls back to the static list when detect_shells fails", async () => {
      invokeMock.mockRejectedValue(new Error("command not found"));
      render(<NewSessionDefaultsSection />);
      const select = screen.getByLabelText(/Standard-Shell/i) as HTMLSelectElement;
      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalled();
      });
      expect(Array.from(select.options).map((o) => o.value)).toEqual([
        "auto",
        "powershell",
        "cmd",
        "bash",
        "zsh",
      ]);
    });
  });

  it("reflects the stored shell value in the select", () => {
    useSettingsStore.setState({ defaultShell: "zsh" });
    render(<NewSessionDefaultsSection />);
    const select = screen.getByLabelText(/Standard-Shell/i) as HTMLSelectElement;
    expect(select.value).toBe("zsh");
  });

  it("shows placeholder text when no default path is set", () => {
    render(<NewSessionDefaultsSection />);
    expect(screen.getByText("Kein Ordner gesetzt")).toBeTruthy();
  });

  it("shows the hint paragraph when no default path is set", () => {
    render(<NewSessionDefaultsSection />);
    expect(
      screen.getByText(/Ohne Default öffnet der Button beim ersten Klick/i),
    ).toBeTruthy();
  });

  it("shows Leeren button and hides hint when a default path is set", () => {
    useSettingsStore.setState({ defaultProjectPath: "C:/work/repo" });
    render(<NewSessionDefaultsSection />);
    expect(screen.getByRole("button", { name: /Leeren/i })).toBeTruthy();
    expect(screen.queryByText(/Ohne Default öffnet der Button/i)).toBeNull();
  });

  it("displays the configured default path", () => {
    useSettingsStore.setState({ defaultProjectPath: "C:/projects/myapp" });
    render(<NewSessionDefaultsSection />);
    expect(screen.getByText("C:/projects/myapp")).toBeTruthy();
  });

  it("passes directory:true to the folder picker", async () => {
    openMock.mockResolvedValue("C:/some/dir");
    render(<NewSessionDefaultsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Wählen/i }));
    await waitFor(() => {
      expect(openMock).toHaveBeenCalledWith(
        expect.objectContaining({ directory: true, multiple: false }),
      );
    });
  });

  it("ignores a non-string picker result", async () => {
    openMock.mockResolvedValue(["C:/a", "C:/b"]);
    render(<NewSessionDefaultsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Wählen/i }));
    await waitFor(() => {
      expect(openMock).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().defaultProjectPath).toBe("");
  });

  it("does not crash when the picker rejects", async () => {
    openMock.mockRejectedValue(new Error("dialog failed"));
    render(<NewSessionDefaultsSection />);
    fireEvent.click(screen.getByRole("button", { name: /Wählen/i }));
    await waitFor(() => {
      expect(openMock).toHaveBeenCalled();
    });
    expect(useSettingsStore.getState().defaultProjectPath).toBe("");
  });

  it("re-enables the Wählen button after a successful pick", async () => {
    openMock.mockResolvedValue("C:/done");
    render(<NewSessionDefaultsSection />);
    const btn = screen.getByRole("button", { name: /Wählen/i }) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => {
      expect(useSettingsStore.getState().defaultProjectPath).toBe("C:/done");
    });
    expect(btn.disabled).toBe(false);
  });

  it("renders the four permission modes and persists a selection", () => {
    render(<NewSessionDefaultsSection />);
    const select = screen.getByLabelText(/Permission-Modus/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "default",
      "auto",
      "plan",
      "bypass",
    ]);
    fireEvent.change(select, { target: { value: "bypass" } });
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("bypass");
  });

  it("shows the hint of the active permission mode", () => {
    useSettingsStore.setState({ defaultPermissionMode: "bypass" });
    render(<NewSessionDefaultsSection />);
    expect(screen.getByText(/Überspringt alle Nachfragen/i)).toBeTruthy();
  });
});
