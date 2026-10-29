import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReportSearch } from "@/lib/report-search";
import { translate } from "@/test/en-translation";
import { ReportFilters } from "./report-filters";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      translate(
        typeof options.count === "number"
          ? `${key}_${new Intl.PluralRules("en").select(options.count)}`
          : key,
        options,
      ),
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "project-one", name: "Example project" }] }),
}));
vi.mock("@/hooks/queries/project/use-customer-organisations", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/team/use-teams", () => ({
  useTeams: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: Date | string) => String(value),
}));

afterEach(cleanup);

const search: ReportSearch = {
  window: "custom",
  from: "2026-10-01",
  to: "2026-10-30",
  projectId: "project-one",
  priority: "high",
  metric: "first_response",
  view: "table",
  drill: "existing-row",
};

describe("report calendar filters", () => {
  it("clears one bound without losing any other URL state", () => {
    const onChange = vi.fn();
    render(
      <ReportFilters
        workspaceId="workspace-one"
        search={search}
        onChange={onChange}
        live={false}
        choices={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "From" }));
    expect(screen.getByRole("dialog", { name: "From" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      ...search,
      from: undefined,
    });
  });

  it("removes custom bounds when a preset window is selected", () => {
    const onChange = vi.fn();
    render(
      <ReportFilters
        workspaceId="workspace-one"
        search={search}
        onChange={onChange}
        live={false}
        choices={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    const { from: _from, to: _to, ...rest } = search;
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...rest, window: "30" });
  });

  it("keeps date filters unavailable for a live report", () => {
    render(
      <ReportFilters
        workspaceId="workspace-one"
        search={search}
        onChange={vi.fn()}
        live
        choices={[]}
      />,
    );
    expect(screen.queryByRole("button", { name: "From" })).toBeNull();
    expect(screen.queryByRole("button", { name: "To" })).toBeNull();
  });
});
