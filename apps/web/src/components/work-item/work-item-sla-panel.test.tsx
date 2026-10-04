import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkItemSlaPanel from "./work-item-sla-panel";

const getWorkItemSla = vi.hoisted(() => vi.fn());
const useWorkspacePermission = vi.hoisted(() => vi.fn());
const pausePost = vi.hoisted(() => vi.fn());
const resumePost = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/work-item/get-work-item-sla", () => ({
  default: getWorkItemSla,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission,
}));
vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": {
      ":key": {
        sla: {
          pause: { $post: pausePost },
          resume: { $post: resumePost },
        },
      },
    },
  },
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

describe("WorkItemSlaPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows current metric states and explains an open pause", async () => {
    useWorkspacePermission.mockReturnValue({
      canUpdateTasks: () => false,
      isCheckingPermissions: false,
    });
    getWorkItemSla.mockResolvedValue({
      key: "OPS-8",
      startedAt: new Date("2026-10-01T10:00:00.000Z"),
      evaluatedAt: new Date("2026-10-04T10:00:00.000Z"),
      calendarName: "Internal calendar name",
      metrics: [
        {
          metric: "first_response",
          state: "at_risk",
          dueAt: new Date("2026-10-05T10:00:00.000Z"),
          targetMinutes: 480,
          consumedMinutes: 360,
          consumedPct: 75,
          remainingMinutes: 120,
          pause: {
            startedAt: new Date("2026-10-02T10:00:00.000Z"),
            reason: "waiting_customer",
          },
        },
        {
          metric: "resolution",
          state: "ok",
          dueAt: new Date("2026-10-08T10:00:00.000Z"),
          targetMinutes: 2400,
          consumedMinutes: 120,
          consumedPct: 5,
          remainingMinutes: 2280,
          pause: null,
        },
      ],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkItemSlaPanel keyValue="OPS-8" workspaceId="workspace-1" />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId("work-item-sla-first_response"),
    ).toBeVisible();
    expect(screen.getByText("workItems:sla.states.at_risk")).toBeVisible();
    expect(screen.getByText("workItems:sla.states.ok")).toBeVisible();
    expect(screen.getByText("workItems:sla.pausedSince")).toBeVisible();
    expect(screen.getByTestId("work-item-sla-calendar")).toHaveTextContent(
      "workItems:sla.calendar",
    );
    expect(
      screen.queryByRole("button", { name: "workItems:sla.pause" }),
    ).not.toBeInTheDocument();
  });

  it("allows pause and resume, including a manual pause after resolution", async () => {
    useWorkspacePermission.mockReturnValue({
      canUpdateTasks: () => true,
      isCheckingPermissions: false,
    });
    const metric = (
      name: "first_response" | "resolution",
      state: string,
      reason: string | null = null,
    ) => ({
      metric: name,
      state,
      dueAt: null,
      targetMinutes: 60,
      consumedMinutes: 60,
      consumedPct: 100,
      remainingMinutes: 0,
      pause: reason
        ? { startedAt: new Date("2026-10-02T10:00:00.000Z"), reason }
        : null,
    });
    const response = (resolution: ReturnType<typeof metric>) => ({
      key: "OPS-8",
      startedAt: new Date("2026-10-01T10:00:00.000Z"),
      evaluatedAt: new Date("2026-10-04T10:00:00.000Z"),
      calendarName: "Internal calendar name",
      metrics: [metric("first_response", "met"), resolution],
    });
    getWorkItemSla
      .mockResolvedValueOnce(response(metric("resolution", "ok")))
      .mockResolvedValueOnce(response(metric("resolution", "missed", "manual")))
      .mockResolvedValueOnce(response(metric("resolution", "missed")));
    pausePost.mockResolvedValue({ ok: true, json: async () => ({}) });
    resumePost.mockResolvedValue({ ok: true, json: async () => ({}) });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkItemSlaPanel keyValue="OPS-8" workspaceId="workspace-1" />
      </QueryClientProvider>,
    );

    const pauseButton = await screen.findByRole("button", {
      name: "workItems:sla.pause",
    });
    fireEvent.click(pauseButton);
    await waitFor(() => expect(pausePost).toHaveBeenCalledOnce());

    const resumeButton = await screen.findByRole("button", {
      name: "workItems:sla.resume",
    });
    fireEvent.click(resumeButton);
    await waitFor(() => expect(resumePost).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "workItems:sla.resume" }),
      ).not.toBeInTheDocument(),
    );
  });
});
