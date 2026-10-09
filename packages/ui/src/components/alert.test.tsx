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

  it("preserves named variant classes and keeps the base foreground for a null variant", () => {
    const shared =
      "relative grid w-full items-start gap-x-2 gap-y-0.5 rounded-xl border px-3.5 py-3 text-sm has-[>svg]:has-data-[slot=alert-action]:grid-cols-[calc(var(--spacing)*4)_1fr_auto] has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-data-[slot=alert-action]:grid-cols-[1fr_auto] has-[>svg]:gap-x-2 [&>svg]:h-lh [&>svg]:w-4";
    const namedClasses = {
      default: `${shared} text-card-foreground bg-transparent dark:bg-input/32 [&>svg]:text-muted-foreground`,
      error: `${shared} text-card-foreground border-destructive/32 bg-destructive/4 [&>svg]:text-destructive`,
      info: `${shared} text-card-foreground border-info/32 bg-info/4 [&>svg]:text-info`,
      success: `${shared} text-card-foreground border-success/32 bg-success/4 [&>svg]:text-success`,
      warning: `${shared} text-card-foreground border-warning/32 bg-warning/4 [&>svg]:text-warning`,
    } as const;

    for (const [variant, expectedClass] of Object.entries(namedClasses)) {
      const { unmount } = render(
        <Alert variant={variant as keyof typeof namedClasses} />,
      );
      expect(screen.getByRole("alert").className).toBe(expectedClass);
      unmount();
    }

    render(<Alert variant={null} />);
    const nullVariant = screen.getByRole("alert");
    expect(nullVariant.className).toBe(
      shared.replace("text-sm", "text-card-foreground text-sm"),
    );
    expect(nullVariant.className).not.toMatch(
      /\bbg-(?:transparent|destructive|info|success|warning)\b/u,
    );
    cleanup();

    render(<Alert variant={null} className="text-destructive" />);
    expect(screen.getByRole("alert").className.split(/\s+/u)).toContain(
      "text-destructive",
    );
    expect(screen.getByRole("alert").className.split(/\s+/u)).not.toContain(
      "text-card-foreground",
    );
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
