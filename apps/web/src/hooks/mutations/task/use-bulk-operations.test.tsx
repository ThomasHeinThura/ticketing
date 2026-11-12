import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectWebSocket } from "@/hooks/use-project-websocket";
import { useBulkOperations } from "./use-bulk-operations";

const bulk = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/task/bulk-operation", () => ({ default: bulk }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
class Socket {
  static OPEN = 1;
  static current: Socket;
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor() {
    Socket.current = this;
  }
  send() {}
  close() {}
  frame(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("legacy bulk refresh", () => {
  it("refreshes the edited task once, and again for another person's event", async () => {
    vi.stubGlobal("WebSocket", Socket);
    bulk.mockResolvedValue({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const detail = vi.fn(async () => ({}));
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(
      () => {
        useQuery({ queryKey: ["task", "task-1"], queryFn: detail });
        useProjectWebSocket("project-1");
        return useBulkOperations();
      },
      { wrapper },
    );
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(1));
    act(() => Socket.current.onopen?.());
    await act(async () => {
      await hook.result.current.bulkPriority({
        taskIds: ["task-1", "task-1"],
        priority: "high",
      });
    });
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(2));
    act(() =>
      Socket.current.frame({
        type: "TASK_UPDATED",
        projectId: "project-1",
        taskId: "task-1",
      }),
    );
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(3));
    hook.unmount();
    client.clear();
  });
});
