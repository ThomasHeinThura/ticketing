import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "./input-group";

afterEach(() => {
  cleanup();
});

describe("InputGroup", () => {
  it("renders an unstyled input alongside an addon and forwards typing", () => {
    let value = "";
    render(
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Amount"
          onChange={(event) => {
            value = event.target.value;
          }}
        />
      </InputGroup>,
    );

    expect(screen.getByText("$")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Amount" });
    expect(input).not.toHaveClass("border-input");

    fireEvent.change(input, { target: { value: "42" } });
    expect(value).toBe("42");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput aria-label="Amount" />
      </InputGroup>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
