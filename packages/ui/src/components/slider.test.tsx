import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Slider } from "./slider";

afterEach(() => {
  cleanup();
});

// jsdom has no layout engine, so Base UI's slider thumb positions itself via
// getBoundingClientRect and stays `visibility: hidden` until it can measure — real
// browsers make it visible immediately. `hidden: true` is required so
// testing-library's accessibility-tree filter still returns the (real, functional)
// input under jsdom.
describe("Slider", () => {
  it("renders a slider thumb with the given value", () => {
    render(<Slider defaultValue={40} />);
    const slider = screen.getByRole("slider", { hidden: true });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute("aria-valuenow", "40");
  });

  it("defaults to min when no value is given", () => {
    render(<Slider min={0} max={100} />);
    expect(screen.getByRole("slider", { hidden: true })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});
