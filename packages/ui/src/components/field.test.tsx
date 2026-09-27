import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "./field";

afterEach(() => {
  cleanup();
});

describe("Field", () => {
  it("associates the label, control and description", () => {
    render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl placeholder="you@example.com" type="email" />
        <FieldDescription>We only use this to send receipts.</FieldDescription>
      </Field>,
    );

    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
    expect(
      screen.getByText("We only use this to send receipts."),
    ).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <FieldControl placeholder="you@example.com" type="email" />
        <FieldError match={true}>Enter a valid email address.</FieldError>
      </Field>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
