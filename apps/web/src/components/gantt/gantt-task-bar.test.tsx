import enUS from "@i18n/en-US.json";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { addDays } from "date-fns";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { CanonicalGanttTaskBar } from "./canonical-gantt-task-bar";
import { GanttTaskBar } from "./gantt-task-bar";

const updateWorkItem = vi.hoisted(() => vi.fn());
const permission = vi.hoisted(() => ({
  isCheckingPermissions: false,
  canUpdate: true,
}));

vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: updateWorkItem,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: permission.isCheckingPermissions,
    canUpdateTasks: () => permission.canUpdate,
  }),
}));
vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const [namespace, path] = key.split(":");
      const source = path
        .split(".")
        .reduce<unknown>(
          (accumulator, part) =>
            (accumulator as Record<string, unknown> | undefined)?.[part],
          (enUS as Record<string, unknown>)[namespace],
        );
      if (typeof source !== "string") return key;
      return source.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? `{{${name}}}`),
      );
    },
  }),
}));

const PIXELS_PER_DAY = 10;
const RANGE_START = new Date(2026, 9, 1);
const days = Array.from({ length: 60 }, (_, index) =>
  addDays(RANGE_START, index),
);
const timeline = {
  days,
  rangeStart: RANGE_START,
  gridTemplateColumns: `repeat(${days.length}, 2.75rem)`,
};

const scheduleStart = new Date(2026, 9, 10);
const scheduleEnd = new Date(2026, 9, 14);
const task = {
  id: "TD-1",
  projectId: "project-1",
  title: "Plan the rollout",
  version: 3,
  startDate: "2026-10-10T09:30:00.000Z",
  dueDate: "2026-10-14T17:45:00.000Z",
  scheduleStart,
  scheduleEnd,
} as unknown as Task & { scheduleStart: Date; scheduleEnd: Date };

function drag(target: HTMLElement, deltaPx: number) {
  fireEvent.pointerDown(target, { clientX: 100, button: 0 });
  window.dispatchEvent(
    new MouseEvent("pointermove", { clientX: 100 + deltaPx }),
  );
  window.dispatchEvent(new MouseEvent("pointerup", { clientX: 100 + deltaPx }));
}

function renderCanonical(onOpenTask = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(
    <CanonicalGanttTaskBar
      workspaceId="workspace-1"
      task={task}
      timeline={timeline}
      pixelsPerDay={PIXELS_PER_DAY}
      onOpenTask={onOpenTask}
    />,
    { wrapper },
  );
  return { onOpenTask };
}

beforeEach(() => {
  updateWorkItem.mockReset();
  updateWorkItem.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "TD-1",
    version: 4,
    startDate: input.startDate,
    dueDate: input.dueDate,
  }));
  permission.isCheckingPermissions = false;
  permission.canUpdate = true;
});

afterEach(() => {
  cleanup();
});

describe("Gantt bar drag and edge resize (VW-29)", () => {
  it("moves both dates by the dragged day count and keeps the stored time", async () => {
    renderCanonical();
    drag(screen.getByRole("button", { name: /Plan the rollout/ }), 30);

    await vi.waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "TD-1",
      version: 3,
      startDate: "2026-10-13T09:30:00.000Z",
      dueDate: "2026-10-17T17:45:00.000Z",
    });
  });

  it("changes only the due date when the right edge is dragged", async () => {
    renderCanonical();
    drag(screen.getByLabelText(enUS.tasks.gantt.resizeDue), 20);

    await vi.waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "TD-1",
      version: 3,
      startDate: "2026-10-10T09:30:00.000Z",
      dueDate: "2026-10-16T17:45:00.000Z",
    });
  });

  it("changes only the start date when the left edge is dragged", async () => {
    renderCanonical();
    drag(screen.getByLabelText(enUS.tasks.gantt.resizeStart), -20);

    await vi.waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "TD-1",
      version: 3,
      startDate: "2026-10-08T09:30:00.000Z",
      dueDate: "2026-10-14T17:45:00.000Z",
    });
  });

  it("never lets the start edge pass the due date", async () => {
    renderCanonical();
    drag(screen.getByLabelText(enUS.tasks.gantt.resizeStart), 500);

    await vi.waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    expect(updateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-10-14T09:30:00.000Z",
        dueDate: "2026-10-14T17:45:00.000Z",
      }),
    );
  });

  it("opens the item instead of saving when the bar is only clicked", () => {
    const { onOpenTask } = renderCanonical();
    drag(screen.getByRole("button", { name: /Plan the rollout/ }), 1);

    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it("does not save a drag that ends on the original day", () => {
    renderCanonical();
    drag(screen.getByLabelText(enUS.tasks.gantt.resizeDue), 3);

    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it("does not offer drag or resize without the update capability", () => {
    permission.canUpdate = false;
    const { onOpenTask } = renderCanonical();

    expect(screen.getByLabelText(enUS.tasks.gantt.resizeDue)).toBeDisabled();
    expect(screen.getByLabelText(enUS.tasks.gantt.resizeStart)).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Plan the rollout/ }));
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it("is read-only while permissions are still being checked", () => {
    permission.isCheckingPermissions = true;
    renderCanonical();

    expect(screen.getByLabelText(enUS.tasks.gantt.resizeDue)).toBeDisabled();
  });

  it("restores the original dates when the save is refused", async () => {
    updateWorkItem.mockRejectedValueOnce(new Error("conflict"));
    renderCanonical();
    const bar = screen.getByRole("button", { name: /Plan the rollout/ });
    drag(bar, 30);

    await vi.waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    // The bar is drawn from the unchanged task again, so a retry starts from the old span.
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Plan the rollout/ }).parentElement
          ?.style.gridColumn,
      ).toBe("10 / 15"),
    );
  });
});

describe("GanttTaskBar delegates to the supplied saver", () => {
  it("reports the moved range through onDatesChange", async () => {
    const onDatesChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttTaskBar
        task={task}
        timeline={timeline}
        pixelsPerDay={PIXELS_PER_DAY}
        onOpenTask={vi.fn()}
        onDatesChange={onDatesChange}
      />,
    );
    drag(screen.getByRole("button", { name: /Plan the rollout/ }), -20);

    await vi.waitFor(() => expect(onDatesChange).toHaveBeenCalledTimes(1));
    const [start, end] = onDatesChange.mock.calls[0] as [Date, Date];
    expect(start.getDate()).toBe(8);
    expect(end.getDate()).toBe(12);
  });
});
