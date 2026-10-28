import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemField } from "@/types/work-item";
import WorkItemList from "./work-item-list";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  navigate: vi.fn(),
  preloadRoute: vi.fn(),
  restore: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": {
      ":key": { $patch: mocks.patch },
    },
    me: { settings: { $get: vi.fn(), $patch: vi.fn() } },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    navigate: mocks.navigate,
    preloadRoute: mocks.preloadRoute,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === "string"
        ? options
        : typeof options?.defaultValue === "string"
          ? options.defaultValue
          : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canUpdateTasks: () => true,
    canAssignTasks: () => true,
    canTransitionTasks: () => true,
    canSetPriorityTasks: () => true,
  }),
}));

vi.mock("@/hooks/mutations/work-item/use-restore-work-item", () => ({
  default: () => ({ mutateAsync: mocks.restore, isPending: false }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

const row = {
  id: "wi_1",
  projectId: "proj_1",
  workspaceId: "ws_1",
  typeId: "type_1",
  number: 123,
  key: "PROJ-123",
  title: "Fix the thing",
  description: null,
  stateId: "state_1",
  stateName: "Backlog",
  stateCategory: "backlog",
  priority: "medium",
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  position: "1.0000000000",
  customerVisibility: "private",
  startDate: null,
  dueDate: "2026-10-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  version: 4,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  unavailableFields: [] as WorkItemField[],
};

const props = {
  hasPartialFailure: false,
  isLoading: false,
  isError: false,
  sort: "key" as const,
  dir: "asc" as const,
  onSortChange: vi.fn(),
  onRetry: vi.fn(),
};

async function renderList(onOpenItem = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["work-items", "detail", row.key], {
    ...row,
    version: 7,
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <WorkItemList {...props} workItems={[row]} onOpenItem={onOpenItem} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  return { ...result, queryClient, onOpenItem };
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.patch.mockReset().mockResolvedValue(
    new Response(JSON.stringify({ version: 8 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  mocks.restore.mockReset().mockResolvedValue(undefined);
  mocks.toastError.mockReset();
  mocks.toastSuccess.mockReset();
});

describe("table inline work-item fields", () => {
  it("keeps the normal title link and separates edit clicks from row opening", async () => {
    const onOpenItem = vi.fn();
    await renderList(onOpenItem);

    expect(screen.getByRole("link", { name: row.title })).toHaveAttribute(
      "href",
      "/agent/work-items/PROJ-123",
    );
    fireEvent.click(await screen.findByTestId("work-item-inline-title-edit"));

    expect(onOpenItem).not.toHaveBeenCalled();
    expect(screen.getByTestId("work-item-inline-title-editor")).toBeVisible();
  });

  it("PATCHes priority with the current cached version without opening the row", async () => {
    const onOpenItem = vi.fn();
    await renderList(onOpenItem);

    fireEvent.click(await screen.findByTestId("work-item-inline-priority"));
    fireEvent.click(
      await screen.findByTestId("work-item-inline-priority-option-urgent"),
    );

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith(
        {
          param: { key: "PROJ-123" },
          header: { "if-match": '"7"' },
          json: { priority: "urgent" },
        },
        { headers: { "If-Match": '"7"' } },
      ),
    );
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it("keeps the cached row unchanged when the persisted compare-and-swap conflicts", async () => {
    mocks.patch.mockResolvedValue(
      new Response(JSON.stringify({ assertedVersion: 7, currentVersion: 8 }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const { queryClient } = await renderList();

    fireEvent.click(await screen.findByTestId("work-item-inline-priority"));
    fireEvent.click(
      await screen.findByTestId("work-item-inline-priority-option-urgent"),
    );

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledOnce());
    expect(
      queryClient.getQueryData<{ priority: string }>([
        "work-items",
        "detail",
        row.key,
      ])?.priority,
    ).toBe("medium");
  });
});
