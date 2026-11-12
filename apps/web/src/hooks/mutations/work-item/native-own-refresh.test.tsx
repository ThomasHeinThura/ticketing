import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import useCreateWorkItemComment from "./use-create-work-item-comment";
import useRestoreWorkItem from "./use-restore-work-item";

const mocks = vi.hoisted(() => ({ comment: vi.fn(), restore: vi.fn() }));
vi.mock("@/fetchers/work-item/create-work-item-comment", () => ({
  default: mocks.comment,
}));
vi.mock("@/fetchers/work-item/restore-work-item", () => ({
  default: mocks.restore,
}));

describe("own native changes refresh existing observers", () => {
  it("refreshes legacy activity after posting a native comment", async () => {
    mocks.comment.mockResolvedValue({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const activity = vi.fn(async () => []);
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const { result, unmount } = renderHook(
      () => {
        useQuery({ queryKey: ["activities", "task-1"], queryFn: activity });
        return useCreateWorkItemComment();
      },
      { wrapper },
    );
    await waitFor(() => expect(activity).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.mutateAsync({
        key: "WI-1",
        body: {} as never,
        visibility: "internal",
      });
    });
    expect(activity).toHaveBeenCalledTimes(2);
    unmount();
    client.clear();
  });
  it("refreshes both the list and detail after restoring an item", async () => {
    mocks.restore.mockResolvedValue({});
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const list = vi.fn(async () => []);
    const detail = vi.fn(async () => ({}));
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const { result, unmount } = renderHook(
      () => {
        useQuery({ queryKey: ["work-items", "project-1"], queryFn: list });
        useQuery({
          queryKey: ["work-items", "detail", "WI-1"],
          queryFn: detail,
        });
        return useRestoreWorkItem();
      },
      { wrapper },
    );
    await waitFor(() => expect(detail).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.mutateAsync({
        key: "WI-1",
        version: 1,
        projectId: "project-1",
      });
    });
    expect(list).toHaveBeenCalledTimes(2);
    expect(detail).toHaveBeenCalledTimes(2);
    unmount();
    client.clear();
  });
});
