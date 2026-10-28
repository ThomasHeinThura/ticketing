import enUS from "@i18n/en-US.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./calendar";

type SearchRecord = Record<string, unknown>;
type NavigateOptions = {
  to?: string;
  search?: SearchRecord | ((previous: SearchRecord) => SearchRecord);
  replace?: boolean;
  href?: string;
};

const routerState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));
const reschedule = vi.hoisted(() => ({
  mutate: vi.fn(),
  canUpdate: true,
  checking: false,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useParams: () => ({ workspaceId: "workspace-1", projectId: "project-1" }),
    useSearch: () => routerState.search,
  }),
  useNavigate: () => routerState.navigate,
  useLocation: () => ({ searchStr: "?month=2026-10&q=urgent" }),
}));

vi.mock("@/hooks/queries/work-item/use-schedule-project", () => ({
  useScheduleProject: () => ({
    data: {
      id: "project-1",
      name: "Roadmap",
      slug: "RM",
      columns: [],
      plannedTasks: [],
      archivedTasks: [],
    },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/components/work-item/work-item-calendar-reschedule", () => ({
  useRescheduleWorkItem: () => ({ mutate: reschedule.mutate }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: reschedule.checking,
    canUpdateTasks: () => reschedule.canUpdate,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
vi.mock("@taskdesk/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@taskdesk/ui")>()),
  useIsMobile: () => false,
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: { weekStartsOn: number }) => unknown,
  ) => selector({ weekStartsOn: 0 }),
}));
vi.mock("@/hooks/use-keyboard-shortcuts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-keyboard-shortcuts")>()),
  useRegisterShortcuts: () => undefined,
}));
const viewFeature = vi.hoisted(() => ({
  enabled: true as boolean | undefined,
}));
// Locale files are regenerated from i18n/en-US.json by the coordinator; the state itself is
// covered by FeatureOff's own keys.
vi.mock("@/components/agile/feature-off", () => ({
  FeatureOff: ({ feature }: { feature: string }) => (
    <div data-testid={`feature-off-${feature}`} />
  ),
}));
vi.mock("@/hooks/queries/feature-flag/use-project-pages-feature", () => ({
  useProjectFeatureState: () => viewFeature.enabled,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({
    children,
    headerActions,
  }: {
    children: ReactNode;
    headerActions?: ReactNode;
  }) => (
    <div>
      {headerActions}
      {children}
    </div>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
function OpenTaskControl({ onOpen }: { onOpen: () => void }) {
  return (
    // ui-exempt: this test double stands in for the calendar's open-task callback.
    <button type="button" onClick={onOpen}>
      open-task
    </button>
  );
}
function DropBarControl({ onDrop }: { onDrop: () => void }) {
  return (
    // ui-exempt: this test double stands in for a bar dropped on another day.
    <button type="button" onClick={onDrop}>
      drop-bar
    </button>
  );
}
vi.mock("@/components/calendar/month-grid", () => ({
  default: ({
    onOpenTask,
    onReschedule,
  }: {
    onOpenTask: (taskId: string) => void;
    onReschedule?: (task: { id: string }, dayShift: number) => void;
  }) => (
    <>
      <OpenTaskControl onOpen={() => onOpenTask("task-9")} />
      {onReschedule ? (
        <DropBarControl onDrop={() => onReschedule({ id: "RM-1" }, 3)} />
      ) : null}
    </>
  ),
}));
vi.mock("@/components/work-item/work-item-side-pane", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    // ui-exempt: this test double stands in for the task details sheet's close control.
    <button type="button" onClick={onClose}>
      close-sheet
    </button>
  ),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
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

const CalendarRoute = (Route as unknown as { component: ComponentType })
  .component;

function lastNavigation() {
  const options = routerState.navigate.mock.calls.at(
    -1,
  )?.[0] as NavigateOptions;
  const resolved =
    typeof options.search === "function"
      ? options.search(routerState.search)
      : options.search;
  return { options, resolved };
}

beforeEach(() => {
  routerState.search = {
    month: "2026-10",
    q: "urgent",
    status: ["todo"],
    taskId: "task-1",
  };
  routerState.navigate.mockReset();
  reschedule.mutate.mockReset();
  reschedule.canUpdate = true;
  reschedule.checking = false;
});
afterEach(cleanup);

describe("calendar feature flag (P4R1-M2)", () => {
  it("shows the feature-off state instead of the view while the flag is off", () => {
    viewFeature.enabled = false;
    try {
      render(<CalendarRoute />);
      expect(screen.getByTestId("feature-off-calendar")).toBeInTheDocument();
    } finally {
      viewFeature.enabled = true;
    }
  });
});

describe("project calendar route URL state", () => {
  it("reads the month and search from the URL", () => {
    render(<CalendarRoute />);
    expect(screen.getByPlaceholderText("Search tickets...")).toHaveValue(
      "urgent",
    );
    expect(screen.getByText("October 2026")).toBeInTheDocument();
  });

  it("pushes history for month moves and keeps search, filters and selection", () => {
    render(<CalendarRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(options.to).toBe(
      "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
    );
    expect(resolved).toEqual({
      month: "2026-11",
      q: "urgent",
      status: ["todo"],
      taskId: "task-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBeUndefined();
    expect(resolved).toMatchObject({ month: "2026-09", q: "urgent" });
  });

  it("returns to the current month by dropping month and pushes history", () => {
    render(<CalendarRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    const { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(resolved).toEqual({
      q: "urgent",
      status: ["todo"],
      taskId: "task-1",
    });
  });

  it("replaces history for search typing, clearing, and task selection", () => {
    render(<CalendarRoute />);
    fireEvent.change(screen.getByPlaceholderText("Search tickets..."), {
      target: { value: "123" },
    });
    let { options, resolved } = lastNavigation();
    expect(options.replace).toBe(true);
    expect(resolved).toMatchObject({ q: "123", month: "2026-10" });

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("q");

    fireEvent.click(screen.getByText("open-task"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).toMatchObject({ taskId: "task-9", month: "2026-10" });

    fireEvent.click(screen.getByText("close-sheet"));
    ({ options, resolved } = lastNavigation());
    expect(options.replace).toBe(true);
    expect(resolved).not.toHaveProperty("taskId");
    expect(resolved).toMatchObject({ month: "2026-10", q: "urgent" });
  });
});

describe("project calendar drag to another day (VW-26)", () => {
  it("writes a dropped bar's day shift through the reschedule mutation", () => {
    render(<CalendarRoute />);
    fireEvent.click(screen.getByText("drop-bar"));
    expect(reschedule.mutate).toHaveBeenCalledWith(
      { task: { id: "RM-1" }, dayShift: 3 },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("does not make bars draggable without the update capability", () => {
    reschedule.canUpdate = false;
    render(<CalendarRoute />);
    expect(screen.queryByText("drop-bar")).not.toBeInTheDocument();
  });

  it("stays read-only while permissions are still being checked", () => {
    reschedule.checking = true;
    render(<CalendarRoute />);
    expect(screen.queryByText("drop-bar")).not.toBeInTheDocument();
  });
});

describe("project calendar week and day ranges (VW-25)", () => {
  it("switches to the week range through the URL and keeps search, filters and selection", () => {
    render(<CalendarRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    const { options, resolved } = lastNavigation();
    expect(options.replace).toBeUndefined();
    expect(resolved).toMatchObject({
      calendarView: "week",
      q: "urgent",
      status: ["todo"],
      taskId: "task-1",
    });
    expect(resolved).not.toHaveProperty("month");
    expect(typeof resolved?.date).toBe("string");
  });

  it("steps the week range by seven days and names the controls for it", () => {
    routerState.search = { calendarView: "week", date: "2026-10-23" };
    render(<CalendarRoute />);
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(lastNavigation().resolved).toEqual({
      calendarView: "week",
      date: "2026-10-30",
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(lastNavigation().resolved).toEqual({
      calendarView: "week",
      date: "2026-10-16",
    });
  });

  it("steps the day range by one day, returns to today, and goes back to the month", () => {
    routerState.search = { calendarView: "day", date: "2026-10-23" };
    render(<CalendarRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(lastNavigation().resolved).toEqual({
      calendarView: "day",
      date: "2026-10-24",
    });
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(lastNavigation().resolved).toEqual({ calendarView: "day" });
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(lastNavigation().resolved).toEqual({ month: "2026-10" });
  });

  it("does not offer a bar drop in the day range", () => {
    routerState.search = { calendarView: "day", date: "2026-10-23" };
    render(<CalendarRoute />);
    expect(screen.queryByText("drop-bar")).not.toBeInTheDocument();
  });
});
