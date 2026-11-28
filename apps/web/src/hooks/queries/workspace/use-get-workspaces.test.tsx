import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/workspace/get-workspaces", () => ({ default: fetcher }));

import useGetWorkspaces from "./use-get-workspaces";

it("does not re-render a data-only caller while the list refetches", async () => {
  const list = [{ id: "workspace-1", name: "Support" }];
  fetcher.mockResolvedValue(list);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let renders = 0;
  const { result } = renderHook(
    () => {
      renders += 1;
      return useGetWorkspaces().data;
    },
    { wrapper },
  );
  await waitFor(() => expect(result.current).toEqual(list));
  const settled = renders;

  let resolve: (value: unknown) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
  await act(async () => {
    void client.refetchQueries({ queryKey: ["workspaces"] });
  });
  await act(async () => resolve(list));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(renders).toBe(settled);
});
