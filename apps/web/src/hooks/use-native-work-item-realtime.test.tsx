import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
        {query.isLoading ? "loading" : (query.data?.key ?? "empty")}
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
  mocks.getWorkItems.mockImplementation(async (projectId: string) =>
    makeResult(`${projectId}-item`),
  );
  mocks.getWorkItem.mockReset();
  mocks.getWorkItem.mockImplementation(async (key: string) => ({ key }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("work-item list realtime composition", () => {
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
