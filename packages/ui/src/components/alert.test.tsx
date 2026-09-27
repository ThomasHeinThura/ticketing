import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Alert, AlertDescription, AlertTitle } from "./alert";

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
