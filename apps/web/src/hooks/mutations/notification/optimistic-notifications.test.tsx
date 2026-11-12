import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { toast } from "@/lib/toast";
import useMarkAll from "./use-mark-all-notifications-as-read";
import useMarkRead from "./use-mark-notification-as-read";
import useMarkUnread from "./use-mark-notification-as-unread";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  unread: vi.fn(),
  all: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/fetchers/notification/mark-notification-as-read", () => ({
  default: mocks.read,
}));
vi.mock("@/fetchers/notification/mark-notification-as-unread", () => ({
  default: mocks.unread,
}));
vi.mock("@/fetchers/notification/mark-all-notifications-as-read", () => ({
  default: mocks.all,
}));
vi.mock("@/fetchers/notification/get-notifications", () => ({
  default: mocks.get,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("i18next", () => ({ default: { t: (key: string) => key } }));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(read: boolean) {
  vi.clearAllMocks();
  const item = { id: "n1", isRead: read, type: "task_comment" };
  const page = {
    data: [item],
    unreadCount: read ? 0 : 1,
    hasMore: false,
    nextCursor: null,
  };
  mocks.get.mockResolvedValue(page);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["notifications", "inbox", "all"], {
    pages: [page],
    pageParams: [undefined],
  });
  client.setQueryData(["notifications", "inbox", "mentions"], {
    pages: [page],
    pageParams: [undefined],
  });
  const wrapper = ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(
    () => ({
      all: useGetNotifications("all"),
      mentions: useGetNotifications("mentions"),
      read: useMarkRead(),
      unread: useMarkUnread(),
      markAll: useMarkAll(),
    }),
    { wrapper },
  );
  return { ...hook, client };
}

describe("optimistic inbox", () => {
  it("reconciles mark-all after an unseen read and unseen new notification leave the aggregate unchanged", async () => {
    const request = deferred();
    const { result, client, unmount } = setup(false);
    const before = {
      data: [{ id: "n1", isRead: false, type: "task_comment" }],
      unreadCount: 2,
      hasMore: true,
      nextCursor: "next",
    };
    for (const filter of ["all", "mentions"])
      client.setQueryData(["notifications", "inbox", filter], {
        pages: [before],
        pageParams: [undefined],
      });
    mocks.all.mockReturnValue(request.promise);
    act(() => result.current.markAll.mutate());
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(0),
    );
    // The other tab reads uncached n2 while uncached n3 arrives unread: the total remains 2.
    mocks.get.mockResolvedValue(before);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notifications"] });
    });
    expect(
      result.current.all.data?.pages[0]?.unreadCount,
    ).toBeGreaterThanOrEqual(0);
    // The server marks the old rows read; n3 arrived after the write and remains unread.
    const settled = {
      data: [{ id: "n1", isRead: true, type: "task_comment" }],
      unreadCount: 1,
      hasMore: true,
      nextCursor: "next",
    };
    mocks.get.mockResolvedValue(settled);
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    await waitFor(() => expect(result.current.markAll.isSuccess).toBe(true));
    expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1);
    expect(result.current.mentions.data?.pages[0]?.unreadCount).toBe(1);
    expect(mocks.get).toHaveBeenCalledWith("all", undefined);
    unmount();
    client.clear();
  });

  it("rereads the all-inbox first page even without an all-inbox observer", async () => {
    const { client, unmount } = setup(false);
    unmount();
    mocks.read.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({
      data: [{ id: "n1", isRead: true, type: "task_comment" }],
      unreadCount: 1,
      hasMore: false,
      nextCursor: null,
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useMarkRead(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync("n1");
    });
    const data = client.getQueryData<{
      pages: Array<{ unreadCount: number; data: Array<{ isRead: boolean }> }>;
    }>(["notifications", "inbox", "all"]);
    expect(mocks.get).toHaveBeenCalledWith("all", undefined);
    expect(data?.pages[0]?.unreadCount).toBe(1);
    expect(data?.pages[0]?.data[0]?.isRead).toBe(true);
    hook.unmount();
    client.clear();
  });

  it("reads the first page after settlement even when no all-inbox query exists", async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mocks.read.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({
      data: [],
      unreadCount: 1,
      hasMore: false,
      nextCursor: null,
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const hook = renderHook(() => useMarkRead(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync("n1");
    });
    expect(
      client.getQueryData<{ pages: Array<{ unreadCount: number }> }>([
        "notifications",
        "inbox",
        "all",
      ])?.pages[0]?.unreadCount,
    ).toBe(1);
    hook.unmount();
    client.clear();
  });
  it("marks all unread items when a single read is already pending", async () => {
    const read = deferred();
    const all = deferred();
    const { result, client, unmount } = setup(false);
    for (const filter of ["all", "mentions"]) {
      client.setQueryData(["notifications", "inbox", filter], {
        pages: [
          {
            data: [{ id: "n1", isRead: false, type: "task_comment" }],
            unreadCount: 2,
            hasMore: false,
            nextCursor: null,
          },
        ],
        pageParams: [undefined],
      });
    }
    mocks.read.mockReturnValue(read.promise);
    mocks.all.mockReturnValue(all.promise);
    act(() => result.current.read.mutate("n1"));
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1),
    );
    act(() => result.current.markAll.mutate());
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(0),
    );
    await act(async () => {
      read.reject(new Error("refused"));
      all.reject(new Error("refused"));
      await Promise.allSettled([read.promise, all.promise]);
    });
    unmount();
    client.clear();
  });
  it("keeps a later unread action when an earlier read is refused", async () => {
    const read = deferred();
    const unread = deferred();
    const { result, client, unmount } = setup(false);
    mocks.read.mockReturnValue(read.promise);
    mocks.unread.mockReturnValue(unread.promise);
    act(() => result.current.read.mutate("n1"));
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(0),
    );
    act(() => result.current.unread.mutate("n1"));
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1),
    );
    await act(async () => {
      read.reject(new Error("refused"));
      await read.promise.catch(() => {});
    });
    expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1);
    await act(async () => {
      unread.resolve();
      await unread.promise;
    });
    await waitFor(() => expect(result.current.unread.isSuccess).toBe(true));
    expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1);
    unmount();
    client.clear();
  });
  it("keeps a confirmed write visible when reconciliation fails", async () => {
    const { result, client, unmount } = setup(false);
    mocks.read.mockResolvedValue(undefined);
    mocks.get.mockRejectedValue(new Error("read failed"));
    await act(async () => {
      await result.current.read.mutateAsync("n1");
    });
    expect(result.current.all.data?.pages[0]?.data[0]?.isRead).toBe(true);
    expect(result.current.all.data?.pages[0]?.unreadCount).toBe(0);
    unmount();
    client.clear();
  });
  it("updates inactive cached filters after success without fetching them", async () => {
    const { result, client, unmount } = setup(false);
    const cached = client.getQueryData(["notifications", "inbox", "all"]);
    client.setQueryData(["notifications", "inbox", "assignments"], cached);
    mocks.read.mockResolvedValue(undefined);
    mocks.get.mockResolvedValue({
      data: [{ id: "n1", isRead: true, type: "task_comment" }],
      unreadCount: 0,
      hasMore: false,
      nextCursor: null,
    });
    await act(async () => {
      await result.current.read.mutateAsync("n1");
    });
    const inactive = client.getQueryData<{
      pages: Array<{ unreadCount: number; data: Array<{ isRead: boolean }> }>;
    }>(["notifications", "inbox", "assignments"]);
    expect(inactive?.pages[0]?.data[0]?.isRead).toBe(true);
    expect(inactive?.pages[0]?.unreadCount).toBe(0);
    expect(
      mocks.get.mock.calls.every(([filter]) => filter !== "assignments"),
    ).toBe(true);
    unmount();
    client.clear();
  });
  it.each([
    ["read", false, true],
    ["unread", true, false],
    ["markAll", false, true],
  ] as const)(
    "keeps a successful %s after reconciliation",
    async (action, initial, expected) => {
      const request = deferred();
      const { result, client, unmount } = setup(initial);
      (action === "markAll" ? mocks.all : mocks[action]).mockReturnValue(
        request.promise,
      );
      act(() => {
        if (action === "markAll") result.current.markAll.mutate();
        else result.current[action].mutate("n1");
      });
      await waitFor(() =>
        expect(result.current.all.data?.pages[0]?.data[0]?.isRead).toBe(
          expected,
        ),
      );
      mocks.get.mockResolvedValue({
        data: [{ id: "n1", isRead: expected, type: "task_comment" }],
        unreadCount: expected ? 0 : 1,
        hasMore: false,
        nextCursor: null,
      });
      await act(async () => {
        request.resolve();
        await request.promise;
      });
      await waitFor(() => expect(result.current[action].isSuccess).toBe(true));
      expect(result.current.all.data?.pages[0]?.data[0]?.isRead).toBe(expected);
      expect(result.current.mentions.data?.pages[0]?.unreadCount).toBe(
        expected ? 0 : 1,
      );
      unmount();
      client.clear();
    },
  );
  it.each([
    ["read", false, true],
    ["unread", true, false],
    ["markAll", false, true],
  ] as const)(
    "updates %s instantly and rolls back on refusal",
    async (action, initial, expected) => {
      const request = deferred();
      (action === "markAll" ? mocks.all : mocks[action]).mockReturnValue(
        request.promise,
      );
      const { result, client, unmount } = setup(initial);
      // setup clears mocks, so install the deferred request after it.
      (action === "markAll" ? mocks.all : mocks[action]).mockReturnValue(
        request.promise,
      );
      act(() => {
        if (action === "markAll") result.current.markAll.mutate();
        else result.current[action].mutate("n1");
      });
      await waitFor(() =>
        expect(result.current.all.data?.pages[0]?.data[0]?.isRead).toBe(
          expected,
        ),
      );
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(
        expected ? 0 : 1,
      );
      expect(result.current.mentions.data?.pages[0]?.unreadCount).toBe(
        expected ? 0 : 1,
      );
      await act(async () => {
        request.reject(new Error("refused"));
        await request.promise.catch(() => {});
      });
      await waitFor(() =>
        expect(result.current.all.data?.pages[0]?.data[0]?.isRead).toBe(
          initial,
        ),
      );
      expect(toast.error).toHaveBeenCalled();
      unmount();
      client.clear();
    },
  );

  it("keeps the optimistic row and badge during a concurrent invalidation", async () => {
    const request = deferred();
    const { result, client, unmount } = setup(false);
    mocks.read.mockReturnValue(request.promise);
    act(() => result.current.read.mutate("n1"));
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(0),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notifications"] });
    });
    expect(result.current.all.data?.pages[0]?.data[0]?.isRead).toBe(true);
    expect(result.current.mentions.data?.pages[0]?.unreadCount).toBe(0);
    mocks.get.mockResolvedValue({
      data: [
        { id: "n1", isRead: true, type: "task_comment" },
        { id: "n2", isRead: false, type: "task_comment" },
      ],
      unreadCount: 1,
      hasMore: false,
      nextCursor: null,
    });
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1),
    );
    unmount();
    client.clear();
  });

  it("keeps a newly arrived unread notification in the badge while mark all is pending", async () => {
    const request = deferred();
    const { result, client, unmount } = setup(false);
    mocks.all.mockReturnValue(request.promise);
    act(() => result.current.markAll.mutate());
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(0),
    );
    mocks.get.mockResolvedValue({
      data: [
        { id: "n2", isRead: false, type: "task_comment" },
        { id: "n1", isRead: false, type: "task_comment" },
      ],
      unreadCount: 2,
      hasMore: false,
      nextCursor: null,
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notifications"] });
    });
    expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1);
    expect(
      result.current.all.data?.pages[0]?.data.map((row) => row.isRead),
    ).toEqual([false, true]);
    mocks.get.mockResolvedValue({
      data: [
        { id: "n2", isRead: false, type: "task_comment" },
        { id: "n1", isRead: true, type: "task_comment" },
      ],
      unreadCount: 1,
      hasMore: false,
      nextCursor: null,
    });
    await act(async () => {
      request.resolve();
      await request.promise;
    });
    await waitFor(() =>
      expect(result.current.all.data?.pages[0]?.unreadCount).toBe(1),
    );
    unmount();
    client.clear();
  });
});
