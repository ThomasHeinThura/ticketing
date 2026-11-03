import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";

afterEach(() => {
  cleanup();
});

describe("Alert", () => {
  it("renders as a role=alert region with its title and description", () => {
    render(
      <Alert variant="error">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>Please try again.</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("Please try again.");
  });

  // A-24: below `sm` an alert with an action stacks title, description and action in one column;
  // the action column on the right applies only from `sm`. (jsdom has no layout, so the classes
  // are the contract; the e2e spec checks the real boxes.)
  it("puts the action in its own column only from sm", () => {
    render(
      <Alert variant="info">
        <AlertTitle>Welcome</AlertTitle>
        <AlertDescription>Raise a request from the catalogue.</AlertDescription>
        <AlertAction>Got it</AlertAction>
      </Alert>,
    );

    const alert = screen.getByRole("alert");
    const classes = alert.className.split(/\s+/);
    expect(classes).toContain(
      "sm:has-data-[slot=alert-action]:grid-cols-[1fr_auto]",
    );
    expect(classes).toContain(
      "sm:has-[>svg]:has-data-[slot=alert-action]:grid-cols-[calc(var(--spacing)*4)_1fr_auto]",
    );
    expect(
      classes.filter(
        (name) =>
          name.includes("has-data-[slot=alert-action]:grid-cols") &&
          !name.startsWith("sm:"),
      ),
    ).toEqual([]);

    const action = screen.getByText("Got it");
    const actionClasses = action.className.split(/\s+/);
    // Below sm the action moves to the text column only beside an icon; without one it stays in
    // the single column instead of opening a second.
    expect(actionClasses).toContain("max-sm:[svg~&]:col-start-2");
    expect(actionClasses).not.toContain("max-sm:col-start-2");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <Alert variant="warning">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Your session expires soon.</AlertDescription>
      </Alert>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
