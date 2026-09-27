import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import WorkItemList from "./work-item-list";

/**
 * The delta review's second requirement: a test at the level `work.tsx` actually
 * operates at (real hook -> real list component), not just the hook in isolation --
 * proving the fixed `placeholderData` scoping (`use-get-work-items.ts`) actually keeps
 * a project switch from rendering the wrong project's rows on screen, not just from
 * returning the wrong data internally.
 *
 * Deliberately does NOT render the full `work.tsx` route (that needs the real
 * TanStack Router file-route tree, `useActiveWorkspace`, `useGetProjects`, etc. -- a
 * lot of unrelated machinery this fix does not touch). This mounts the REAL
 * `useGetWorkItems` hook feeding the REAL `WorkItemList` component -- the exact
 * integration point the bug lived in -- with only the underlying fetcher mocked.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const mocks = vi.hoisted(() => ({
  getWorkItems: vi.fn(),
}));

vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: mocks.getWorkItems,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeResult(rows: Array<{ id: string; key: string; title: string }>) {
  return {
    items: rows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      projectId: "irrelevant",
      workspaceId: "irrelevant",
      typeId: "irrelevant",
      number: 1,
      description: null,
      stateId: "state_1",
      stateName: "To Do",
      stateCategory: "unstarted",
      priority: null,
      assigneeId: null,
      assigneeName: null,
      requesterId: null,
      parentId: null,
      position: "1.0000000000",
      customerVisibility: "private",
      startDate: null,
      dueDate: null,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      unavailableFields: [],
    })),
    hasPartialFailure: false,
    hasMore: false,
  } as WorkItemsResult;
}

function Harness({ projectId }: { projectId: string }) {
  const { data, isLoading, isError } = useGetWorkItems({
    projectId,
    sort: "key",
    dir: "asc",
  });
  return (
    <WorkItemList
      workItems={data?.items}
      isLoading={isLoading}
      isError={isError}
      sort="key"
      dir="asc"
      onSortChange={vi.fn()}
      onRetry={vi.fn()}
    />
  );
}

function renderWithClient(projectId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Harness projectId={projectId} />
    </QueryClientProvider>,
  );
  return { queryClient, ...utils };
}

describe("work-item list: switching projects never shows the previous project's rows", () => {
  it("renders project A's rows, then a real loading state (never A's rows) while B loads, then B's rows", async () => {
    const forA = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(forA.promise);

    const { rerender, queryClient } = renderWithClient("proj-a");
    forA.resolve(
      makeResult([{ id: "a1", key: "A-1", title: "Project A's own item" }]),
    );
    await waitFor(() =>
      expect(screen.getByText("Project A's own item")).toBeInTheDocument(),
    );

    const forB = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(forB.promise);

    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness projectId="proj-b" />
      </QueryClientProvider>,
    );

    // The exact bug window: B's fetch hasn't resolved yet. A's row must NOT still be
    // on screen, and the loading skeleton (not the populated table) must be showing.
    expect(screen.queryByText("Project A's own item")).not.toBeInTheDocument();
    expect(screen.getByTestId("work-item-list-loading")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-list-populated"),
    ).not.toBeInTheDocument();

    forB.resolve(
      makeResult([{ id: "b1", key: "B-1", title: "Project B's own item" }]),
    );
    await waitFor(() =>
      expect(screen.getByText("Project B's own item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Project A's own item")).not.toBeInTheDocument();
  });
});
