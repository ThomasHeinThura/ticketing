import { cleanup, render, screen } from "@testing-library/react";
import { InboxIcon } from "lucide-react";
import type * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";
import { EmptyState, FeatureOff } from "./empty-state";

/** A plain link element for the action's `render`; the button supplies its text. */
function SettingsLink(props: React.ComponentProps<"a">) {
  return <a {...props} />;
}

afterEach(() => {
  cleanup();
});

describe("EmptyState", () => {
  it("renders the icon, title, description and action", () => {
    const { container } = render(
      <EmptyState
        icon={<InboxIcon />}
        title="Inbox zero"
        description="There is nothing waiting on you."
        action={<Button render={<a href="/agent/my-work" />}>My work</Button>}
      />,
    );
    expect(screen.getByText("Inbox zero")).toBeInTheDocument();
    expect(
      screen.getByText("There is nothing waiting on you."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My work" })).toHaveAttribute(
      "href",
      "/agent/my-work",
    );
    const media = container.querySelector("[data-slot=empty-media]");
    expect(media).toHaveAttribute("data-variant", "icon");
    expect(media).toHaveAttribute("aria-hidden", "true");
  });

  it("leaves out the icon, description and action when not given", () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelector("[data-slot=empty-media]")).toBeNull();
    expect(container.querySelector("[data-slot=empty-description]")).toBeNull();
    expect(container.querySelector("[data-slot=empty-content]")).toBeNull();
  });

  it("passes props such as a test id to the root", () => {
    render(<EmptyState data-testid="list-empty" title="Nothing here" />);
    expect(screen.getByTestId("list-empty")).toHaveAttribute(
      "data-slot",
      "empty",
    );
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <EmptyState
        icon={<InboxIcon />}
        title="Inbox zero"
        description="There is nothing waiting on you."
        action={<Button render={<a href="/agent/my-work" />}>My work</Button>}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});

describe("FeatureOff", () => {
  it("shows a decorative default icon, the title and one line of copy", () => {
    const { container } = render(
      <FeatureOff
        title="Reports are off"
        description="Turn on Reports in workspace feature settings."
      />,
    );
    expect(screen.getByText("Reports are off")).toBeInTheDocument();
    expect(
      screen.getByText("Turn on Reports in workspace feature settings."),
    ).toBeInTheDocument();
    const media = container.querySelector("[data-slot=empty-media]");
    expect(media).toHaveAttribute("aria-hidden", "true");
    expect(media?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-feature-off]")).not.toBeNull();
  });

  it("renders the action as a real link only when the caller passes one", () => {
    const { rerender } = render(
      <FeatureOff title="Reports are off" description="Ask an admin." />,
    );
    expect(screen.queryByRole("link")).toBeNull();

    rerender(
      <FeatureOff
        title="Reports are off"
        description="Turn it on."
        action={{
          label: "Turn on in Features",
          render: (
            <SettingsLink href="/dashboard/settings/workspace/features" />
          ),
        }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Turn on in Features" }),
    ).toHaveAttribute("href", "/dashboard/settings/workspace/features");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <FeatureOff
        title="Reports are off"
        description="Turn it on."
        action={{
          label: "Turn on in Features",
          render: (
            <SettingsLink href="/dashboard/settings/workspace/features" />
          ),
        }}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});
