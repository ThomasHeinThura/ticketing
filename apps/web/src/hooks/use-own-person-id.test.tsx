import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@taskdesk/libs", () => ({ apiFetch: fetcher }));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `/api${path}`,
}));

import { useOwnPersonId } from "./use-own-person-id";

function show(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderHook(() => useOwnPersonId(enabled), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
it("reads the caller's own person id from the session identity endpoint", async () => {
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      personId: "person-1",
      user: { id: "u1" },
      credentialType: "session",
    }),
  });
  const { result } = show();
  await waitFor(() => expect(result.current.data).toBe("person-1"));
  expect(fetcher).toHaveBeenCalledWith(
    "/api/me/identity",
    expect.objectContaining({ credentials: "include", cache: "no-store" }),
  );
});
it("rejects a response for a different signed-in user", async () => {
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      personId: "person-2",
      user: { id: "u2" },
      credentialType: "session",
    }),
  });
  const { result } = show();
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});
it("does not infer an identity from a failed or malformed read", async () => {
  fetcher.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ personId: null }),
  });
  const { result } = show();
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data).toBeUndefined();
});
