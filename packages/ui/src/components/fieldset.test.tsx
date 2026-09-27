import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { Field, FieldControl, FieldLabel } from "./field";
import { Fieldset, FieldsetLegend } from "./fieldset";

afterEach(() => {
  cleanup();
});

describe("Fieldset", () => {
  it("groups its legend with the related controls", () => {
    render(
      <Fieldset>
        <FieldsetLegend>Notifications</FieldsetLegend>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldControl placeholder="you@example.com" type="email" />
        </Field>
      </Fieldset>,
    );

    expect(
      screen.getByRole("group", { name: "Notifications" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Email" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Fieldset>
        <FieldsetLegend>Notifications</FieldsetLegend>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <FieldControl placeholder="you@example.com" type="email" />
        </Field>
      </Fieldset>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
