import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { WorkItemRow } from "@/types/work-item";
import loadVirtualizedSortableList from "./load-virtualized-sortable-list";
import loadWorkItemInlineFields from "./load-work-item-inline-fields";
import WorkItemKaneoList from "./work-item-kaneo-list";

beforeAll(async () => {
  await Promise.all([
    loadVirtualizedSortableList(),
    loadWorkItemInlineFields(),
  ]);
});

/** G11 work list: an unchanged row must skip when the list re-renders around it. */
const probe = vi.hoisted(() => ({
  renders: new Map<string, number>(),
  // Production react-i18next returns a stable `t`; a fresh one per call would defeat memo.
  t: (key: string) => key,
  navigate: vi.fn(),
  states: {
    data: [{ id: "open", name: "Open", group: "started" }],
    isError: false,
    isLoading: false,
  },
}));
vi.mock("@/components/list-view/task-row", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/list-view/task-row")>();
  return {
    default: (props: React.ComponentProps<typeof actual.default>) => {
      probe.renders.set(
        props.task.id,
        (probe.renders.get(props.task.id) ?? 0) + 1,
      );
      return <actual.default {...props} />;
    },
  };
});
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canRankTasks: () => false,
    canTransitionTasks: () => false,
    canCreateTasks: () => false,
  }),
}));
vi.mock("@/hooks/use-project-view-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/use-project-view-preference")
  >()),
  useProjectViewPreference: () => ({ value: undefined, set: vi.fn() }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => probe.navigate,
}));
vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: () => probe.states,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: probe.t }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("./work-item-list", () => ({ default: () => null }));
vi.mock("./work-item-inline-fields", () => ({
  default: ({
    children,
  }: {
    children: (slots: Record<string, ReactNode>) => ReactNode;
  }) => children({}),
}));

function item(number: number): WorkItemRow {
  return {
    id: `id-${number}`,
    key: `WLP-${number}`,
    number,
    projectId: "project-1",
    workspaceId: "workspace-1",
    typeId: "type-1",
    requesterId: null,
    parentId: null,
    customerVisibility: "private",
    archivedAt: null,
    deletedAt: null,
    stateCategory: "started",
    title: `Title ${number}`,
    description: null,
    stateId: "open",
    stateName: "open",
    priority: null,
    assigneeId: null,
    assigneeName: null,
    position: String(number),
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    version: 1,
    unavailableFields: [],
  };
}

const items = [1, 2, 3, 4].map(item);
const onOpenItem = vi.fn();
const onSelectionChange = vi.fn();
type Props = Partial<React.ComponentProps<typeof WorkItemKaneoList>>;

function list(props: Props = {}) {
  const element = (next: Props = {}) => (
    <WorkItemKaneoList
      projectId="project-1"
      workspaceId="workspace-1"
      workItems={items}
      hasPartialFailure={false}
      isLoading={false}
      isError={false}
      sort="key"
      dir="asc"
      onSortChange={vi.fn()}
      onRetry={vi.fn()}
      canBulkAssign
      selectedKeys={[]}
      onSelectionChange={onSelectionChange}
      onOpenItem={onOpenItem}
      {...props}
      {...next}
    />
  );
  const view = render(element());
  return {
    rerender: (next: Props) => act(() => view.rerender(element(next))),
  };
}

const total = () => [...probe.renders.values()].reduce((a, b) => a + b, 0);

beforeEach(() => probe.renders.clear());
afterEach(cleanup);

describe("work list row render cost (G11)", () => {
  it("renders every row once on mount", () => {
    list();
    expect(probe.renders.size).toBe(4);
    expect(total()).toBe(4);
  });

  it("re-renders no row for an unrelated parent render or a copied item array", () => {
    const view = list();
    probe.renders.clear();
    view.rerender({ hasMore: true, onLoadMore: vi.fn(), onRetry: vi.fn() });
    expect(total()).toBe(0);
    view.rerender({ workItems: [...items] });
    expect(total()).toBe(0);
  });

  it("re-renders only the row whose selection changed", () => {
    const view = list();
    probe.renders.clear();
    view.rerender({ selectedKeys: ["WLP-3"] });
    expect([...probe.renders.keys()]).toEqual(["id-3"]);
    expect(total()).toBe(1);
  });

  it("re-renders only the row whose item changed", () => {
    const view = list();
    probe.renders.clear();
    view.rerender({
      workItems: items.map((row) =>
        row.number === 2 ? { ...row, title: "Renamed", version: 2 } : row,
      ),
    });
    expect([...probe.renders.keys()]).toEqual(["id-2"]);
    expect(total()).toBe(1);
  });

  it("re-renders a skipped row on a parent render once its due-date badge changes", () => {
    const dueAt = Date.UTC(2026, 10, 28, 10, 30);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(dueAt - 3 * 86_400_000 - 60_000);
    const dated = items.map((row) =>
      row.number === 2
        ? { ...row, dueDate: new Date(dueAt).toISOString() }
        : row,
    );
    const view = list({ workItems: dated });
    probe.renders.clear();
    view.rerender({ hasMore: true });
    expect(total()).toBe(0);
    vi.setSystemTime(dueAt - 3 * 86_400_000 + 60_000);
    view.rerender({ hasMore: false });
    expect([...probe.renders.keys()]).toEqual(["id-2"]);
    vi.useRealTimers();
  });
});
