import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as taskItemStatsModule from "@/lib/get-task-item-stats";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard, { type TaskCardProps } from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  openTask: vi.fn(),
}));

const sortableState = vi.hoisted(() => {
  type Snapshot = {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
    setNodeRef: (node: HTMLElement | null) => void;
    transform: null | { x: number; y: number; scaleX: number; scaleY: number };
    transition: string | undefined;
    isDragging: boolean;
  };
  const initialSnapshot: Snapshot = {
    attributes: { role: "button", tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  };
  let snapshot = initialSnapshot;
  const subscribers = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe: (subscriber: () => void) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    setSnapshot: (next: Snapshot) => {
      snapshot = next;
      for (const subscriber of subscribers) subscriber();
    },
    reset: () => {
      snapshot = initialSnapshot;
      for (const subscriber of subscribers) subscriber();
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  sortableState.reset();
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
});

vi.mock("@dnd-kit/sortable", async () => {
  const { useSyncExternalStore } =
    await vi.importActual<typeof import("react")>("react");

  return {
    useSortable: () =>
      useSyncExternalStore(
        sortableState.subscribe,
        sortableState.getSnapshot,
        sortableState.getSnapshot,
      ),
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Avatar, AvatarFallback, AvatarImage, Button } =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
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
    Avatar,
    AvatarFallback,
    AvatarImage,
    Button,
    HoverCard: passthrough,
    HoverCardContent: passthrough,
    HoverCardTrigger: passthrough,
  };
});

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: Object.assign(
    () => ({
      showAssignees: false,
      showPriority: false,
      showDueDates: false,
      showLabels: false,
      showTaskNumbers: false,
      showTaskItemCounts: false,
    }),
    {
      getState: () => ({
        showAssignees: false,
        showPriority: false,
        showDueDates: false,
        showLabels: false,
        showTaskNumbers: false,
        showTaskItemCounts: false,
      }),
    },
  ),
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

function taskCardProps(overrides: Partial<TaskCardProps> = {}): TaskCardProps {
  return {
    task,
    projectSlug: "PRJ",
    taskIsCompleted: false,
    displayPreferences,
    isSelected: false,
    isFocused: false,
    onOpenTask: mocks.openTask,
    t: ((key: string) => key) as unknown as TFunction,
    workspaceId: "workspace-1",
    assignee: undefined,
    onContextMenuTask: mocks.openContextMenu,
    ...overrides,
  };
}

function renderTaskCard(props = taskCardProps()) {
  render(<TaskCard {...props} />);
  return screen.getByText(props.task.title).closest('[role="button"]');
}

const displayPreferences = {
  showAssignees: false,
  showPriority: false,
  showDueDates: false,
  showLabels: false,
  showTaskNumbers: false,
  showTaskItemCounts: false,
};

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

  it("delegates opening the task sheet to the board owner", () => {
    const card = renderTaskCard();

    fireEvent.click(card as HTMLElement);

    expect(mocks.openTask).toHaveBeenCalledExactlyOnceWith("task-1");
  });

  it("keeps modifier-click selection actions connected to the shared store", () => {
    const card = renderTaskCard();
    fireEvent.click(card as HTMLElement, { ctrlKey: true });
    expect(useBulkSelectionStore.getState().selectedTaskIds.has("task-1")).toBe(
      true,
    );
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

  it("does not register a global store listener for each mounted card", () => {
    const subscribe = vi.spyOn(useBulkSelectionStore, "subscribe");
    renderTaskCard();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("renders projected selection and focus state from the board", () => {
    const props = {
      task,
      taskIsCompleted: false,
      workspaceId: "workspace-1",
      assignee: undefined,
      onContextMenuTask: mocks.openContextMenu,
      displayPreferences,
      isSelected: false,
      isFocused: false,
      onOpenTask: mocks.openTask,
      t: ((key: string) => key) as unknown as TFunction,
      projectSlug: "PRJ",
    };
    const view = render(<TaskCard {...props} />);
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).not.toHaveAttribute("data-task-selected", "true");

    view.rerender(<TaskCard {...props} isSelected={true} isFocused={true} />);
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).toHaveAttribute("data-task-selected", "true");
    expect(
      screen.getByText("Keyboard task").closest('[role="button"]'),
    ).toHaveClass("ring-2");
  });

  it("keeps the label spacing without an empty wrapper when labels are absent", () => {
    const { container } = render(
      <TaskCard
        task={task}
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={{ ...displayPreferences, showLabels: true }}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        workspaceId="workspace-1"
        assignee={undefined}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );

    expect(
      container.querySelectorAll('.group > [class~="mb-2.5"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('.kanban-board-task-card > [class*="gap-1.5"]'),
    ).toBeNull();
    expect(screen.getByText("Keyboard task")).toBeInTheDocument();
  });

  it("exposes the pull request state in the single pull request action name", () => {
    const pullRequestTask = {
      ...task,
      externalLinks: [
        {
          id: "pr-1",
          externalId: "42",
          url: "https://github.com/example/project/pull/42",
          resourceType: "pull_request",
          metadata: { draft: true },
          title: "Draft change",
        },
      ],
    } as unknown as Task;
    render(
      <TaskCard
        task={pullRequestTask}
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={displayPreferences}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        workspaceId="workspace-1"
        assignee={undefined}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "tasks:pr.draft pull request #42",
      }),
    ).toBeInTheDocument();
  });

  it("preserves the visible no-priority marker when priority display is enabled", () => {
    const { container } = render(
      <TaskCard
        task={task}
        projectSlug="PRJ"
        taskIsCompleted={false}
        displayPreferences={{ ...displayPreferences, showPriority: true }}
        isSelected={false}
        isFocused={false}
        onOpenTask={mocks.openTask}
        t={((key: string) => key) as unknown as TFunction}
        workspaceId="workspace-1"
        assignee={undefined}
        onContextMenuTask={mocks.openContextMenu}
      />,
    );

    const metadataRow = container.querySelector(
      '.kanban-board-task-card > [class*="gap-1.5"]',
    );
    expect(metadataRow).not.toBeNull();
    expect(metadataRow?.querySelector("svg")).not.toBeNull();
  });
});

describe("TaskCard memoized body", () => {
  it("reuses card content when sortable state changes while keeping its root live", () => {
    const getTaskItemStats = vi.spyOn(taskItemStatsModule, "getTaskItemStats");
    const props = taskCardProps({
      task: { ...task, description: "- [ ] child task" } as Task,
      displayPreferences: {
        ...displayPreferences,
        showTaskItemCounts: true,
      },
    });
    render(<TaskCard {...props} />);

    expect(getTaskItemStats).toHaveBeenCalledExactlyOnceWith(
      "- [ ] child task",
    );
    const root = screen.getByText("Keyboard task").closest("[data-task-id]");
    expect(root).toHaveAttribute("role", "button");

    act(() => {
      sortableState.setSnapshot({
        attributes: {
          role: "button",
          tabIndex: 0,
          "aria-roledescription": "sortable task",
        },
        listeners: {},
        setNodeRef: vi.fn(),
        transform: { x: 12, y: 8, scaleX: 1, scaleY: 1 },
        transition: "transform 200ms ease",
        isDragging: true,
      });
    });

    expect(root).toHaveAttribute("aria-roledescription", "sortable task");
    expect(root).toHaveAttribute("data-task-dragging", "true");
    expect(root).toHaveStyle({ opacity: "0.6" });
    expect((root as HTMLElement).style.transform).toContain("12px");
    expect(getTaskItemStats).toHaveBeenCalledExactlyOnceWith(
      "- [ ] child task",
    );
  });

  it("refreshes memoized content for task, preferences, assignee and locale changes", () => {
    const getTaskItemStats = vi.spyOn(taskItemStatsModule, "getTaskItemStats");
    const initialTask = {
      ...task,
      description: "- [ ] first item",
      externalLinks: [
        {
          id: "pr-1",
          externalId: "42",
          url: "https://github.com/example/project/pull/42",
          resourceType: "pull_request",
          metadata: { draft: true },
          title: "Draft change",
        },
      ],
      userId: "user-1",
    } as unknown as Task;
    const props = taskCardProps({
      task: initialTask,
      displayPreferences: {
        ...displayPreferences,
        showAssignees: true,
        showTaskNumbers: true,
        showTaskItemCounts: true,
      },
      assignee: {
        user: { name: "Ada", image: "/ada.png" },
      } as TaskCardProps["assignee"],
      t: ((key: string) => `en:${key}`) as unknown as TFunction,
    });
    const view = render(<TaskCard {...props} />);

    expect(screen.getByText("PRJ-1")).toBeInTheDocument();
    expect(screen.getByText("0/1")).toBeInTheDocument();
    expect(screen.getByText("AD")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "en:tasks:pr.draft pull request #42",
      }),
    ).toBeInTheDocument();

    const nextTask = {
      ...initialTask,
      title: "Updated keyboard task",
      number: 2,
      description: "- [x] first item\n- [ ] second item",
      externalLinks: [
        {
          ...initialTask.externalLinks?.[0],
          id: "pr-2",
          externalId: "99",
          url: "https://github.com/example/project/pull/99",
          metadata: { merged: true },
          title: "Merged change",
        },
      ],
    } as unknown as Task;
    const nextProps = {
      ...props,
      task: nextTask,
      projectSlug: "NEXT",
      displayPreferences: {
        ...props.displayPreferences,
        showPriority: true,
      },
      assignee: {
        user: { name: "Grace", image: "/grace.png" },
      } as TaskCardProps["assignee"],
      t: ((key: string) => `fr:${key}`) as unknown as TFunction,
    };
    view.rerender(<TaskCard {...nextProps} />);

    expect(screen.getByText("Updated keyboard task")).toBeInTheDocument();
    expect(screen.getByText("NEXT-2")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("GR")).toBeInTheDocument();
    const pullRequest = screen.getByRole("button", {
      name: "fr:tasks:pr.merged pull request #99",
    });
    expect(pullRequest).toBeInTheDocument();
    expect(getTaskItemStats).toHaveBeenCalledTimes(2);

    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(pullRequest);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://github.com/example/project/pull/99",
      "_blank",
    );
    expect(mocks.openTask).not.toHaveBeenCalled();
  });

  it("updates due-date status when time advances on a live root rerender", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    const props = taskCardProps({
      task: {
        ...task,
        dueDate: "2026-10-10T12:00:00.000Z",
      } as Task,
      displayPreferences: {
        ...displayPreferences,
        showDueDates: true,
      },
    });
    const view = render(<TaskCard {...props} />);
    const badge = () => screen.getByText("Oct 10").parentElement;

    expect(badge()).toHaveClass("bg-warning/10");

    vi.setSystemTime(new Date("2026-10-12T12:00:00.000Z"));
    view.rerender(<TaskCard {...props} isSelected />);

    expect(badge()).toHaveClass("bg-destructive/10");
  });
});
