import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import ProjectsPage from "./projects-page";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  mutate: vi.fn(),
  projects: [] as Array<Record<string, unknown>>,
  canArchive: true,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    params,
    ...props
  }: React.PropsWithChildren<{
    params: { projectKey: string };
    to: string;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    className?: string;
  }>) => (
    <a {...props} href={`/agent/projects/${params.projectKey}`}>
      {children}
    </a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "workspace:projects.actions") return "Actions";
      return translate(key, options);
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({
    children,
    headerActions,
  }: React.PropsWithChildren<{ headerActions?: React.ReactNode }>) => (
    <main>
      {headerActions}
      {children}
    </main>
  ),
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: () => null,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: mocks.projects, isLoading: false }),
}));
vi.mock("@/hooks/mutations/project/use-reorder-projects", () => ({
  default: () => vi.fn(),
}));
vi.mock("@/hooks/mutations/project/use-restore-project", () => ({
  default: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => true,
    canUpdateProjects: () => true,
    canArchiveProjects: () => mocks.canArchive,
  }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useRegisterShortcuts: () => {},
  getModifierKeyText: () => "⌘",
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  mocks.projects = [];
  mocks.canArchive = true;
  vi.clearAllMocks();
});

const deletedProject = {
  id: "project-deleted",
  workspaceId: "workspace-1",
  slug: "OLD",
  icon: "Layout",
  name: "Old project",
  description: null,
  defaultCommentVisibility: "internal",
  kind: "project",
  health: null,
  supportLevel: null,
  serviceCalendarId: null,
  parentId: null,
  ownerTeamId: null,
  managerId: null,
  startDate: null,
  endDate: null,
  defaultAssigneeId: null,
  organisationId: null,
  createdBy: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  archivedAt: null,
  deletedAt: "2026-10-20T00:00:00.000Z",
  purgeAfter: "2026-11-19T00:00:00.000Z",
  position: 0,
  lastTaskNumber: 4,
  statistics: { completionPercentage: 0, totalTasks: 0, dueDate: null },
  archivedTasks: [],
  plannedTasks: [],
  columns: [],
};

describe("ProjectsPage recovery mode", () => {
  it("shows a separate visible project-tree progress aggregate when supplied", () => {
    mocks.projects = [
      {
        ...deletedProject,
        deletedAt: null,
        purgeAfter: null,
        statistics: {
          completionPercentage: 20,
          totalTasks: 5,
          dueDate: null,
        },
        descendantStatistics: {
          completionPercentage: 75,
          totalTasks: 8,
          dueDate: null,
        },
      },
    ];

    render(<ProjectsPage workspaceId="workspace-1" />);

    expect(
      screen.getByTestId("project-visible-tree-progress"),
    ).toHaveTextContent(
      `${translate("workspace:projects.visibleTreeStatistics")}: 75% · 8`,
    );
    expect(
      screen.getByTestId("project-visible-tree-progress").parentElement,
    ).toBeInTheDocument();
  });

  it("names every progress bar and gives the page one h1 (axe aria-progressbar-name, page-has-heading-one)", () => {
    mocks.projects = [
      {
        ...deletedProject,
        name: "Customer Support Desk",
        deletedAt: null,
        purgeAfter: null,
        statistics: { completionPercentage: 13, totalTasks: 8, dueDate: null },
        descendantStatistics: {
          completionPercentage: 40,
          totalTasks: 10,
          dueDate: null,
        },
      },
    ];

    render(<ProjectsPage workspaceId="workspace-1" />);

    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    for (const bar of bars) expect(bar).toHaveAccessibleName();
    expect(
      screen.getByRole("progressbar", {
        name: translate("workspace:projects.completion", {
          name: "Customer Support Desk",
        }),
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("shows deleted projects without opening them and offers the authorized restore action", async () => {
    mocks.projects = [deletedProject];
    const onRecoveryModeChange = vi.fn();
    render(
      <ProjectsPage
        workspaceId="workspace-1"
        recoveryMode
        onRecoveryModeChange={onRecoveryModeChange}
      />,
    );

    expect(
      screen.getByTestId("workspace-projects-recovery"),
    ).toBeInTheDocument();
    expect(screen.getByText("Old project")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Old project" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { id: "project-deleted" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: translate("workspace:projects.showActive"),
      }),
    );
    expect(onRecoveryModeChange).toHaveBeenCalledWith(false);
  });

  it("offers no restore to a caller without project:archive, even with project update (A8-2)", async () => {
    mocks.projects = [deletedProject];
    mocks.canArchive = false;
    render(
      <ProjectsPage
        workspaceId="workspace-1"
        recoveryMode
        onRecoveryModeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Old project")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  });

  it("offers recovery from the active list", async () => {
    render(
      <ProjectsPage
        workspaceId="workspace-1"
        onRecoveryModeChange={(showDeleted) =>
          mocks.navigate({
            to: "/agent",
            search: { recovery: showDeleted ? "deleted" : undefined },
          })
        }
      />,
    );

    // U-14: the header offers it from sm up; on phones it sits in the page (here the empty
    // state), so the breadcrumb keeps its room as in Kaneo.
    const [headerEntry, phoneEntry] = screen.getAllByRole("button", {
      name: "Recently deleted",
    });
    expect(headerEntry).toHaveClass("hidden", "sm:inline-flex");
    expect(phoneEntry).toHaveClass("sm:hidden");
    expect(phoneEntry.parentElement).toHaveAttribute(
      "data-slot",
      "empty-content",
    );
    fireEvent.click(phoneEntry);
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/agent",
        search: { recovery: "deleted" },
      });
    });
    mocks.navigate.mockClear();
    fireEvent.click(headerEntry);
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: "/agent",
        search: { recovery: "deleted" },
      });
    });
  });
});

describe("ProjectsPage engagement kind (S5)", () => {
  const delivery = {
    ...deletedProject,
    id: "project-delivery",
    slug: "BUILD",
    name: "Portal build",
    deletedAt: null,
    purgeAfter: null,
  };
  const managed = {
    ...delivery,
    id: "project-managed",
    slug: "ACME",
    name: "Acme support",
    kind: "managed_service",
    supportLevel: "L2",
    position: 1,
  };

  it("provides a named scroll region and a canonical link while preserving row navigation", () => {
    mocks.projects = [delivery];
    render(<ProjectsPage workspaceId="workspace-1" />);
    const region = screen.getByRole("region", {
      name: translate("workspace:projects.pageTitle"),
    });
    expect(
      region.querySelector('[data-slot="scroll-area-viewport"]'),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Portal build" });
    expect(link).toHaveAttribute("href", "/agent/projects/BUILD");
    link.focus();
    expect(link).toHaveFocus();
    fireEvent.click(link, { ctrlKey: true });
    expect(mocks.navigate).not.toHaveBeenCalled();
    const row = link.closest("tr");
    expect(row).not.toBeNull();
    if (!row) throw new Error("Project link has no row");
    fireEvent.click(row);
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/projects/$projectKey",
      params: { projectKey: "BUILD" },
    });
  });

  it("badges managed services and leaves delivery projects unbadged", () => {
    mocks.projects = [delivery, managed];
    render(<ProjectsPage workspaceId="workspace-1" />);
    const badges = screen.getAllByTestId("project-kind-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent(
      translate("workspace:projects.managedServiceBadge"),
    );
    expect(badges[0].closest("tr")).toHaveTextContent("Acme support");
  });

  it("puts Recently deleted beside the kind filter on phones, out of the header (U-14)", () => {
    mocks.projects = [delivery, managed];
    const onRecoveryModeChange = vi.fn();
    render(
      <ProjectsPage
        workspaceId="workspace-1"
        onRecoveryModeChange={onRecoveryModeChange}
      />,
    );
    const [headerEntry, phoneEntry] = screen.getAllByRole("button", {
      name: translate("workspace:projects.showDeleted"),
    });
    expect(headerEntry).toHaveClass("hidden", "sm:inline-flex");
    expect(phoneEntry).toHaveClass("shrink-0", "sm:hidden");
    const row = phoneEntry.parentElement;
    expect(row).toHaveClass("lg:hidden");
    expect(
      row?.querySelector('[data-testid="project-kind-filter-mobile"]'),
    ).not.toBeNull();
    fireEvent.click(phoneEntry);
    expect(onRecoveryModeChange).toHaveBeenCalledWith(true);
  });

  it("shows only the filtered kind and hands filter changes to the URL owner", async () => {
    mocks.projects = [delivery, managed];
    const onKindFilterChange = vi.fn();
    render(
      <ProjectsPage
        workspaceId="workspace-1"
        kindFilter="managed_service"
        onKindFilterChange={onKindFilterChange}
      />,
    );
    expect(screen.getByText("Acme support")).toBeInTheDocument();
    expect(screen.queryByText("Portal build")).toBeNull();

    fireEvent.click(screen.getByTestId("project-kind-filter"));
    const option = await screen.findByRole("option", {
      name: translate("workspace:projects.kindAll"),
    });
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() =>
      expect(onKindFilterChange).toHaveBeenCalledWith(undefined),
    );
  });

  it("explains an empty filtered list and offers every kind again", () => {
    mocks.projects = [delivery];
    const onKindFilterChange = vi.fn();
    render(
      <ProjectsPage
        workspaceId="workspace-1"
        kindFilter="managed_service"
        onKindFilterChange={onKindFilterChange}
      />,
    );
    expect(screen.getByTestId("projects-kind-empty")).toHaveTextContent(
      translate("workspace:projects.filteredEmptyTitle"),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("workspace:projects.showAllKinds"),
      }),
    );
    expect(onKindFilterChange).toHaveBeenCalledWith(undefined);
  });

  it("filters in memory when no URL owner is given (legacy dashboard route)", async () => {
    mocks.projects = [delivery, managed];
    render(<ProjectsPage workspaceId="workspace-1" />);
    expect(screen.getByText("Portal build")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-kind-filter"));
    const option = await screen.findByRole("option", {
      name: translate("workspace:projects.kindManagedService"),
    });
    fireEvent.pointerDown(option);
    fireEvent.mouseDown(option);
    fireEvent.pointerUp(option);
    fireEvent.mouseUp(option);
    fireEvent.click(option);
    await waitFor(() => expect(screen.queryByText("Portal build")).toBeNull());
    expect(screen.getByText("Acme support")).toBeInTheDocument();
  });
});
