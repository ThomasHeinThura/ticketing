import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import useDecideApproval from "./use-decide-approval";
import useRequestApproval from "./use-request-approval";
import useWithdrawApproval from "./use-withdraw-approval";

vi.mock("@/fetchers/approval/decide-approval", () => ({
  default: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/fetchers/approval/request-approval", () => ({
  requestApproval: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/fetchers/approval/withdraw-approval", () => ({
  default: vi.fn().mockResolvedValue({}),
}));

describe("approval mutations refresh open history", () => {
  it.each(["request", "decide", "withdraw"] as const)(
    "refreshes after %s",
    async (operation) => {
      const client = new QueryClient();
      const key = ["work-items", "audit-history", "HELP-1"];
      client.setQueryData(key, { rows: [] });
      const fetchHistory = vi
        .fn()
        .mockResolvedValue({ rows: [{ id: "event" }] });
      const observer = new QueryObserver(client, {
        queryKey: key,
        queryFn: fetchHistory,
        staleTime: Number.POSITIVE_INFINITY,
      });
      const unsubscribe = observer.subscribe(() => {});
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () => ({
          request: useRequestApproval(),
          decide: useDecideApproval(),
          withdraw: useWithdrawApproval(),
        }),
        { wrapper },
      );
      await act(async () => {
        if (operation === "request")
          await result.current.request.mutateAsync({
            key: "HELP-1",
            body: {} as never,
          });
        if (operation === "decide")
          await result.current.decide.mutateAsync({
            id: "a",
            action: "approve",
          });
        if (operation === "withdraw")
          await result.current.withdraw.mutateAsync({
            id: "a",
            asInstanceAdmin: false,
          });
      });
      await waitFor(() =>
        expect(client.getQueryData(key)).toEqual({ rows: [{ id: "event" }] }),
      );
      expect(fetchHistory).toHaveBeenCalledOnce();
      unsubscribe();
    },
  );
});
