import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  escalate: vi.fn(),
  reopen: vi.fn(),
  rate: vi.fn(),
}));
vi.mock("@/fetchers/portal-request-actions", () => ({
  escalatePortalSubmissionPriority: fake.escalate,
  reopenPortalSubmission: fake.reopen,
  ratePortalSubmission: fake.rate,
}));

import { usePortalRequestActions } from "./use-portal-request-actions";

beforeEach(() => {
  for (const fn of Object.values(fake))
    fn.mockReset().mockResolvedValue({ ref: "HELP-1" });
});

/** Escalate, reopen and rate change the dashboard figures and case rows (finding S4b-1). */
it.each([
  ["escalate", (a: Actions) => a.escalate.mutateAsync("high")],
  ["reopen", (a: Actions) => a.reopen.mutateAsync()],
  ["rate", (a: Actions) => a.rate.mutateAsync({ rating: 5 })],
])(
  "%s refreshes the cached dashboard figures and case lists",
  async (_name, act_) => {
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnMount: false, retry: false } },
    });
    const home = vi.fn().mockResolvedValue({ outstanding: 1 });
    const cases = vi.fn().mockResolvedValue({ cases: [] });
    // Cached but not mounted, as when the customer acts on a case page after visiting `/`.
    await client.prefetchQuery({
      queryKey: ["portal", "customer-a", "home", null],
      queryFn: home,
    });
    await client.prefetchQuery({
      queryKey: ["portal", "customer-a", "cases", { view: "open" }],
      queryFn: cases,
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => usePortalRequestActions("customer-a", "HELP-1"),
      { wrapper },
    );
    await act(async () => {
      await act_(result.current);
    });
    await vi.waitFor(() => expect(home).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(cases).toHaveBeenCalledTimes(2));
  },
);

type Actions = ReturnType<typeof usePortalRequestActions>;
