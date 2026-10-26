import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { translate } from "@/test/en-translation";
import WorkItemListControls from "./work-item-list-controls";

const mocks = vi.hoisted(() => ({
  canExport: false,
  exportWorkItems: vi.fn(),
  saveAs: vi.fn(),
  customFields: [] as unknown[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

vi.mock("@/components/work-item/work-item-filter-editor", () => ({
  default: () => <div data-testid="filter-editor" />,
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canExportTasks: () => mocks.canExport,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/custom-field/use-custom-fields", () => ({
  useCustomFields: () => ({ data: { data: mocks.customFields } }),
}));

vi.mock("@/fetchers/work-item/export-work-items", () => ({
  exportWorkItems: (...args: unknown[]) => mocks.exportWorkItems(...args),
}));

vi.mock("file-saver", () => ({
  saveAs: (...args: unknown[]) => mocks.saveAs(...args),
}));

beforeEach(() => {
  mocks.canExport = false;
  mocks.exportWorkItems.mockReset();
  mocks.saveAs.mockReset();
  mocks.customFields = [];
});

afterEach(() => {
  cleanup();
});

describe("WorkItemListControls (VW-19 columns and D1 CSV export)", () => {
  it("toggles and reorders columns when onColumnsChange is provided", async () => {
    mocks.customFields = [
      {
        key: "constructor",
        name: "Asset tag",
        deletedAt: null,
        visibility: [
          { workItemTypeId: "type-1", visible: true, required: false },
        ],
      },
    ];
    const onColumnsChange = vi.fn();
    render(
      <WorkItemListControls
        filter=""
        mode="visual"
        onModeChange={vi.fn()}
        onApply={vi.fn()}
        columns={["key", "title", "priority"]}
        onColumnsChange={onColumnsChange}
      />,
    );
    await screen.findByTestId("filter-editor");
    expect(screen.getByTestId("work-item-column-controls")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move Title left" }));
    expect(onColumnsChange).toHaveBeenCalledWith(["title", "key", "priority"]);

    fireEvent.click(screen.getByRole("button", { name: "State" }));
    expect(onColumnsChange).toHaveBeenCalledWith([
      "key",
      "title",
      "priority",
      "state",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Asset tag" }));
    expect(onColumnsChange).toHaveBeenLastCalledWith([
      "key",
      "title",
      "priority",
      "cf.constructor",
    ]);
  });

  it("hides the Export CSV button without exportTasks capability and exports CSV when permitted", async () => {
    const { rerender } = render(
      <WorkItemListControls
        filter="priority:high"
        mode="text"
        onModeChange={vi.fn()}
        onApply={vi.fn()}
        workspaceId="ws_1"
        projectSlug="WLP"
        sort="priority"
        dir="desc"
        columns={["key", "title", "cf.asset_tag"]}
      />,
    );
    await screen.findByTestId("filter-editor");
    expect(screen.queryByTestId("work-item-export-csv")).toBeNull();

    mocks.canExport = true;
    mocks.exportWorkItems.mockResolvedValueOnce(
      "key,title\r\nWLP-1,Fix outage\r\n",
    );
    rerender(
      <WorkItemListControls
        filter="priority:high"
        mode="text"
        onModeChange={vi.fn()}
        onApply={vi.fn()}
        workspaceId="ws_1"
        projectSlug="WLP"
        sort="priority"
        dir="desc"
        columns={["key", "title", "cf.asset_tag"]}
      />,
    );

    const exportButton = screen.getByTestId("work-item-export-csv");
    fireEvent.click(exportButton);
    await waitFor(() => expect(mocks.exportWorkItems).toHaveBeenCalledOnce());
    expect(mocks.exportWorkItems).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      projectSlug: "WLP",
      filter: "priority:high",
      sort: "priority",
      dir: "desc",
      columns: ["key", "title", "cf.asset_tag"],
    });
    expect(mocks.saveAs).toHaveBeenCalledOnce();
  });

  it("shows a translated alert when the server refuses an export over the 10,000-row limit (422)", async () => {
    mocks.canExport = true;
    mocks.exportWorkItems.mockRejectedValueOnce(
      new HttpError(422, "Export exceeds maximum of 10000 rows"),
    );
    render(
      <WorkItemListControls
        filter=""
        mode="visual"
        onModeChange={vi.fn()}
        onApply={vi.fn()}
        workspaceId="ws_1"
        projectSlug="WLP"
      />,
    );
    await screen.findByTestId("filter-editor");
    fireEvent.click(screen.getByTestId("work-item-export-csv"));
    const alert = await screen.findByTestId("work-item-export-error");
    expect(alert).toHaveTextContent(
      translate("workItems:list.exportLimitExceeded"),
    );
  });
});
