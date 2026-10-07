import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard, { type TaskCardDisplayPreferences } from "./task-card";

const mocks = vi.hoisted(() => ({
  openContextMenu: vi.fn(),
  openTask: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@taskdesk/ui", async () => {
  const { Badge, Button } =
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
    Badge,
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

function renderTaskCard() {
  render(
    <TaskCard
      task={task}
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
  return screen.getByText("Keyboard task").closest('[role="button"]');
}

const displayPreferences = {
  showAssignees: false,
  showPriority: false,
  showDueDates: false,
  showLabels: false,
  showTaskNumbers: false,
  showTaskItemCounts: false,
};

function renderMetadataTask(
  taskOverrides: Partial<Task> = {},
  preferenceOverrides: Partial<TaskCardDisplayPreferences> = {},
) {
  const currentTask = { ...task, ...taskOverrides } as Task;
  render(
    <TaskCard
      task={currentTask}
      projectSlug="PRJ"
      taskIsCompleted={false}
      displayPreferences={{ ...displayPreferences, ...preferenceOverrides }}
      isSelected={false}
      isFocused={false}
      onOpenTask={mocks.openTask}
      t={((key: string) => key) as unknown as TFunction}
      workspaceId="workspace-1"
      assignee={undefined}
      onContextMenuTask={mocks.openContextMenu}
    />,
  );
  return document.querySelector(".kanban-board-task-card");
}

describe("TaskCard metadata row geometry", () => {
  const staticBadgeCases = [
    {
      label: "priority",
      task: { priority: "high" },
      preferences: { showPriority: true },
    },
    {
      label: "checklist stats",
      task: { description: "- [ ] Check" },
      preferences: { showTaskItemCounts: true },
    },
    {
      label: "due date",
      task: { dueDate: "2099-05-12T00:00:00.000Z" },
      preferences: { showDueDates: true },
    },
    {
      label: "priority and checklist stats",
      task: { priority: "high", description: "- [ ] Check" },
      preferences: { showPriority: true, showTaskItemCounts: true },
    },
    {
      label: "priority and due date",
      task: { priority: "high", dueDate: "2099-05-12T00:00:00.000Z" },
      preferences: { showPriority: true, showDueDates: true },
    },
    {
      label: "checklist stats and due date",
      task: {
        description: "- [ ] Check",
        dueDate: "2099-05-12T00:00:00.000Z",
      },
      preferences: { showTaskItemCounts: true, showDueDates: true },
    },
    {
      label: "all static badges",
      task: {
        priority: "high",
        description: "- [ ] Check",
        dueDate: "2099-05-12T00:00:00.000Z",
      },
      preferences: {
        showPriority: true,
        showTaskItemCounts: true,
        showDueDates: true,
      },
    },
  ] as const;

  it.each(staticBadgeCases)(
    "uses the fixed slot for $label",
    ({ task, preferences }) => {
      const card = renderMetadataTask(task, preferences);
      const metadataRow = card?.querySelector(
        ".kanban-board-metadata-row-skippable",
      );

      expect(metadataRow).toHaveClass("h-5.5");
      expect(metadataRow?.children.length).toBeGreaterThan(0);
      expect(
        [...(metadataRow?.children ?? [])].every((child) =>
          child.classList.contains("h-5.5"),
        ),
      ).toBe(true);
      if ("description" in task) {
        expect(metadataRow).toHaveTextContent("0/1");
      }
      if ("dueDate" in task) {
        expect(
          [...(metadataRow?.children ?? [])].some((child) =>
            child.textContent?.trim(),
          ),
        ).toBe(true);
      }
    },
  );

  it("does not create an empty fixed row when every metadata preference is disabled", () => {
    const card = renderMetadataTask({
      priority: "high",
      description: "- [ ] Check",
      dueDate: "2099-05-12T00:00:00.000Z",
    });

    expect(
      card?.querySelector(".kanban-board-metadata-row-skippable"),
    ).toBeNull();
  });

  it.each([1, 2])(
    "keeps %i pull-request badges out of the fixed slot",
    (count) => {
      const externalLinks = Array.from({ length: count }, (_, index) => ({
        id: `pr-${index + 1}`,
        taskId: task.id,
        externalId: String(index + 1),
        url: `https://github.com/example/project/pull/${index + 1}`,
        resourceType: "pull_request",
        title: null,
        metadata: null,
      }));
      const card = renderMetadataTask({ externalLinks });
      const metadataRow = card?.querySelector(
        '.kanban-board-task-card > [class*="gap-1.5"]',
      );
      const pullRequestButton = card?.querySelector("button");

      expect(metadataRow).not.toHaveClass(
        "kanban-board-metadata-row-skippable",
      );
      expect(metadataRow).not.toHaveClass("h-5.5");
      expect(pullRequestButton).toHaveClass("h-9", "sm:h-8");
      expect(pullRequestButton).toBeVisible();
      if (count === 1) {
        expect(
          screen.getByRole("button", {
            name: "tasks:pr.open pull request #1",
          }),
        ).toBe(pullRequestButton);
      } else {
        expect(screen.getByRole("button", { name: "tasks:pr.count" })).toBe(
          pullRequestButton,
        );
      }
    },
  );

  it("keeps variable title and label rows outside the fixed metadata slot", () => {
    const longTitle = "A variable title ".repeat(30);
    const longLabel = "A long label name ".repeat(8);
    const card = renderMetadataTask(
      {
        title: longTitle,
        labels: [{ id: "label-1", name: longLabel, color: "blue" }],
      },
      {
        showLabels: true,
        showTaskNumbers: true,
        showPriority: true,
      },
    );

    expect(card?.querySelector(".line-clamp-3")?.textContent?.trim()).toBe(
      longTitle.trim(),
    );
    expect(screen.getByText("PRJ-1")).toBeInTheDocument();
    expect(card?.querySelector("[title]")).toHaveAttribute("title", longLabel);
    expect(
      card?.querySelector(".kanban-board-metadata-row-skippable"),
    ).toHaveClass("h-5.5");
    expect(card).not.toHaveClass(
      "h-5.5",
      "kanban-board-metadata-row-skippable",
    );
  });
});

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
