import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(() => ({ data: { user: { id: "person-1" } } })),
  getWorkItems: vi.fn(),
  getWorkItem: vi.fn(),
  getActivity: vi.fn(),
  state: { listVersion: 1, detailVersion: 1, activityVersion: 1 },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: mocks.useSession },
}));
vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: mocks.getWorkItems,
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: mocks.getWorkItem,
}));

import WorkItemListRealtime from "@/components/work-item/work-item-list-realtime";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import { useNativeWorkItemRealtime } from "@/hooks/use-native-work-item-realtime";

class MockWebSocket {
  static OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  frame(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeResult(id: string): WorkItemsResult {
  return {
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for query lifecycle assertions
    items: [{ id } as any],
    hasPartialFailure: false,
    hasMore: false,
  };
}

function queryInterval(client: QueryClient, projectId: string) {
  const query = client
    .getQueryCache()
    .getAll()
    .find((candidate) => candidate.queryKey[1] === projectId);
  return (query?.options as { refetchInterval?: number | false } | undefined)
    ?.refetchInterval;
}

function detailQueryInterval(client: QueryClient, key: string) {
  const query = client
    .getQueryCache()
    .getAll()
    .find((candidate) => candidate.queryKey[2] === key);
  return (query?.options as { refetchInterval?: number | false } | undefined)
    ?.refetchInterval;
}

function ComposedWorkItemList({
  projectId,
  realtimeMounted,
}: {
  projectId: string;
  realtimeMounted: boolean;
}) {
  const [reportedStatus, setReportedStatus] = useState<{
    projectId: string;
    status: WorkItemRealtimeStatus;
  }>();
  const realtimeStatus =
    reportedStatus?.projectId === projectId
      ? reportedStatus.status
      : "connecting";
  const onAvailabilityChange = useCallback(
    (reportedProjectId: string, status: WorkItemRealtimeStatus) => {
      setReportedStatus({ projectId: reportedProjectId, status });
    },
    [],
  );
  const query = useGetWorkItems({
    projectId,
    sort: "key",
    dir: "desc",
    realtimeStatus,
  });

  return (
    <>
      <output data-testid="realtime-state">{realtimeStatus}</output>
      {realtimeStatus === "unavailable" ? (
        <div role="status" data-testid="realtime-warning">
          Live updates are unavailable.
        </div>
      ) : null}
      <output data-testid="query-state">
        {query.isLoading ? "loading" : (query.data?.items[0]?.id ?? "empty")}
      </output>
      {realtimeMounted ? (
        <WorkItemListRealtime
          key={projectId}
          projectId={projectId}
          onAvailabilityChange={onAvailabilityChange}
        />
      ) : null}
    </>
  );
}

function ComposedWorkItemDetail({ workItemKey }: { workItemKey: string }) {
  const query = useGetWorkItem({ key: workItemKey });
  return (
    <>
      <output data-testid="detail-realtime-state">
        {query.realtimeStatus}
      </output>
      {query.isRealtimeUnavailable ? (
        <div role="status" data-testid="detail-realtime-warning">
          Live updates are unavailable.
        </div>
      ) : null}
      <output data-testid="detail-query-state">
        {query.isLoading
          ? "loading"
          : `${query.data?.key ?? "empty"}:${query.data?.version ?? 0}`}
      </output>
    </>
  );
}

function ComposedWorkItemActivity({ workItemKey }: { workItemKey: string }) {
  const query = useQuery({
    queryKey: ["work-items", "activity", workItemKey],
    queryFn: () => mocks.getActivity(workItemKey),
  });
  return (
    <output data-testid="activity-query-state">
      {query.isLoading ? "loading" : query.data?.version}
    </output>
  );
}

function ComposedWorkItemTopics({
  projectId,
  workItemKey,
}: {
  projectId: string;
  workItemKey: string;
}) {
  const realtime = useNativeWorkItemRealtime([
    `project:${projectId}`,
    `work_item:${workItemKey}`,
  ]);
  const list = useQuery({
    queryKey: ["work-items", projectId],
    queryFn: () => mocks.getWorkItems(projectId),
  });
  const detail = useQuery({
    queryKey: ["work-items", "detail", workItemKey],
    queryFn: () => mocks.getWorkItem(workItemKey),
  });
  const activity = useQuery({
    queryKey: ["work-items", "activity", workItemKey],
    queryFn: () => mocks.getActivity(workItemKey),
  });
  return (
    <>
      <output data-testid="combined-realtime-state">{realtime.status}</output>
      <output data-testid="combined-list-state">
        {list.data?.items[0]?.id ?? "loading"}
      </output>
      <output data-testid="combined-detail-state">
        {detail.data ? `${detail.data.key}:${detail.data.version}` : "loading"}
      </output>
      <output data-testid="combined-activity-state">
        {activity.data?.version ?? "loading"}
      </output>
    </>
  );
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockWebSocket);
  MockWebSocket.instances = [];
  mocks.getWorkItems.mockReset();
  mocks.state = { listVersion: 1, detailVersion: 1, activityVersion: 1 };
  mocks.getWorkItems.mockImplementation(async (projectId: string) => ({
    ...makeResult(`${projectId}-item`),
    items: [{ id: `${projectId}-item:${mocks.state.listVersion}` } as never],
  }));
  mocks.getWorkItem.mockReset();
  mocks.getWorkItem.mockImplementation(async (key: string) => ({
    key,
    version: mocks.state.detailVersion,
  }));
  mocks.getActivity.mockReset();
  mocks.getActivity.mockImplementation(async () => ({
    version: mocks.state.activityVersion,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("work-item list realtime composition", () => {
  it.each(["project-first", "item-first"] as const)(
    "invalidates all affected query keys for a duplicate event in %s topic order",
    async (topicOrder) => {
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      });
      render(
        <ComposedWorkItemTopics
          projectId="project-multitopic"
          workItemKey="WI-MULTITOPIC"
        />,
        { wrapper: wrapperFor(client) },
      );
      await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
      await waitFor(() => {
        expect(screen.getByTestId("combined-list-state")).toHaveTextContent(
          "project-multitopic-item:1",
        );
        expect(screen.getByTestId("combined-detail-state")).toHaveTextContent(
          "WI-MULTITOPIC:1",
        );
        expect(screen.getByTestId("combined-activity-state")).toHaveTextContent(
          "1",
        );
      });
      const socket = MockWebSocket.instances[0];
      if (!socket) throw new Error("Expected the combined subscription socket");
      act(() => {
        socket.open();
        socket.frame({
          type: "subscribed",
          topic: "project:project-multitopic",
        });
        socket.frame({
          type: "subscribed",
          topic: "work_item:WI-MULTITOPIC",
        });
      });
      await waitFor(() =>
        expect(screen.getByTestId("combined-realtime-state")).toHaveTextContent(
          "available",
        ),
      );
      await waitFor(() =>
        expect(
          client
            .getQueryCache()
            .getAll()
            .every((query) => query.state.fetchStatus === "idle"),
        ).toBe(true),
      );
      mocks.getWorkItems.mockClear();
      mocks.getWorkItem.mockClear();
      mocks.getActivity.mockClear();
      mocks.state = { listVersion: 2, detailVersion: 2, activityVersion: 2 };

      const projectFrame = {
        type: "work_item.updated",
        topic: "project:project-multitopic",
        eventId: `evt-${topicOrder}`,
        payload: { key: "WI-MULTITOPIC" },
      };
      const itemFrame = {
        ...projectFrame,
        topic: "work_item:WI-MULTITOPIC",
      };
      act(() => {
        for (const frame of topicOrder === "project-first"
          ? [projectFrame, itemFrame]
          : [itemFrame, projectFrame]) {
          socket.frame(frame);
        }
      });
      await waitFor(
        () => {
          expect(screen.getByTestId("combined-list-state")).toHaveTextContent(
            "project-multitopic-item:2",
          );
          expect(screen.getByTestId("combined-detail-state")).toHaveTextContent(
            "WI-MULTITOPIC:2",
          );
        },
        { timeout: 1_000 },
      );
      expect(mocks.getWorkItems).toHaveBeenCalledTimes(1);
      expect(mocks.getWorkItem).toHaveBeenCalledTimes(1);
      expect(mocks.getActivity).not.toHaveBeenCalled();
    },
  );

  it("refreshes active list, detail, and activity queries once per socket event burst", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    render(
      <>
        <ComposedWorkItemList projectId="project-refresh" realtimeMounted />
        <ComposedWorkItemDetail workItemKey="WI-REFRESH" />
        <ComposedWorkItemActivity workItemKey="WI-REFRESH" />
      </>,
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    await waitFor(() => {
      expect(screen.getByTestId("query-state")).toHaveTextContent(
        "project-refresh-item:1",
      );
      expect(screen.getByTestId("detail-query-state")).toHaveTextContent(
        "WI-REFRESH:1",
      );
      expect(screen.getByTestId("activity-query-state")).toHaveTextContent("1");
    });
    const [projectSocket, itemSocket] = MockWebSocket.instances;
    if (!projectSocket || !itemSocket) throw new Error("Expected both sockets");
    act(() => {
      projectSocket.open();
      itemSocket.open();
      projectSocket.frame({
        type: "subscribed",
        topic: "project:project-refresh",
      });
      itemSocket.frame({ type: "subscribed", topic: "work_item:WI-REFRESH" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("realtime-state")).toHaveTextContent(
        "available",
      );
      expect(screen.getByTestId("detail-realtime-state")).toHaveTextContent(
        "available",
      );
    });
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.state.fetchStatus === "idle"),
      ).toBe(true),
    );

    mocks.getWorkItems.mockClear();
    mocks.getWorkItem.mockClear();
    mocks.getActivity.mockClear();
    mocks.state = { listVersion: 2, detailVersion: 2, activityVersion: 2 };
    act(() => {
      projectSocket.frame({
        type: "work_item.updated",
        topic: "project:project-refresh",
        eventId: "evt-shared-across-connections",
        payload: { key: "WI-REFRESH" },
      });
      itemSocket.frame({
        type: "work_item.updated",
        topic: "work_item:WI-REFRESH",
        eventId: "evt-shared-across-connections",
        payload: { key: "WI-REFRESH" },
      });
      projectSocket.frame({
        type: "work_item.updated",
        topic: "project:project-refresh",
        eventId: "evt-second-in-burst",
        payload: { key: "WI-REFRESH" },
      });
    });
    expect(mocks.getWorkItems).not.toHaveBeenCalled();
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
    await waitFor(
      () => {
        expect(screen.getByTestId("query-state")).toHaveTextContent(
          "project-refresh-item:2",
        );
        expect(screen.getByTestId("detail-query-state")).toHaveTextContent(
          "WI-REFRESH:2",
        );
      },
      { timeout: 1_000 },
    );
    expect(mocks.getWorkItems).toHaveBeenCalledTimes(1);
    // Each independent socket owns its own event deduplication state; both
    // authorized deliveries therefore invalidate the active item query.
    expect(mocks.getWorkItem).toHaveBeenCalledTimes(2);
    expect(mocks.getActivity).not.toHaveBeenCalled();
  });

  it("refreshes visible activity for a committed comment without refetching item detail", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    render(
      <ComposedWorkItemTopics
        projectId="project-comment"
        workItemKey="WI-COMMENT"
      />,
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId("combined-activity-state")).toHaveTextContent(
        "1",
      ),
    );
    const socket = MockWebSocket.instances[0];
    if (!socket) throw new Error("Expected item socket");
    act(() => {
      socket.open();
      socket.frame({
        type: "subscribed",
        topic: "project:project-comment",
      });
      socket.frame({ type: "subscribed", topic: "work_item:WI-COMMENT" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("combined-realtime-state")).toHaveTextContent(
        "available",
      ),
    );
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.state.fetchStatus === "idle"),
      ).toBe(true),
    );
    mocks.getWorkItems.mockClear();
    mocks.getWorkItem.mockClear();
    mocks.getActivity.mockClear();
    mocks.state.activityVersion = 2;
    act(() =>
      socket.frame({
        type: "work_item.commented",
        topic: "project:project-comment",
        eventId: "evt-visible-comment",
        payload: { key: "WI-COMMENT" },
      }),
    );
    await waitFor(
      () =>
        expect(screen.getByTestId("combined-activity-state")).toHaveTextContent(
          "2",
        ),
      { timeout: 1_000 },
    );
    expect(mocks.getActivity).toHaveBeenCalledTimes(1);
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
    expect(mocks.getWorkItems).not.toHaveBeenCalled();
    expect(screen.getByTestId("combined-detail-state")).toHaveTextContent(
      "WI-COMMENT:1",
    );
  });

  it("marks received query keys stale without refetch on cleanup and ignores late frames", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = render(
      <ComposedWorkItemTopics
        projectId="project-cleanup"
        workItemKey="WI-CLEANUP"
      />,
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId("combined-detail-state")).toHaveTextContent(
        "WI-CLEANUP:1",
      ),
    );
    const socket = MockWebSocket.instances[0];
    if (!socket) throw new Error("Expected combined subscription socket");
    act(() => {
      socket.open();
      socket.frame({ type: "subscribed", topic: "project:project-cleanup" });
      socket.frame({ type: "subscribed", topic: "work_item:WI-CLEANUP" });
    });
    await waitFor(() =>
      expect(screen.getByTestId("combined-realtime-state")).toHaveTextContent(
        "available",
      ),
    );
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.state.fetchStatus === "idle"),
      ).toBe(true),
    );
    mocks.getWorkItems.mockClear();
    mocks.getWorkItem.mockClear();
    mocks.getActivity.mockClear();
    invalidate.mockClear();
    act(() =>
      socket.frame({
        type: "work_item.updated",
        topic: "project:project-cleanup",
        eventId: "evt-cleanup-before-debounce",
        payload: { key: "WI-CLEANUP" },
      }),
    );

    view.unmount();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "project-cleanup"],
      refetchType: "none",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "detail", "WI-CLEANUP"],
      refetchType: "none",
    });
    act(() =>
      socket.frame({
        type: "work_item.updated",
        topic: "project:project-cleanup",
        eventId: "evt-late-after-cleanup",
        payload: { key: "WI-CLEANUP" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(mocks.getWorkItems).not.toHaveBeenCalled();
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
    expect(mocks.getActivity).not.toHaveBeenCalled();
    expect(
      client.getQueryState(["work-items", "detail", "WI-CLEANUP"])
        ?.isInvalidated,
    ).toBe(true);
  });

  it("starts the project subscription while the first work-item query is pending", async () => {
    const pendingItems = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockReturnValueOnce(pendingItems.promise);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<ComposedWorkItemList projectId="project-early" realtimeMounted />, {
      wrapper: wrapperFor(client),
    });

    expect(screen.getByTestId("query-state")).toHaveTextContent("loading");
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(queryInterval(client, "project-early")).toBe(30_000);

    const socket = MockWebSocket.instances[0];
    if (!socket) throw new Error("Expected early work-item list socket");
    act(() => socket.onerror?.());
    expect(screen.getByTestId("realtime-state")).toHaveTextContent(
      "unavailable",
    );
    expect(screen.getByTestId("realtime-warning")).toBeInTheDocument();
    expect(queryInterval(client, "project-early")).toBe(30_000);

    pendingItems.resolve(makeResult("project-early-item"));
    await waitFor(() =>
      expect(screen.getByTestId("query-state")).toHaveTextContent(
        "project-early-item",
      ),
    );
    expect(screen.getByTestId("realtime-warning")).toBeInTheDocument();
    expect(queryInterval(client, "project-early")).toBe(30_000);
  });

  it("keeps foreground polling during lazy connection, stops only after subscription acknowledgement, recovers, and cleans up on project switch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = render(
      <ComposedWorkItemList projectId="project-1" realtimeMounted={false} />,
      { wrapper: wrapperFor(client) },
    );

    await waitFor(() =>
      expect(screen.getByTestId("query-state")).toHaveTextContent(
        "project-1-item",
      ),
    );
    expect(queryInterval(client, "project-1")).toBe(30_000);
    expect(MockWebSocket.instances).toHaveLength(0);

    view.rerender(
      <ComposedWorkItemList projectId="project-1" realtimeMounted />,
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const first = MockWebSocket.instances[0];
    if (!first) throw new Error("Expected initial work-item list socket");
    expect(screen.getByTestId("realtime-state")).toHaveTextContent(
      "connecting",
    );
    expect(screen.queryByTestId("realtime-warning")).not.toBeInTheDocument();
    expect(queryInterval(client, "project-1")).toBe(30_000);
    act(() => {
      first.open();
    });
    expect(screen.getByTestId("realtime-state")).toHaveTextContent(
      "connecting",
    );
    act(() => first.frame({ type: "subscribed", topic: "project:project-1" }));
    await waitFor(() =>
      expect(screen.getByTestId("realtime-state")).toHaveTextContent(
        "available",
      ),
    );
    expect(queryInterval(client, "project-1")).toBe(false);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["work-items"] });

    vi.spyOn(Math, "random").mockReturnValue(0);
    act(() => first.close());
    expect(screen.getByTestId("realtime-state")).toHaveTextContent(
      "unavailable",
    );
    expect(screen.getByTestId("realtime-warning")).toBeInTheDocument();
    expect(queryInterval(client, "project-1")).toBe(30_000);

    await new Promise((resolve) => setTimeout(resolve, 550));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const recovered = MockWebSocket.instances[1];
    if (!recovered) throw new Error("Expected reconnect work-item list socket");
    act(() => recovered.open());
    expect(screen.getByTestId("realtime-state")).toHaveTextContent(
      "unavailable",
    );
    act(() =>
      recovered.frame({ type: "subscribed", topic: "project:project-1" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("realtime-state")).toHaveTextContent(
        "available",
      ),
    );
    expect(queryInterval(client, "project-1")).toBe(false);
    expect(screen.queryByTestId("realtime-warning")).not.toBeInTheDocument();

    mocks.getWorkItems.mockClear();
    act(() =>
      first.frame({
        type: "work_item.updated",
        topic: "project:project-1",
        eventId: "evt-late-from-replaced-socket",
        payload: { key: "project-1-item" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 175));
    expect(mocks.getWorkItems).not.toHaveBeenCalled();

    const secondProject = deferred<WorkItemsResult>();
    mocks.getWorkItems.mockImplementation((projectId: string) =>
      projectId === "project-2"
        ? secondProject.promise
        : Promise.resolve(makeResult(`${projectId}-item`)),
    );
    view.rerender(
      <ComposedWorkItemList projectId="project-2" realtimeMounted />,
    );
    expect(recovered.closed).toBe(true);
    expect(screen.getByTestId("realtime-state")).toHaveTextContent(
      "connecting",
    );
    expect(screen.queryByTestId("realtime-warning")).not.toBeInTheDocument();
    expect(screen.getByTestId("query-state")).toHaveTextContent("loading");
    expect(queryInterval(client, "project-2")).toBe(30_000);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(3));
    const projectTwoSocket = MockWebSocket.instances[2];
    if (!projectTwoSocket) throw new Error("Expected project-two socket");
    act(() => projectTwoSocket.open());
    expect(projectTwoSocket.sent).toContain(
      JSON.stringify({ type: "subscribe", topic: "project:project-2" }),
    );
    act(() =>
      projectTwoSocket.frame({
        type: "subscribed",
        topic: "project:project-2",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("realtime-state")).toHaveTextContent(
        "available",
      ),
    );

    secondProject.resolve(makeResult("project-2-item"));
    await waitFor(() =>
      expect(screen.getByTestId("query-state")).toHaveTextContent(
        "project-2-item",
      ),
    );
    expect(screen.getByTestId("query-state")).not.toHaveTextContent(
      "project-1-item",
    );
  });

  it("keeps detail polling while connecting and shows its shared outage state only after a transport failure", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(<ComposedWorkItemDetail workItemKey="W-1" />, {
      wrapper: wrapperFor(client),
    });

    await waitFor(() =>
      expect(screen.getByTestId("detail-query-state")).toHaveTextContent("W-1"),
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    if (!socket) throw new Error("Expected detail realtime socket");
    expect(screen.getByTestId("detail-realtime-state")).toHaveTextContent(
      "connecting",
    );
    expect(
      screen.queryByTestId("detail-realtime-warning"),
    ).not.toBeInTheDocument();
    expect(detailQueryInterval(client, "W-1")).toBe(30_000);

    act(() => socket.open());
    expect(screen.getByTestId("detail-realtime-state")).toHaveTextContent(
      "connecting",
    );
    expect(
      screen.queryByTestId("detail-realtime-warning"),
    ).not.toBeInTheDocument();
    act(() => socket.frame({ type: "subscribed", topic: "work_item:W-1" }));
    await waitFor(() =>
      expect(screen.getByTestId("detail-realtime-state")).toHaveTextContent(
        "available",
      ),
    );
    expect(detailQueryInterval(client, "W-1")).toBe(false);

    act(() => socket.close());
    expect(screen.getByTestId("detail-realtime-state")).toHaveTextContent(
      "unavailable",
    );
    expect(screen.getByTestId("detail-realtime-warning")).toBeInTheDocument();
    expect(detailQueryInterval(client, "W-1")).toBe(30_000);
  });
});
