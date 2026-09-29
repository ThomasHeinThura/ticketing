import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemJourney from "./work-item-journey";

const updateWorkItem = vi.fn();
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: (...args: unknown[]) => updateWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-activity", () => ({
  default: async () => ({
    data: [],
    page: { hasMore: false, nextCursor: null },
  }),
}));
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: async () => [],
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: async () => ({}),
}));

afterEach(() => {
  cleanup();
  updateWorkItem.mockReset();
});

function makeItem(): WorkItemDetailRow {
  return {
    id: "wi_1",
    projectId: "proj_1",
    workspaceId: "ws_1",
    typeId: "type_1",
    number: 1,
    key: "WLP-1",
    title: "Before",
    description: "Notes",
    stateId: "state_1",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: null,
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    position: "1",
    customerVisibility: "private",
    startDate: null,
    dueDate: null,
    archivedAt: null,
    deletedAt: null,
    version: 7,
    createdAt: "2026-09-29T09:00:00.000Z",
    updatedAt: "2026-09-29T09:00:00.000Z",
    unavailableFields: [],
  } as WorkItemDetailRow;
}

describe("WorkItemJourney", () => {
  it("keeps the edit draft visible after a 409 and does not silently retry with the newer version", async () => {
    updateWorkItem.mockRejectedValue(new WorkItemVersionConflictError(7, 8));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={makeItem()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.edit" }),
    );
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "My draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "workItems:journey.editConflict",
      ),
    );
    expect(screen.getByLabelText("workItems:journey.title")).toHaveValue(
      "My draft",
    );
    expect(updateWorkItem).toHaveBeenCalledTimes(1);
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 7,
      title: "My draft",
      description: "Notes",
      startDate: null,
      dueDate: null,
    });
  });

  it("sends populated calendar date inputs in the API's UTC ISO date-time format", async () => {
    updateWorkItem.mockResolvedValue({});
    const item = makeItem();
    item.startDate = "2026-09-20T00:00:00.000Z";
    item.dueDate = "2026-10-10T00:00:00.000Z";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={item} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.edit" }),
    );
    expect(screen.getByLabelText("workItems:journey.startDate")).toHaveValue(
      "2026-09-20",
    );
    expect(screen.getByLabelText("workItems:journey.dueDate")).toHaveValue(
      "2026-10-10",
    );
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "Updated title" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );

    await waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 7,
      title: "Updated title",
      description: "Notes",
      startDate: "2026-09-20T00:00:00.000Z",
      dueDate: "2026-10-10T00:00:00.000Z",
    });
  });
});
