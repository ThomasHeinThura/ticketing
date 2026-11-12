import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { CycleDetailScreen } from "./cycle-detail";

const mocks = vi.hoisted(() => ({ cycle: vi.fn(), burndown: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => ({ project: undefined, workspaceId: "w1" }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageProjectSettings: () => false }),
}));
vi.mock("./scope-logged-time", () => ({ ScopeLoggedTime: () => null }));
vi.mock("@/fetchers/agile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/agile")>()),
  getCycle: (...args: unknown[]) => mocks.cycle(...args),
  getBurndown: (...args: unknown[]) => mocks.burndown(...args),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("shows a burndown denial while the cycle placeholder is retained", async () => {
  vi.useFakeTimers();
  let resolveCycle!: (value: unknown) => void;
  let rejectBurndown!: (error: Error) => void;
  mocks.cycle.mockReturnValue(
    new Promise((resolve) => {
      resolveCycle = resolve;
    }),
  );
  mocks.burndown.mockReturnValue(
    new Promise((_, reject) => {
      rejectBurndown = reject;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CycleDetailScreen projectKey="HELP" cycleId="c1" search={{}} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  const bucket = { count: 0, points: 0 };
  await act(async () => {
    resolveCycle({
      id: "c1",
      name: "Sprint",
      status: "active",
      startDate: "2026-10-01",
      endDate: "2026-10-15",
      canManage: false,
      canEditItems: false,
      scopeChanges: [],
      summary: {
        unit: "count",
        total: bucket,
        completed: bucket,
        inProgress: bucket,
        notStarted: bucket,
        unestimated: { count: 0, share: 0 },
      },
    });
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(mocks.burndown).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(19);
    rejectBurndown(new HttpError(403, "Denied"));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText("burndown.loadFailed")).toBeVisible();
});
