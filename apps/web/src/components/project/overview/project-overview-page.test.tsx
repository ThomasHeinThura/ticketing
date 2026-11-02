import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProjectOverview: vi.fn(),
  getProjectContract: vi.fn(),
  listMilestones: vi.fn(),
  archiveProject: vi.fn(),
  navigate: vi.fn(),
  canUpdate: true,
  canManage: true,
  canCreate: true,
  closeCreateModal: undefined as undefined | (() => void),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/fetchers/project/archive-project", () => ({
  default: (...args: unknown[]) => mocks.archiveProject(...args),
}));
vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: ({
    open,
    projectId,
    status,
    onClose,
  }: {
    open: boolean;
    projectId?: string;
    status?: string;
    onClose: () => void;
  }) => {
    mocks.closeCreateModal = onClose;
    return open ? (
      <div data-testid="create-task-modal">
        {projectId}:{status}
      </div>
    ) : null;
  },
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => mocks.canUpdate,
    canManageProjectSettings: () => mocks.canManage,
    canCreateTasks: () => mocks.canCreate,
  }),
}));
const project = {
  id: "p1",
  workspaceId: "w1",
  slug: "HELP",
  name: "Help desk",
  status: "on_hold",
  objective: "Run first-line support",
  inScope: null,
  outOfScope: null,
  successCriteria: null,
  statusNote: "Waiting for VPN",
  statusNoteAt: "2026-10-30T10:00:00.000Z",
};
vi.mock("@/hooks/queries/agile/use-project-by-key", () => ({
  default: () => ({ project, workspaceId: "w1", isLoading: false }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: project }),
}));
vi.mock("@/fetchers/project/overview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/project/overview")>()),
  getProjectOverview: (...args: unknown[]) => mocks.getProjectOverview(...args),
  getProjectContract: (...args: unknown[]) => mocks.getProjectContract(...args),
  listMilestones: (...args: unknown[]) => mocks.listMilestones(...args),
}));

import { milestoneStates } from "./milestones-panel";
import { isPastDay, localToday } from "./overview-shared";
import { isPrerequisiteOverdue } from "./prerequisites-page";
import { ProjectOverviewPage } from "./project-overview-page";

function overview(kind: "project" | "managed_service" = "project") {
  return {
    projectId: "p1",
    kind,
    status: "on_hold",
    health: "amber",
    archived: false,
    counts: {
      open: 4,
      breached: 2,
      inProgress: 1,
      waiting: 1,
      done: 2,
      total: 6,
      blockingPrerequisitesOutstanding: 1,
      prerequisites: 3,
    },
    currentMilestone: null,
    overdueMilestoneIds: [],
    compositionWarnings: [],
    facts: {
      customerName: "Acme",
      managerName: "Mia",
      defaultAssigneeName: null,
      supportLevel: kind === "managed_service" ? "L2" : null,
      serviceCalendarName: "Business hours",
      startDate: "2026-01-01",
      endDate: null,
    },
    serviceLevels: {
      policyName: "Gold",
      source: "project",
      goals: [
        {
          metric: "first_response",
          workItemTypeName: "Incident",
          priority: "urgent",
          targetMinutes: 15,
        },
      ],
    },
  };
}

/** Mirrors the app-wide defaults (apps/web/src/query-client) that made the Overview stale. */
function appQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function renderPage(client = appQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ProjectOverviewPage projectKey="HELP" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.canUpdate = true;
  mocks.canManage = true;
  mocks.canCreate = true;
  mocks.archiveProject.mockReset();
  mocks.getProjectOverview.mockReset();
  mocks.getProjectContract.mockReset();
  mocks.closeCreateModal = undefined;
  mocks.navigate.mockReset();
  mocks.getProjectOverview.mockResolvedValue(overview());
  mocks.getProjectContract.mockResolvedValue({
    projectId: "p1",
    contract: null,
    state: "none",
    daysRemaining: null,
    hourBank: null,
    recentEntries: [],
    recentEntriesVisible: true,
  });
  mocks.listMilestones.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("ProjectOverviewPage", () => {
  it("shows the header line, KPIs, attention banner and summary", async () => {
    renderPage();
    const header = await screen.findByTestId("project-overview-header-line");
    expect(header).toHaveTextContent("Acme");
    expect(header).toHaveTextContent("HELP");
    expect(header).toHaveTextContent("kind.project");
    expect(header).toHaveTextContent("status.on_hold");
    expect(header).toHaveTextContent("health.amber");
    expect(header).toHaveTextContent('header.open {"count":4}');
    expect(header).toHaveTextContent('header.breached {"count":2}');
    expect(screen.getByTestId("project-kpi-work")).toHaveTextContent("2/6");
    expect(screen.getByTestId("project-kpi-work")).toHaveTextContent(
      'kpi.workBreakdown {"inProgress":1,"waiting":1}',
    );
    expect(screen.getByTestId("project-overview-attention")).toBeVisible();
    expect(screen.getByTestId("project-summary-panel")).toHaveTextContent(
      "Run first-line support",
    );
    // G4: every dt/dd group is a direct child div of the summary dl.
    const summaryList = screen
      .getByTestId("project-summary-panel")
      .querySelector("dl");
    for (const group of [...(summaryList?.children ?? [])]) {
      expect(group.tagName).toBe("DIV");
      expect([...group.children].map((child) => child.tagName)).toEqual([
        "DT",
        "DD",
      ]);
    }
    // Delivery projects have no service-levels panel.
    expect(screen.queryByTestId("project-service-levels-panel")).toBeNull();
  });

  it("offers the edit controls to staff who may change them", async () => {
    renderPage();
    await screen.findByTestId("project-overview-page");
    expect(screen.getByTestId("project-overview-edit-summary")).toBeVisible();
    expect(screen.getByTestId("project-overview-new-item")).toBeVisible();
    expect(screen.getByTestId("project-overview-more")).toBeVisible();
    expect(await screen.findByTestId("project-contract-edit")).toBeVisible();
    expect(
      within(screen.getByTestId("project-milestones-panel")).getByRole(
        "button",
        { name: /milestones.add/ },
      ),
    ).toBeVisible();
  });

  it("hides every edit control for a viewer", async () => {
    mocks.canUpdate = false;
    mocks.canManage = false;
    mocks.canCreate = false;
    renderPage();
    await screen.findByTestId("project-overview-page");
    await screen.findByText("contract.none");
    expect(screen.queryByTestId("project-overview-actions")).toBeNull();
    expect(screen.queryByTestId("project-overview-edit-summary")).toBeNull();
    expect(screen.queryByTestId("project-overview-new-item")).toBeNull();
    expect(screen.queryByTestId("project-overview-more")).toBeNull();
    expect(screen.queryByTestId("project-contract-edit")).toBeNull();
    expect(
      within(screen.getByTestId("project-milestones-panel")).queryByRole(
        "button",
      ),
    ).toBeNull();
  });

  it("opens the existing create modal for this project from New item", async () => {
    renderPage();
    (await screen.findByTestId("project-overview-new-item")).click();
    expect(await screen.findByTestId("create-task-modal")).toHaveTextContent(
      "p1:to-do",
    );
  });

  it("refreshes the counts when the create modal opened from the Overview closes", async () => {
    renderPage();
    const header = await screen.findByTestId("project-overview-header-line");
    expect(header).toHaveTextContent('header.open {"count":4}');
    expect(mocks.getProjectOverview).toHaveBeenCalledTimes(1);
    mocks.getProjectOverview.mockResolvedValue({
      ...overview(),
      counts: { ...overview().counts, open: 5, total: 7 },
    });
    screen.getByTestId("project-overview-new-item").click();
    await screen.findByTestId("create-task-modal");
    act(() => mocks.closeCreateModal?.());
    await waitFor(() =>
      expect(mocks.getProjectOverview).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByText('header.open {"count":5}', { exact: false }),
    ).toBeVisible();
    expect(screen.getByTestId("project-kpi-work")).toHaveTextContent("2/7");
  });

  it("refetches the overview and contract on every visit despite the app-wide cache defaults", async () => {
    const client = appQueryClient();
    const first = renderPage(client);
    await screen.findByTestId("project-overview-header-line");
    await screen.findByText("contract.none");
    expect(mocks.getProjectOverview).toHaveBeenCalledTimes(1);
    expect(mocks.getProjectContract).toHaveBeenCalledTimes(1);
    // Leave for another tab (Work, time logging) and come back.
    first.unmount();
    renderPage(client);
    await waitFor(() => {
      expect(mocks.getProjectOverview).toHaveBeenCalledTimes(2);
      expect(mocks.getProjectContract).toHaveBeenCalledTimes(2);
    });
  });

  it("offers New item without Archive to a member who may only create", async () => {
    mocks.canUpdate = false;
    mocks.canManage = false;
    renderPage();
    expect(
      await screen.findByTestId("project-overview-new-item"),
    ).toBeVisible();
    expect(screen.queryByTestId("project-overview-edit-summary")).toBeNull();
    expect(screen.queryByTestId("project-overview-more")).toBeNull();
  });

  it("offers no New item or Archive on an archived project", async () => {
    mocks.getProjectOverview.mockResolvedValue({
      ...overview(),
      archived: true,
    });
    renderPage();
    await screen.findByTestId("project-overview-page");
    expect(screen.getByTestId("project-overview-edit-summary")).toBeVisible();
    expect(screen.queryByTestId("project-overview-new-item")).toBeNull();
    expect(screen.queryByTestId("project-overview-more")).toBeNull();
  });

  it("shows read-only service levels for a managed service", async () => {
    mocks.getProjectOverview.mockResolvedValue(overview("managed_service"));
    renderPage();
    const panel = await screen.findByTestId("project-service-levels-panel");
    expect(panel).toHaveTextContent("Incident");
    expect(panel).toHaveTextContent('serviceLevels.minutes {"count":15}');
    expect(within(panel).queryByRole("button")).toBeNull();
    // G4 (axe definition-list / dlitem): one dt/dd group per priority, each a direct
    // child of its dl, and every dd names its own column for assistive technology.
    const group = within(panel).getByTestId("project-service-level-type");
    expect(group).toHaveTextContent("Incident");
    const list = group.querySelector("dl");
    expect(list).not.toBeNull();
    const rows = [...(list?.children ?? [])];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tagName).toBe("DIV");
    expect([...(rows[0]?.children ?? [])].map((cell) => cell.tagName)).toEqual([
      "DT",
      "DD",
      "DD",
    ]);
    expect(rows[0]?.querySelector("dt")).toHaveTextContent(
      "serviceLevels.priorities.urgent",
    );
    expect(rows[0]?.querySelectorAll("dd")[0]).toHaveTextContent(
      'serviceLevels.firstResponse serviceLevels.minutes {"count":15}',
    );
  });

  it("shows the hour bank of a contract", async () => {
    mocks.getProjectContract.mockResolvedValue({
      projectId: "p1",
      contract: {
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        contractedMinutes: 600,
        coverage: "24x7",
        kickoffStatus: "completed",
        kickoffDate: null,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      state: "active",
      daysRemaining: 61,
      hourBank: {
        contractedMinutes: 600,
        usedMinutes: 210,
        remainingMinutes: 390,
        usedPct: 35,
      },
      recentEntries: [
        { id: "e1", date: "2026-10-20", minutes: 90, workItemKey: "HELP-3" },
      ],
      recentEntriesVisible: true,
    });
    renderPage();
    const panel = await screen.findByTestId("project-contract-panel");
    await within(panel).findByText("contract.state.active");
    expect(panel).toHaveTextContent(
      'contract.usedOf {"used":"3.5","contracted":"10"}',
    );
    expect(panel).toHaveTextContent('contract.remaining {"hours":"6.5"}');
    expect(panel).toHaveTextContent("HELP-3");
  });

  it("leaves out the recent entries when the API withholds them (no time_entry:read_any)", async () => {
    mocks.getProjectContract.mockResolvedValue({
      projectId: "p1",
      contract: {
        startDate: "2026-09-01",
        endDate: "2026-12-31",
        contractedMinutes: 600,
        coverage: "24x7",
        kickoffStatus: "completed",
        kickoffDate: null,
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
      state: "active",
      daysRemaining: 61,
      hourBank: {
        contractedMinutes: 600,
        usedMinutes: 210,
        remainingMinutes: 390,
        usedPct: 35,
      },
      recentEntries: [],
      recentEntriesVisible: false,
    });
    renderPage();
    const panel = await screen.findByTestId("project-contract-panel");
    await within(panel).findByText("contract.state.active");
    expect(panel).toHaveTextContent(
      'contract.usedOf {"used":"3.5","contracted":"10"}',
    );
    expect(panel).not.toHaveTextContent("contract.recent");
    expect(panel).not.toHaveTextContent("contract.noRecent");
  });
});

describe("milestoneStates", () => {
  it("marks reached, overdue, the current and upcoming milestones", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const states = milestoneStates(
      [
        {
          id: "a",
          date: "2026-01-01T00:00:00Z",
          reachedAt: "2026-01-02T00:00:00Z",
        },
        { id: "b", date: "2026-05-01T00:00:00Z", reachedAt: null },
        { id: "c", date: "2026-07-01T00:00:00Z", reachedAt: null },
        { id: "d", date: "2026-08-01T00:00:00Z", reachedAt: null },
      ] as never,
      now,
    );
    expect(Object.fromEntries(states)).toEqual({
      a: "reached",
      b: "overdue",
      c: "upcoming",
      d: "upcoming",
    });
    const future = milestoneStates(
      [{ id: "c", date: "2026-07-01T00:00:00Z", reachedAt: null }] as never,
      now,
    );
    expect(future.get("c")).toBe("current");
  });

  it("keeps a milestone due today current for the whole local day", () => {
    // 20:00 local on 5 Nov; the due day is stored as midnight UTC, which is already past
    // as an instant in every zone west of UTC (and, at 20:00, in most zones).
    const evening = new Date(2026, 10, 5, 20, 0);
    const states = milestoneStates(
      [{ id: "m", date: "2026-11-05T00:00:00.000Z", reachedAt: null }] as never,
      evening,
    );
    expect(states.get("m")).toBe("current");
    const nextMorning = new Date(2026, 10, 6, 0, 1);
    expect(
      milestoneStates(
        [
          { id: "m", date: "2026-11-05T00:00:00.000Z", reachedAt: null },
        ] as never,
        nextMorning,
      ).get("m"),
    ).toBe("overdue");
  });
});

describe("due-day helpers", () => {
  it("builds today from the local calendar, not UTC", () => {
    expect(localToday(new Date(2026, 0, 2, 23, 59))).toBe("2026-01-02");
    expect(localToday(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });

  it("treats only days before today as past", () => {
    const now = new Date(2026, 10, 5, 9, 0);
    expect(isPastDay("2026-11-05T00:00:00.000Z", now)).toBe(false);
    expect(isPastDay("2026-11-04T00:00:00.000Z", now)).toBe(true);
    expect(isPastDay("2026-11-06", now)).toBe(false);
  });

  it("marks a prerequisite overdue only after its due day, and never once done", () => {
    const now = new Date(2026, 10, 5, 23, 30);
    const due = (dueDate: string | null, completedAt: string | null = null) =>
      isPrerequisiteOverdue({ dueDate, completedAt } as never, now);
    expect(due("2026-11-05T00:00:00.000Z")).toBe(false);
    expect(due("2026-11-04T00:00:00.000Z")).toBe(true);
    expect(due("2026-11-04T00:00:00.000Z", "2026-11-04T10:00:00.000Z")).toBe(
      false,
    );
    expect(due(null)).toBe(false);
  });
});
