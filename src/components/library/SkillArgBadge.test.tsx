import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillArgBadge } from "./SkillArgBadge";

type SkillArg = { name: string; description: string; required: boolean };

const arg = (over: Partial<SkillArg> = {}): SkillArg => ({
  name: "scope",
  description: "",
  required: false,
  ...over,
});

describe("SkillArgBadge", () => {
  it("renders the argument name", () => {
    render(<SkillArgBadge arg={arg({ name: "target" })} />);
    expect(screen.getByText("target")).toBeTruthy();
  });

  it("appends an asterisk for a required argument", () => {
    render(<SkillArgBadge arg={arg({ name: "path", required: true })} />);
    expect(screen.getByText("path*")).toBeTruthy();
  });

  it("does not append an asterisk for an optional argument", () => {
    render(<SkillArgBadge arg={arg({ name: "flag", required: false })} />);
    expect(screen.getByText("flag")).toBeTruthy();
  });

  it("uses warning styling for a required argument", () => {
    const { container } = render(
      <SkillArgBadge arg={arg({ required: true })} />,
    );
    expect(container.querySelector(".text-warning")).toBeTruthy();
  });

  it("uses neutral styling for an optional argument", () => {
    const { container } = render(
      <SkillArgBadge arg={arg({ required: false })} />,
    );
    expect(container.querySelector(".text-neutral-500")).toBeTruthy();
  });

  it("exposes the description as the title attribute", () => {
    render(
      <SkillArgBadge arg={arg({ name: "x", description: "the X arg" })} />,
    );
    expect(screen.getByText("x").getAttribute("title")).toBe("the X arg");
  });

  it("omits the title attribute when there is no description", () => {
    render(<SkillArgBadge arg={arg({ name: "y", description: "" })} />);
    expect(screen.getByText("y").getAttribute("title")).toBeNull();
  });
});
