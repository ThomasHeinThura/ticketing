import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@taskdesk/ui";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getQueue: vi.fn(),
  runQueue: vi.fn(),
  updateQueue: vi.fn(),
}));
vi.mock("@/fetchers/intake-queues", () => ({
  getIntakeQueue: (...args: unknown[]) => mocks.getQueue(...args),
  runIntakeQueue: (...args: unknown[]) => mocks.runQueue(...args),
  updateIntakeQueue: (...args: unknown[]) => mocks.updateQueue(...args),
}));
vi.mock("@/components/work-item/work-item-list", () => ({
  default: ({
    workItems,
    hasMore,
    onLoadMore,
    onSortChange,
  }: {
    workItems: Array<{ key: string }>;
    hasMore?: boolean;
    onLoadMore?: () => void;
    onSortChange?: (sort: string, dir: "asc" | "desc") => void;
  }) => (
    <div data-testid="work-item-list">
      {workItems.map((item) => (
        <span key={item.key}>{item.key}</span>
      ))}
      {hasMore && (
        <Button type="button" onClick={onLoadMore}>
          More work items
        </Button>
      )}
      <Button type="button" onClick={() => onSortChange?.("priority", "desc")}>
        Sort by priority
      </Button>
    </div>
  ),
}));
vi.mock("@/components/intake/submission-queue-table", () => ({
  SubmissionQueueTable: ({ rows }: { rows: Array<{ ref: string }> }) => (
    <ul data-testid="submission-queue">
      {rows.map((row) => (
        <li key={row.ref}>{row.ref}</li>
      ))}
    </ul>
  ),
}));
vi.mock("@/components/work-item/work-item-list-controls", () => ({
  default: ({
    onApply,
    onModeChange,
    onColumnsChange,
  }: {
    onApply: (filter: string) => void;
    onModeChange: (mode: "visual" | "text") => void;
    onColumnsChange: (columns: string[]) => void;
  }) => (
    <div>
      <Button type="button" onClick={() => onApply("priority:high")}>
        Apply work-item filter
      </Button>
      <Button type="button" onClick={() => onModeChange("text")}>
        Use text filter
      </Button>
      <Button type="button" onClick={() => onColumnsChange(["key", "title"])}>
        Choose columns
      </Button>
    </div>
  ),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { IntakeQueuePanel } from "./queue-panel";

const queue = {
  id: "pair-1",
  workspaceId: "workspace-1",
  name: "Support",
  visibility: "private" as const,
  sharedWithTeamId: null,
  versions: { submission: 1, workItem: 1 },
  createdBy: "person-1",
  submissionView: {
    id: "view-1",
    query: { entity: "submission" },
    updatedAt: "2026-10-25T00:00:00.000Z",
  },
  workItemView: {
    id: "view-2",
    query: { entity: "work_item" },
    updatedAt: "2026-10-25T00:00:00.000Z",
  },
};

function runResult(input?: {
  submissionCursor?: string;
  workItemCursor?: string;
}) {
  return {
    queue: {
      id: queue.id,
      name: queue.name,
      visibility: queue.visibility,
      versions: queue.versions,
    },
    submissions: {
      submissions: [
        {
          ref: "SUB-21",
          summary: "Account access",
          submission: {
            id: "submission-21",
            number: 21,
            state: "new",
            customerVisibility: "private",
            claimedBy: null,
            claimedAt: null,
            createdAt: "2026-10-25T00:00:00.000Z",
          },
          requestType: { id: "type-1", key: "access", name: "Access" },
          requester: { id: "person-2", displayName: "Requester" },
          organisation: { id: "org-1", name: "Customer" },
          suggestedDuplicates: [],
        },
      ],
      page: {
        hasMore: !input?.submissionCursor,
        nextCursor: input?.submissionCursor ? null : "sub-next",
      },
      meta: { total: 3 },
    },
    workItems: {
      data: [],
      page: {
        hasMore: !input?.workItemCursor,
        nextCursor: input?.workItemCursor ? null : "item-next",
      },
      meta: { total: 2 },
    },
  };
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const onOpenSubmission = vi.fn();
  const onOpenWorkItem = vi.fn();
  const onWorkItemQueryChange = vi.fn();
  const rendered = render(
    <IntakeQueuePanel
      workspaceId="workspace-1"
      queueId="pair-1"
      state="new"
      selectedRef="SUB-21"
      onOpenSubmission={onOpenSubmission}
      onOpenWorkItem={onOpenWorkItem}
      onWorkItemQueryChange={onWorkItemQueryChange}
    />,
    { wrapper },
  );
  return {
    ...rendered,
    onOpenSubmission,
    onOpenWorkItem,
    onWorkItemQueryChange,
  };
}

beforeEach(() => {
  mocks.getQueue.mockReset().mockResolvedValue(queue);
  mocks.runQueue
    .mockReset()
    .mockImplementation(async (args) => runResult(args));
  mocks.updateQueue.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("IntakeQueuePanel", () => {
  it("renders both persisted entity sections and opens a submission", async () => {
    const { onOpenSubmission } = renderPanel();
    expect(await screen.findByText("SUB-21")).toBeInTheDocument();
    expect(screen.getByTestId("submission-queue")).toBeInTheDocument();
    expect(screen.getByTestId("work-item-list")).toBeInTheDocument();
    const args = mocks.runQueue.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({
      workspaceId: "workspace-1",
      id: "pair-1",
      state: "new",
      limit: 50,
    });
    expect(onOpenSubmission).not.toHaveBeenCalled();
  });

  it("keeps the two pages on separate cursors", async () => {
    renderPanel();
    await screen.findByText("SUB-21");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "queue.moreSubmissions" }),
      );
    });
    await waitFor(() => {
      expect(mocks.runQueue).toHaveBeenCalledTimes(2);
    });
    const next = mocks.runQueue.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(next.submissionCursor).toBe("sub-next");
    expect(next.workItemCursor).toBeUndefined();
  });

  it("resets only the changed entity's page before querying new filters", async () => {
    const {
      rerender,
      onOpenSubmission,
      onOpenWorkItem,
      onWorkItemQueryChange,
    } = renderPanel();
    await screen.findByText("SUB-21");
    fireEvent.click(screen.getByRole("button", { name: "More work items" }));
    await waitFor(() =>
      expect(mocks.runQueue.mock.lastCall?.[0].workItemCursor).toBe(
        "item-next",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "queue.moreSubmissions" }),
    );
    await waitFor(() =>
      expect(mocks.runQueue.mock.lastCall?.[0].submissionCursor).toBe(
        "sub-next",
      ),
    );
    rerender(
      <IntakeQueuePanel
        workspaceId="workspace-1"
        queueId="pair-1"
        state="accepted"
        onOpenSubmission={onOpenSubmission}
        onOpenWorkItem={onOpenWorkItem}
        onWorkItemQueryChange={onWorkItemQueryChange}
      />,
    );
    await waitFor(() =>
      expect(mocks.runQueue.mock.lastCall?.[0]).toMatchObject({
        state: "accepted",
        submissionCursor: undefined,
        workItemCursor: "item-next",
      }),
    );
    rerender(
      <IntakeQueuePanel
        workspaceId="workspace-1"
        queueId="pair-1"
        state="accepted"
        workItemQuery={{ sorts: [{ field: "priority", order: "desc" }] }}
        onOpenSubmission={onOpenSubmission}
        onOpenWorkItem={onOpenWorkItem}
        onWorkItemQueryChange={onWorkItemQueryChange}
      />,
    );
    await waitFor(() =>
      expect(mocks.runQueue.mock.lastCall?.[0]).toMatchObject({
        state: "accepted",
        submissionCursor: undefined,
        workItemCursor: undefined,
        workItemSorts: [{ field: "priority", order: "desc" }],
      }),
    );
  });

  it("keeps sorting as a URL override instead of saving to the shared queue", async () => {
    const { onWorkItemQueryChange } = renderPanel();
    await screen.findByText("SUB-21");
    fireEvent.click(screen.getByRole("button", { name: "Sort by priority" }));
    expect(onWorkItemQueryChange).toHaveBeenCalledWith({
      sorts: [{ field: "priority", order: "desc" }],
    });
  });

  it("keeps filter mode, filter text, and columns as URL overrides", async () => {
    const { onWorkItemQueryChange } = renderPanel();
    await screen.findByText("SUB-21");
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.filter" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use text filter" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Apply work-item filter" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    expect(onWorkItemQueryChange).toHaveBeenNthCalledWith(1, {
      filterMode: "text",
    });
    expect(onWorkItemQueryChange).toHaveBeenNthCalledWith(2, {
      filter: "priority:high",
    });
    expect(onWorkItemQueryChange).toHaveBeenNthCalledWith(3, {
      columns: ["key", "title"],
    });
  });

  it("uses the persisted state filter when no URL override is set", async () => {
    mocks.getQueue.mockResolvedValue({
      ...queue,
      submissionView: {
        ...queue.submissionView,
        query: { entity: "submission", filter: { state: "accepted" } },
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    render(
      <IntakeQueuePanel
        workspaceId="workspace-1"
        queueId="pair-1"
        onOpenSubmission={vi.fn()}
        onOpenWorkItem={vi.fn()}
        onWorkItemQueryChange={vi.fn()}
      />,
      { wrapper },
    );
    expect(
      await screen.findByTestId("intake-queue-saved-state"),
    ).toHaveTextContent("queue.savedState");
    await waitFor(() => {
      const args = mocks.runQueue.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(args.state).toBeUndefined();
    });
  });

  it("does not present the saved filter as inherited when a URL state override is active", async () => {
    mocks.getQueue.mockResolvedValue({
      ...queue,
      submissionView: {
        ...queue.submissionView,
        query: { entity: "submission", filter: { state: "accepted" } },
      },
    });
    renderPanel();
    await screen.findByText("SUB-21");
    expect(
      screen.queryByTestId("intake-queue-saved-state"),
    ).not.toBeInTheDocument();
  });
});
