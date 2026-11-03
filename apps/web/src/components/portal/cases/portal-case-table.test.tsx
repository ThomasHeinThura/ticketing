import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PortalCase } from "@/fetchers/portal/cases";
import { PortalCaseTable } from "./portal-case-table";

vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(`${namespace}:${key}`, options),
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

vi.mock("@tanstack/react-router", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Link: React.forwardRef<
      HTMLAnchorElement,
      React.PropsWithChildren<{ to: string; params?: { ref: string } }>
    >(({ children, to, params, ...props }, ref) => (
      <a href={to.replace("$ref", params?.ref ?? "")} ref={ref} {...props}>
        {children}
      </a>
    )),
  };
});

afterEach(() => cleanup());

const base: PortalCase = {
  ref: "SUB-7",
  source: "submission",
  title: "Printer jammed",
  requestTypeName: "Hardware",
  priority: "urgent",
  customerStatus: "need_more_info",
  createdAt: "2026-10-20T09:00:00.000Z",
  updatedAt: "2026-10-21T09:00:00.000Z",
  project: { key: "ACME", name: "Acme Support" },
  createdBy: { name: null, isYou: true },
  isRequester: true,
  customerVisibility: "private",
  sla: null,
};

describe("PortalCaseTable", () => {
  it("shows the WSO2 columns with 'Your team' in place of an assignee", () => {
    render(
      <PortalCaseTable
        caption="Outstanding requests"
        columns={["project", "created"]}
        cases={[
          base,
          {
            ...base,
            ref: "ACME-3",
            source: "direct",
            title: "",
            requestTypeName: "Incident",
            priority: null,
            customerStatus: "in_progress",
            project: null,
            createdBy: { name: "Bob Colleague", isYou: false },
            isRequester: false,
          },
          {
            ...base,
            ref: "SUB-9",
            createdBy: { name: null, isYou: false },
            isRequester: false,
          },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Outstanding requests" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Updated",
      "Details",
      "Project",
      "Severity",
      "Status",
      "Created by",
      "Assigned to",
      "Created",
    ]);
    expect(screen.getByRole("link", { name: "SUB-7" })).toHaveAttribute(
      "href",
      "/submissions/SUB-7",
    );
    // Severity and status render in their columns and again under the title for narrow frames,
    // where CSS shows exactly one of the two (jsdom applies no container queries).
    expect(screen.getAllByText("Urgent")).toHaveLength(4);
    expect(screen.getAllByText("We need more from you")).toHaveLength(4);
    expect(screen.getByText("You")).toBeVisible();
    expect(screen.getByText("Bob Colleague")).toBeVisible();
    expect(screen.getByText("A colleague")).toBeVisible();
    expect(screen.getAllByText("Your team")).toHaveLength(3);
    // D6 / U-12: a request raised by staff opens its own page; the type stands in for a title.
    expect(screen.getByRole("link", { name: "ACME-3" })).toHaveAttribute(
      "href",
      "/requests/ACME-3",
    );
    expect(screen.getAllByText("Incident")).toHaveLength(2);
    expect(screen.getAllByText("Not set")).toHaveLength(2);
    expect(screen.getAllByText("Acme Support")).toHaveLength(2);
    expect(table.textContent?.toLowerCase()).not.toContain("assignee");
  });

  it("sizes columns by the frame and keeps severity and status in Details when narrow", () => {
    render(
      <PortalCaseTable
        caption="Outstanding requests"
        columns={["project", "created"]}
        cases={[base]}
      />,
    );
    const table = screen.getByRole("table", { name: "Outstanding requests" });
    // The frame is the query container; no viewport breakpoint or fixed minimum width remains.
    expect(table.closest("[data-slot=frame]")).toHaveClass("@container");
    expect(table.className).not.toMatch(/min-w-/);
    const visibleFrom = Object.fromEntries(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => [
          cell.textContent,
          cell.className.match(/@\w+:table-cell/)?.[0] ?? "always",
        ]),
    );
    expect(visibleFrom).toEqual({
      Updated: "@2xl:table-cell",
      Details: "always",
      Project: "@5xl:table-cell",
      Severity: "@2xl:table-cell",
      Status: "@2xl:table-cell",
      "Created by": "@4xl:table-cell",
      "Assigned to": "@4xl:table-cell",
      Created: "@5xl:table-cell",
    });
    expect(
      table.querySelector(
        "[class*=sm\\:table-cell],[class*=md\\:table-cell],[class*=lg\\:table-cell]",
      ),
    ).toBeNull();
    // The pages cap the frame at 69rem (`max-w-6xl` less padding): a column behind a wider
    // container step could never show.
    for (const element of table.querySelectorAll("[class]"))
      expect(element.getAttribute("class")).not.toMatch(/@(6|7)xl:/);
    // No column holds a fixed width; text columns wrap so long names cannot push the table wider
    // than the frame.
    for (const cell of within(table).getAllByRole("columnheader"))
      expect(cell.className).not.toMatch(/(^|\s)w-\d/);
    const details = within(table).getAllByRole("cell")[1];
    const narrowFacts = within(details)
      .getByText("Urgent")
      .closest("span.flex");
    expect(narrowFacts?.closest(".\\@2xl\\:hidden")).not.toBeNull();
    expect(within(details).getByText("We need more from you")).toBeVisible();
  });

  it("shows the service target under the status and in the narrow details (CP-6)", () => {
    render(
      <PortalCaseTable
        caption="Support requests"
        columns={["project", "created"]}
        cases={[
          {
            ...base,
            sla: {
              state: "at_risk",
              dueAt: "2099-01-01T10:00:00.000Z",
              metric: "resolution",
            },
          },
          { ...base, ref: "SUB-8" },
        ]}
      />,
    );
    const table = screen.getByRole("table", { name: "Support requests" });
    const [withSla, withoutSla] = within(table).getAllByRole("row").slice(1);
    // Once in the Status cell (wide frames), once under the title (narrow frames).
    expect(within(withSla).getAllByText("Due soon")).toHaveLength(2);
    expect(within(withSla).getAllByText(/^Resolution due by /)).toHaveLength(2);
    const [, details, , , status] = within(withSla).getAllByRole("cell");
    expect(within(status).getByText("Due soon")).toBeVisible();
    expect(
      within(details).getByText("Due soon").closest(".\\@2xl\\:hidden"),
    ).not.toBeNull();
    // No service target: nothing renders.
    expect(within(withoutSla).queryByText("Due soon")).toBeNull();
    expect(within(withoutSla).queryByText(/due by/i)).toBeNull();
  });
});
