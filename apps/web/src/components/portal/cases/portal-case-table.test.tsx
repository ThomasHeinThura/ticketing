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
        columns={["project", "created", "people"]}
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
    // CP-2: an unset severity is a muted dash in its column (named for screen readers) and
    // nothing at all in the narrow details.
    expect(screen.getAllByText("Not set")).toHaveLength(1);
    expect(screen.getByText("Not set")).toHaveClass("sr-only");
    expect(screen.getAllByText("Acme Support")).toHaveLength(2);
    expect(table.textContent?.toLowerCase()).not.toContain("assignee");
  });

  it("sizes columns by the frame and keeps severity and status in Details when narrow", () => {
    render(
      <PortalCaseTable
        caption="Outstanding requests"
        columns={["project", "created", "people"]}
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

  it("leaves out Project, Created by and Assigned to unless the caller asks for them (CP-2)", () => {
    render(<PortalCaseTable caption="My requests" cases={[base]} />);
    const table = screen.getByRole("table", { name: "My requests" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Updated", "Details", "Severity", "Status"]);
    expect(screen.queryByText("Your team")).toBeNull();
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.queryByText("Acme Support")).toBeNull();
  });

  it("shows Updated as relative time with the absolute time in the title (CP-2)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T09:00:00.000Z"));
    try {
      render(<PortalCaseTable caption="Requests" cases={[base]} />);
      const times = screen.getAllByText("2 days ago");
      // Once in the Updated column, once in the narrow details.
      expect(times).toHaveLength(2);
      for (const time of times) {
        expect(time.closest("time")).toHaveAttribute(
          "dateTime",
          base.updatedAt,
        );
        expect(time.closest("time")).toHaveAttribute(
          "title",
          new Intl.DateTimeFormat("en-US", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(base.updatedAt)),
        );
      }
    } finally {
      vi.useRealTimers();
    }
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

  it("says 'raised for you' only to the requester and names the requester to a colleague (D5, D6)", () => {
    const direct: PortalCase = {
      ...base,
      ref: "HELP-4",
      source: "direct",
      createdBy: { name: null, isYou: true },
      isRequester: true,
    };
    render(
      <PortalCaseTable
        caption="Requests"
        cases={[
          direct,
          {
            ...direct,
            ref: "HELP-5",
            createdBy: { name: "Bob Colleague", isYou: false },
            isRequester: false,
          },
          {
            ...direct,
            ref: "HELP-6",
            createdBy: { name: null, isYou: false },
            isRequester: false,
          },
        ]}
      />,
    );
    const rows = within(
      screen.getByRole("table", { name: "Requests" }),
    ).getAllByRole("row");
    expect(
      within(rows[1]).getByText("Raised by our team for you"),
    ).toBeVisible();
    expect(
      within(rows[2]).getByText("Raised by our team for Bob Colleague"),
    ).toBeVisible();
    expect(
      within(rows[2]).queryByText("Raised by our team for you"),
    ).toBeNull();
    expect(
      within(rows[3]).getByText("Raised by our team for a colleague"),
    ).toBeVisible();
  });

  it("rings a keyboard-focused case reference like the other portal controls", () => {
    render(
      <PortalCaseTable
        caption="Requests"
        cases={[base, { ...base, ref: "HELP-4", source: "direct" }]}
      />,
    );
    for (const name of ["SUB-7", "HELP-4"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveClass(
        "focus-visible:ring-2",
        "focus-visible:ring-ring",
        "rounded-sm",
      );
      expect(link.className).not.toContain("focus-visible:underline");
    }
  });
});
