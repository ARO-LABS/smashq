import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsSection } from "./SettingsSection";
import { SettingsPanelHeader } from "./SettingsPanelHeader";

describe("SettingsSection", () => {
  it("rendert UPPERCASE-Titel und Kinder", () => {
    render(
      <SettingsSection title="Events">
        <p>Inhalt</p>
      </SettingsSection>,
    );
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });

  it("rendert optionalen headerAction-Slot", () => {
    render(
      <SettingsSection title="Voraussetzungen" headerAction={<button>Erneut prüfen</button>}>
        <p>x</p>
      </SettingsSection>,
    );
    expect(screen.getByRole("button", { name: "Erneut prüfen" })).toBeInTheDocument();
  });
});

describe("SettingsPanelHeader", () => {
  it("rendert Titel und Beschreibung", () => {
    render(<SettingsPanelHeader title="Darstellung" description="Theme-Modus und Animation." />);
    expect(screen.getByText("Darstellung")).toBeInTheDocument();
    expect(screen.getByText("Theme-Modus und Animation.")).toBeInTheDocument();
  });

  it("rendert optionalen titleAside-Slot", () => {
    render(
      <SettingsPanelHeader
        title="Über Smashq"
        description="App-Infos."
        titleAside={<span>v1.0.24</span>}
      />,
    );
    expect(screen.getByText("v1.0.24")).toBeInTheDocument();
  });
});
