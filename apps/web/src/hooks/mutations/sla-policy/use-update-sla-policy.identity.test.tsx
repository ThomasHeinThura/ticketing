import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  IdentityQueryProvider,
  retireIdentity,
} from "@/query-client/identity-boundary";
import { useUpdateSlaPolicy } from "./use-update-sla-policy";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/sla-policy", () => ({ updateSlaPolicy: update }));

it("drops a delayed SLA save after the identity changes", async () => {
  let release!: (value: {
    id: string;
    workspaceId: string;
    name: string;
  }) => void;
  update.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <IdentityQueryProvider client={client}>{children}</IdentityQueryProvider>
  );
  const { result } = renderHook(() => useUpdateSlaPolicy(), { wrapper });
  act(() => result.current.mutate({ id: "p1", version: 1, data: {} }));
  await waitFor(() => expect(release).toBeDefined());
  act(() => retireIdentity(client));
  await act(async () => {
    release({ id: "p1", workspaceId: "w1", name: "A private policy" });
  });
  expect(client.getQueryData(["sla-policy", "p1"])).toBeUndefined();
});
