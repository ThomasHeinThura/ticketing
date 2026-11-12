import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InboxIcon } from "lucide-react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";
import { EmptyState, ErrorState, FeatureOff, NoAccess } from "./empty-state";

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

  it("renders the title as a level-2 heading by default, sitting under the page's h1", () => {
    render(<EmptyState title="Inbox zero" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Inbox zero" }),
    ).toHaveAttribute("data-slot", "empty-title");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("takes the heading level from headingLevel", () => {
    render(<EmptyState headingLevel={3} title="Nothing here" />);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Nothing here",
    );
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
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

  it("renders an onClick action as a button that runs the handler", () => {
    const onClick = vi.fn();
    render(
      <FeatureOff
        title="Reports are off"
        description="Turn it on."
        action={{ label: "Turn on", onClick }}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows an optional secondary action beside the primary one", () => {
    const onBack = vi.fn();
    const { container } = render(
      <FeatureOff
        title="Reports are off"
        description="Turn it on."
        action={{
          label: "Turn on in Features",
          render: (
            <SettingsLink href="/dashboard/settings/workspace/features" />
          ),
        }}
        secondaryAction={{ label: "Back", onClick: onBack }}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Turn on in Features" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(
      container.querySelectorAll(
        "[data-slot=empty-content] a, [data-slot=empty-content] button",
      ),
    ).toHaveLength(2);
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

describe("NoAccess", () => {
  it("shows a decorative lock, what happened and whom to ask", () => {
    const { container } = render(
      <NoAccess
        title="You don't have access"
        description="Ask a workspace admin."
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "You don't have access" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ask a workspace admin.")).toBeInTheDocument();
    const media = container.querySelector("[data-slot=empty-media]");
    expect(media).toHaveAttribute("aria-hidden", "true");
    expect(media?.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("[data-state=no-access]")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a Back action as a button or a link", () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <NoAccess
        title="You don't have access"
        action={{ label: "Back", onClick: onBack }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(
      <NoAccess
        title="You don't have access"
        action={{ label: "Back", render: <SettingsLink href="/agent" /> }}
      />,
    );
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/agent",
    );
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <NoAccess
        title="You don't have access"
        description="Ask a workspace admin."
        action={{ label: "Back", onClick: () => undefined }}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});

describe("ErrorState", () => {
  it("is announced as an alert, with the title as a heading and a Retry button", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ErrorState
        title="This did not load"
        description="Try again in a moment."
        retryLabel="Retry"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toBe(
      container.querySelector("[data-state=error]"),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "This did not load" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps the retry icon decorative and shows an optional secondary action", () => {
    const onBack = vi.fn();
    render(
      <ErrorState
        title="This did not load"
        retryLabel="Retry"
        onRetry={() => undefined}
        secondaryAction={{ label: "Back", onClick: onBack }}
      />,
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <ErrorState
        title="This did not load"
        description="Try again in a moment."
        retryLabel="Retry"
        onRetry={() => undefined}
        secondaryAction={{ label: "Back", onClick: () => undefined }}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});
