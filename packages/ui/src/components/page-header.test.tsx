import { cleanup, render, screen, within } from "@testing-library/react";
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

  it("renders a nested screen's title as a level-2 heading with no h1", () => {
    render(<PageHeader headingLevel={2} title="Checklist" />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Checklist",
    );
  });

  it("puts titleId on the heading so a region can be labelled by it", () => {
    render(
      <section aria-labelledby="services-title">
        <PageHeader title="Services" titleId="services-title" />
      </section>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
      "id",
      "services-title",
    );
    expect(
      screen.getByRole("region", { name: "Services" }),
    ).toBeInTheDocument();
  });

  it("lets a long unbroken title wrap instead of overflowing a narrow screen", () => {
    render(<PageHeader title={"A".repeat(120)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass(
      "break-words",
    );
  });

  it("shows the breadcrumbs or back link above the title, only when given", () => {
    const { container, rerender } = render(<PageHeader title="Release 1.4" />);
    expect(
      container.querySelector("[data-slot=page-header-breadcrumbs]"),
    ).toBeNull();

    rerender(
      <PageHeader
        title="Release 1.4"
        breadcrumbs={
          <nav aria-label="Breadcrumb">
            <a href="/releases">Releases</a>
          </nav>
        }
      />,
    );
    const slot = container.querySelector(
      "[data-slot=page-header-breadcrumbs]",
    ) as HTMLElement;
    expect(
      within(slot).getByRole("link", { name: "Releases" }),
    ).toHaveAttribute("href", "/releases");
    expect(
      slot.compareDocumentPosition(screen.getByRole("heading", { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("has no accessibility violations with breadcrumbs, tabs and a nested heading", async () => {
    const { baseElement } = render(
      <PageHeader
        headingLevel={2}
        title="Checklist"
        titleId="checklist-title"
        breadcrumbs={
          <nav aria-label="Breadcrumb">
            <a href="/releases">Releases</a>
          </nav>
        }
        tabs={<nav aria-label="Sections">Tabs</nav>}
      />,
    );
    await expectNoA11yViolations(baseElement);
  });
});

describe("PageContainer", () => {
  it("uses the full width with the shared gutter by default", () => {
    render(
      <PageContainer data-testid="page" scroll={false}>
        Body
      </PageContainer>,
    );
    const page = screen.getByTestId("page");
    expect(page).toHaveAttribute("data-width", "full");
    expect(page).toHaveClass("p-6", "gap-6", "w-full");
    expect(page).not.toHaveClass("mx-auto");
    expect(page.className).not.toMatch(/max-w-/);
  });

  it.each([
    ["3xl", "max-w-3xl"],
    ["4xl", "max-w-4xl"],
    ["5xl", "max-w-5xl"],
    ["6xl", "max-w-6xl"],
  ] as const)("caps the %s width at %s, centred", (width, maxWidth) => {
    render(
      <PageContainer data-testid="page" scroll={false} width={width}>
        Body
      </PageContainer>,
    );
    const page = screen.getByTestId("page");
    expect(page).toHaveAttribute("data-width", width);
    expect(page).toHaveClass(maxWidth, "mx-auto", "w-full", "p-6");
    expect(page.className.match(/max-w-\w+/g)).toEqual([maxWidth]);
  });

  it.each([
    ["default", ["p-6"]],
    ["compact", ["p-4"]],
    ["responsive", ["p-4", "sm:p-6"]],
  ] as const)("sets the %s gutter", (gutter, classes) => {
    render(
      <PageContainer data-testid="page" gutter={gutter} scroll={false}>
        Body
      </PageContainer>,
    );
    const page = screen.getByTestId("page");
    expect(page).toHaveAttribute("data-gutter", gutter);
    expect(page).toHaveClass(...classes);
    if (gutter === "compact") expect(page).not.toHaveClass("p-6");
  });

  it("scrolls itself by default, with the scroller outside the capped column", () => {
    const { container } = render(
      <PageContainer data-testid="page" width="4xl">
        Body
      </PageContainer>,
    );
    const scroller = container.querySelector(
      "[data-slot=page-scroll]",
    ) as HTMLElement;
    expect(scroller).toHaveClass("h-full", "w-full", "overflow-y-auto");
    // The column is the scroller's child: its scrollbar stays at the panel edge.
    expect(scroller.firstElementChild).toBe(screen.getByTestId("page"));
    expect(screen.getByTestId("page")).toHaveClass("min-h-full");
    expect(scroller.className).not.toMatch(/max-w-/);
  });

  it("adds no scroller when the parent already scrolls", () => {
    const { container } = render(
      <PageContainer data-testid="page" scroll={false}>
        Body
      </PageContainer>,
    );
    expect(container.querySelector("[data-slot=page-scroll]")).toBeNull();
    expect(container.firstElementChild).toBe(screen.getByTestId("page"));
    expect(screen.getByTestId("page")).not.toHaveClass("min-h-full");
  });

  it("merges a caller class and passes props to the column", () => {
    render(
      <PageContainer className="bg-card" data-testid="page" scroll={false}>
        Body
      </PageContainer>,
    );
    expect(screen.getByTestId("page")).toHaveClass("bg-card", "p-6");
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = render(
      <PageContainer width="4xl">
        <PageHeader title="Services" />
      </PageContainer>,
    );
    await expectNoA11yViolations(baseElement);
  });
});
