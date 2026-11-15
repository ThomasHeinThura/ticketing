import { expectNoA11yViolations } from "@taskdesk/ui/test/a11y";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalCaseFilters } from "./portal-case-filters";

vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(key.includes(":") ? key : `${namespace}:${key}`, options),
      i18n: {
        language: "en-US",
        resolvedLanguage: "en-US",
        t: (_key: string, options?: { count?: number }) =>
          translate(
            `term:customer.request_${options?.count === 1 ? "one" : "other"}`,
          ),
      },
    }),
  };
});

afterEach(() => cleanup());

describe("PortalCaseFilters", () => {
  it("switches between my and all cases", () => {
    const onChange = vi.fn();
    render(<PortalCaseFilters filters={{}} onChange={onChange} />);
    const mine = screen.getByRole("button", { name: /^My / });
    expect(mine).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^All / }));
    expect(onChange).toHaveBeenCalledWith({ scope: "all" });
  });

  it("has no axe violations with a menu open (G4)", async () => {
    const { baseElement } = render(
      <PortalCaseFilters
        filters={{ status: "received" }}
        onChange={vi.fn()}
        full
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    await screen.findByRole("menuitemcheckbox", { name: "Received" });
    await expectNoA11yViolations(baseElement, {
      impact: "serious-or-critical",
    });
  });

  it("toggles statuses in a fixed order from the Status menu", async () => {
    const onChange = vi.fn();
    render(
      <PortalCaseFilters
        filters={{ status: "in_progress" }}
        statuses={["received", "need_more_info", "in_progress"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    const received = await screen.findByRole("menuitemcheckbox", {
      name: "Received",
    });
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Resolved" }),
    ).toBeNull();
    fireEvent.click(received);
    expect(onChange).toHaveBeenCalledWith({ status: "received,in_progress" });
  });

  it("puts a leading control in the same toolbar row", () => {
    render(
      <PortalCaseFilters
        filters={{}}
        onChange={vi.fn()}
        leading={<span>View tabs</span>}
      />,
    );
    const toolbar = screen
      .getByText("View tabs")
      .closest("[data-slot=portal-case-toolbar]");
    expect(toolbar).not.toBeNull();
    expect(toolbar).toContainElement(
      screen.getByRole("button", { name: /^My / }),
    );
  });

  it("collapses the full list's menus behind one Filter sheet on phones (P5)", async () => {
    const onChange = vi.fn();
    render(
      <PortalCaseFilters
        filters={{ status: "received", priority: "high" }}
        onChange={onChange}
        full
      />,
    );
    // Inline menus show from sm up; the Filter button only below sm.
    const inlineStatus = screen.getByRole("button", { name: /^Status/ });
    expect(inlineStatus.closest(".max-sm\\:hidden")).not.toBeNull();
    const trigger = screen.getByRole("button", { name: /^Filter/ });
    expect(trigger).toHaveClass("sm:hidden");
    // Two filter groups are active: status and severity.
    expect(trigger).toHaveTextContent("2");
    expect(
      screen.getByRole("searchbox").closest(".max-sm\\:hidden"),
    ).toBeNull();

    fireEvent.click(trigger);
    const sheet = await screen.findByRole("dialog", { name: "Filter" });
    for (const name of [/^Status/, /^Severity/, /^Created/, /Recently updated/])
      expect(within(sheet).getByRole("button", { name })).toBeVisible();
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Clear filters" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      status: undefined,
      priority: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    });
    await expectNoA11yViolations(document.body, {
      impact: "serious-or-critical",
    });
  });

  it("keeps the dashboard's short filter row inline, with no sheet", () => {
    render(<PortalCaseFilters filters={{}} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^Filter/ })).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /^Status/ })
        .closest(".max-sm\\:hidden"),
    ).toBeNull();
  });

  it("offers search and clears every filter on the full list", async () => {
    const onChange = vi.fn();
    render(
      <PortalCaseFilters
        filters={{ priority: "high", q: "old" }}
        onChange={onChange}
        full
      />,
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "printer" },
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ q: "printer" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({
      status: undefined,
      priority: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    });
    expect(
      screen.getByRole("button", { name: /Recently updated/ }),
    ).toBeVisible();
  });
});
