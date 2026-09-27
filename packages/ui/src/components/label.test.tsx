import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { Label } from "./label";

afterEach(() => {
  cleanup();
});

describe("Label", () => {
  it("associates with a control via htmlFor", () => {
    render(
      <div>
        <Label htmlFor="email">Email address</Label>
        <input id="email" type="email" />
      </div>,
    );

    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <div>
        <Label htmlFor="email">Email address</Label>
        <input id="email" type="email" />
      </div>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
