import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Radio, RadioGroup } from "./radio-group";

afterEach(() => {
  cleanup();
});

describe("RadioGroup", () => {
  it("renders radio options and selects one at a time", () => {
    render(
      <RadioGroup aria-label="Plan" defaultValue="free">
        <Radio aria-label="Free" value="free" />
        <Radio aria-label="Pro" value="pro" />
      </RadioGroup>,
    );

    const free = screen.getByRole("radio", { name: "Free" });
    const pro = screen.getByRole("radio", { name: "Pro" });
    expect(free).toHaveAttribute("aria-checked", "true");
    expect(pro).toHaveAttribute("aria-checked", "false");

    fireEvent.click(pro);
    expect(pro).toHaveAttribute("aria-checked", "true");
    expect(free).toHaveAttribute("aria-checked", "false");
  });
});
