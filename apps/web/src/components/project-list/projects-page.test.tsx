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
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
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

    fireEvent.click(screen.getByRole("button", { name: "Recently deleted" }));
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
