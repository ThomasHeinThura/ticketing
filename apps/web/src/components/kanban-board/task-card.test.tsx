import { CSS } from "@dnd-kit/utilities";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useProjectStore from "@/store/project";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  toggleSelection: vi.fn(),
}));

afterEach(() => {
  cleanup();
  useProjectStore.getState().setProject(undefined);
  vi.clearAllMocks();
});

vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: { role: "button", tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: { Transform: { toString: vi.fn(() => undefined) } },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@taskdesk/ui", () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: passthrough,
    AlertDialogClose: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
    Button: passthrough,
    HoverCard: passthrough,
    HoverCardContent: passthrough,
    HoverCardTrigger: passthrough,
  };
});

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/store/bulk-selection", () => ({
  default: (
    selector: (state: {
      toggleSelection: typeof mocks.toggleSelection;
      selectedTaskIds: Set<string>;
      focusedTaskId: string | null;
    }) => unknown,
  ) =>
    selector({
      toggleSelection: mocks.toggleSelection,
      selectedTaskIds: new Set(),
      focusedTaskId: null,
    }),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => ({
    showAssignees: false,
    showPriority: false,
    showDueDates: false,
    showLabels: false,
    showTaskNumbers: false,
    showTaskItemCounts: false,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task = {
  id: "task-1",
  title: "Keyboard task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
} as const satisfies Task;

function renderTaskCard() {
  render(
    <TaskCard
      task={task}
      workspaceId="workspace-1"
      workspaceUsers={undefined}
      onContextMenuTask={mocks.openContextMenu}
    />,
  );
  return screen.getByText("Keyboard task").closest('[role="button"]');
}

describe("TaskCard keyboard context menu", () => {
  it("G10: opens the focused card menu with Shift+F10", () => {
    const card = renderTaskCard();

    expect(card).not.toBeNull();
    fireEvent.keyDown(card as HTMLElement, { key: "F10", shiftKey: true });

    expect(mocks.openContextMenu).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("G10: opens the focused card menu with the ContextMenu key", () => {
    const card = renderTaskCard();

    expect(card).not.toBeNull();
    fireEvent.keyDown(card as HTMLElement, { key: "ContextMenu" });

    expect(mocks.openContextMenu).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("ignores unrelated project replacements but responds to project slug changes", async () => {
    const project = {
      id: "project-1",
      name: "Project",
      slug: "PRJ",
      icon: null,
      description: null,
      workspaceId: "workspace-1",
      columns: [],
      archivedTasks: [],
      plannedTasks: [],
    } as NonNullable<ReturnType<typeof useProjectStore.getState>["project"]>;
    useProjectStore.getState().setProject(project);
    const transformToString = vi.mocked(CSS.Transform.toString);
    transformToString.mockClear();

    renderTaskCard();
    expect(transformToString).toHaveBeenCalledOnce();

    transformToString.mockClear();
    act(() =>
      useProjectStore.getState().setProject({ ...project, columns: [] }),
    );
    expect(transformToString).not.toHaveBeenCalled();

    act(() =>
      useProjectStore.getState().setProject({ ...project, slug: "NEW" }),
    );
    expect(transformToString).toHaveBeenCalledOnce();
  });
});
