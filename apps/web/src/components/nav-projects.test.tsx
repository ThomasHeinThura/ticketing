import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavProjects } from "./nav-projects";

const mocks = vi.hoisted(() => ({
  canReorder: false,
  dndContext: vi.fn(),
  sortable: vi.fn(),
}));

afterEach(() => {
  cleanup();
  mocks.dndContext.mockClear();
  mocks.sortable.mockClear();
  mocks.canReorder = false;
});

vi.mock("@dnd-kit/core", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    closestCenter: vi.fn(),
    DndContext: ({
      children,
      onDragStart,
    }: {
      children: React.ReactNode;
      onDragStart: (event: { active: { id: string } }) => void;
    }) => {
      mocks.dndContext();
      return (
        <div data-testid="project-dnd-context">
          <button
            type="button"
            data-testid="start-project-drag"
            onClick={() => onDragStart({ active: { id: "project-1" } })}
          >
            Start drag
          </button>
          {children}
        </div>
      );
    },
    DragOverlay: passthrough,
    MouseSensor: class MouseSensor {},
    TouchSensor: class TouchSensor {},
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn((...sensors: unknown[]) => sensors),
  };
});

vi.mock("@dnd-kit/modifiers", () => ({
  restrictToFirstScrollableAncestor: vi.fn(),
  restrictToVerticalAxis: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  arrayMove: vi.fn(),
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="project-sortable-context">{children}</div>
  ),
  useSortable: () => {
    mocks.sortable();
    return {
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    };
  },
  verticalListSortingStrategy: vi.fn(),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn(() => undefined) } },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ workspaceId: "workspace-1", projectId: "project-1" }),
}));

vi.mock("@taskdesk/ui", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  const button = ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  );
  return {
    AlertDialog: passthrough,
    AlertDialogClose: button,
    AlertDialogContent: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
    Button: button,
    Collapsible: passthrough,
    CollapsiblePanel: passthrough,
    CollapsibleTrigger: button,
    DropdownMenu: passthrough,
    DropdownMenuContent: () => null,
    DropdownMenuItem: button,
    DropdownMenuSeparator: () => null,
    DropdownMenuTrigger: button,
    SidebarGroup: passthrough,
    SidebarGroupContent: passthrough,
    SidebarGroupLabel: passthrough,
    SidebarMenu: ({ children }: { children: React.ReactNode }) => (
      <ul>{children}</ul>
    ),
    SidebarMenuButton: button,
    SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
      <li>{children}</li>
    ),
    useSidebar: () => ({ isMobile: false }),
  };
});

vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    ChevronRight: Icon,
    Folder: Icon,
    Forward: Icon,
    MoreHorizontal: Icon,
    Settings: Icon,
    Trash2: Icon,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/mutations/project/use-delete-project", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/project/use-reorder-projects", () => ({
  default: () => vi.fn(),
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [
      {
        id: "project-1",
        name: "Visible Project",
        workspaceId: "workspace-1",
      },
    ],
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateProjects: () => false,
    canDeleteProjects: () => false,
    canUpdateProjects: () => mocks.canReorder,
  }),
}));

vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("./shared/modals/create-project-modal", () => ({
  default: () => null,
}));

describe("NavProjects drag-and-drop setup", () => {
  it("does not mount sortable infrastructure when project reordering is unavailable", () => {
    render(<NavProjects />);

    expect(screen.getByText("Visible Project")).toBeVisible();
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    expect(screen.queryByTestId("project-dnd-context")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("project-sortable-context"),
    ).not.toBeInTheDocument();
    expect(mocks.dndContext).not.toHaveBeenCalled();
    expect(mocks.sortable).not.toHaveBeenCalled();
  });

  it("loads sortable infrastructure when project reordering is authorized", async () => {
    mocks.canReorder = true;

    render(<NavProjects />);

    expect(screen.getByText("Visible Project")).toBeVisible();
    expect(
      await screen.findByTestId("project-dnd-context"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-sortable-context")).toBeInTheDocument();
    expect(mocks.dndContext).toHaveBeenCalledOnce();
    expect(mocks.sortable).toHaveBeenCalledOnce();
  });

  it("cleans up an active drag if reordering capability is revoked", async () => {
    mocks.canReorder = true;
    const { rerender } = render(<NavProjects />);

    (await screen.findByTestId("start-project-drag")).click();
    expect(document.body).toHaveClass("taskdesk-dragging");

    mocks.canReorder = false;
    rerender(<NavProjects />);

    await screen.findByText("Visible Project");
    expect(document.body).not.toHaveClass("taskdesk-dragging");
    expect(screen.queryByTestId("project-dnd-context")).not.toBeInTheDocument();
  });
});
