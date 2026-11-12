import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const get = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({
  client: { workspace: { ":workspaceId": { $get: get } } },
}));

import useGetFullWorkspace from "./use-get-full-workspace";

it("retains 403 on the main workspace read for the access page", async () => {
  get.mockResolvedValue({ ok: false, status: 403 });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(
    () => useGetFullWorkspace({ workspaceId: "w1" }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBeInstanceOf(HttpError);
  expect(result.current.error).toMatchObject({ status: 403 });
});
