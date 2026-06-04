import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LoadingSpinner } from "./LoadingSpinner";

describe("LoadingSpinner", () => {
  it("renders with default md size and blue color", () => {
    const { container } = render(<LoadingSpinner />);
    const spinner = container.querySelector(".w-8");
    expect(spinner).toBeTruthy();
    expect(spinner?.className).toContain("border-accent");
    expect(spinner?.className).toContain("neon-spin-animation");
  });

  it("renders small spinner", () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    const spinner = container.querySelector(".w-5");
    expect(spinner).toBeTruthy();
  });

  it("renders large spinner", () => {
    const { container } = render(<LoadingSpinner size="lg" />);
    const spinner = container.querySelector(".w-12");
    expect(spinner).toBeTruthy();
  });

  it("renders green color variant", () => {
    const { container } = render(<LoadingSpinner color="green" />);
    const spinner = container.querySelector(".border-success");
    expect(spinner).toBeTruthy();
  });

  it("renders purple color variant", () => {
    const { container } = render(<LoadingSpinner color="purple" />);
    const spinner = container.querySelector(".border-info");
    expect(spinner).toBeTruthy();
  });

  it("applies box-shadow glow style", () => {
    const { container } = render(<LoadingSpinner color="blue" />);
    const spinner = container.querySelector(".neon-spin-animation") as HTMLElement;
    expect(spinner?.style.boxShadow).toContain("0 0 8px");
  });

  it("has transparent top border for spinning effect", () => {
    const { container } = render(<LoadingSpinner />);
    const spinner = container.querySelector(".border-t-transparent");
    expect(spinner).toBeTruthy();
  });

  it("is centered in its container", () => {
    const { container } = render(<LoadingSpinner />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper?.className).toContain("flex");
    expect(wrapper?.className).toContain("items-center");
    expect(wrapper?.className).toContain("justify-center");
  });
});
