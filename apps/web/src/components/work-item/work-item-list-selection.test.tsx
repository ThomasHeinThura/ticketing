import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import type { WorkItemField, WorkItemRow } from "@/types/work-item";
import WorkItemList from "./work-item-list";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    preloadRoute: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

function row(key: string, unavailableFields: WorkItemField[] = []) {
  return {
    id: `id-${key}`,
    projectId: "proj_1",
    key,
    number: Number(key.split("-")[1]),
    title: `Title ${key}`,
    stateId: "s1",
    stateName: "Open",
    stateCategory: "backlog",
    priority: null,
    assigneeId: null,
    assigneeName: null,
    position: "1",
    dueDate: null,
    unavailableFields,
  } as unknown as WorkItemRow;
}

function mount(props: Partial<Parameters<typeof WorkItemList>[0]> = {}) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <WorkItemList
        workItems={[row("WLP-1"), row("WLP-2"), row("WLP-3", ["key"])]}
        hasPartialFailure={false}
        isLoading={false}
        isError={false}
        sort="key"
        dir="asc"
        onSortChange={vi.fn()}
        onRetry={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("work item list selection (bulk assign, VW-3)", () => {
  it("renders no selection controls without the assign capability", () => {
    mount({ canBulkAssign: false });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders no selection controls when the flag is not passed at all", () => {
    mount();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("renders a distinctly named checkbox per row and a select-all with the capability", () => {
    mount({ canBulkAssign: true });
    expect(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-2" }),
    ).toBeInTheDocument();
  });

  it("disables the checkbox of a row whose key is unavailable", () => {
    mount({ canBulkAssign: true });
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-3" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("reports row and select-all changes", () => {
    const onSelectionChange = vi.fn();
    const onSelectAll = vi.fn();
    mount({ canBulkAssign: true, onSelectionChange, onSelectAll });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select WLP-2" }));
    expect(onSelectionChange).toHaveBeenCalledWith("WLP-2", true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    );
    expect(onSelectAll).toHaveBeenCalledWith(true);
  });

  it("checks select-all only when every selectable row is selected, ignoring unavailable rows", () => {
    mount({ canBulkAssign: true, selectedKeys: ["WLP-1", "WLP-2"] });
    expect(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    ).toBeChecked();
    cleanup();
    mount({ canBulkAssign: true, selectedKeys: ["WLP-1"] });
    expect(
      screen.getByRole("checkbox", { name: "Select all work items" }),
    ).not.toBeChecked();
  });
});
