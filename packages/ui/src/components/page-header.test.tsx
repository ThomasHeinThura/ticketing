import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Button } from "./button";
import { PageContainer, PageHeader } from "./page-header";

afterEach(() => {
  cleanup();
});

describe("PageHeader", () => {
  it("renders the title as the page's only level-1 heading", () => {
    render(<PageHeader title="Inbox" />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Inbox");
  });

  it("renders the description, actions and tabs slots only when given", () => {
    const { rerender, container } = render(<PageHeader title="Services" />);
    expect(
      container.querySelector("[data-slot=page-header-description]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-slot=page-header-actions]"),
    ).toBeNull();
    expect(container.querySelector("[data-slot=page-header-tabs]")).toBeNull();

    rerender(
      <PageHeader
        title="Services"
        description="Every service and its status."
        actions={<Button>New service</Button>}
        tabs={<nav aria-label="Sections">Tabs</nav>}
      />,
    );
    expect(
      screen.getByText("Every service and its status."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New service" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  it("uses the shared settings title size", () => {
    render(<PageHeader title="General" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "font-semibold",
      "text-2xl",
    );
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <PageHeader
        title="Services"
        description="Every service and its status."
        actions={<Button>New service</Button>}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});

describe("PageContainer", () => {
  it("uses the full width with the shared gutter by default", () => {
    render(<PageContainer data-testid="page">Body</PageContainer>);
    const page = screen.getByTestId("page");
    expect(page).toHaveAttribute("data-variant", "full");
    expect(page).toHaveClass("p-6", "gap-6", "w-full");
    expect(page).not.toHaveClass("max-w-3xl");
  });

  it("narrows reading and form pages to max-w-3xl, centred", () => {
    render(
      <PageContainer data-testid="page" variant="narrow">
        Body
      </PageContainer>,
    );
    const page = screen.getByTestId("page");
    expect(page).toHaveAttribute("data-variant", "narrow");
    expect(page).toHaveClass("max-w-3xl", "mx-auto", "p-6");
  });

  it("merges a caller class", () => {
    render(
      <PageContainer data-testid="page" className="h-full overflow-y-auto">
        Body
      </PageContainer>,
    );
    expect(screen.getByTestId("page")).toHaveClass("h-full", "overflow-y-auto");
  });
});
