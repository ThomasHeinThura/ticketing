import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemBoard from "./work-item-board";

/**
 * G11 board budgets: 200 cards must not all re-render for changes that touch none or one of
 * them. Only the card body renders `TaskLabels`, so its call count is the body render count.
 */
const probe = vi.hoisted(() => ({
  bodyRenders: 0,
  dnd: undefined as Record<string, unknown> | undefined,
  sortableItems: [] as unknown[][],
  // Production react-i18next returns a stable `t`; a fresh one per call would defeat memo.
  t: undefined as unknown as (key: string, options?: object) => string,
}));
vi.mock("@/components/kanban-board/task-labels", () => ({
  TaskLabels: () => {
    probe.bodyRenders += 1;
    return null;
  },
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      probe.dnd = props as unknown as Record<string, unknown>;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    SortableContext: (
      props: React.ComponentProps<typeof actual.SortableContext>,
    ) => {
      probe.sortableItems.push(props.items as unknown[]);
      return <actual.SortableContext {...props} />;
    },
  };
});
const rank = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/rank-work-item", () => ({
  default: (...args: unknown[]) => rank(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: vi.fn(),
}));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: vi.fn().mockResolvedValue([]),
}));
vi.mock("react-i18next", async (importOriginal) => {
  probe.t = (key: string, options?: object) =>
    translate(key, options as Record<string, unknown>);
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: () => ({ t: probe.t }),
  };
});

const states = ["s-1", "s-2", "s-3", "s-4"].map((id, index) => ({
  id,
  name: `State ${index + 1}`,
}));
const label = { id: "label-1", name: "Bug", color: "red" };
const items: WorkItemRow[] = states.flatMap((state, column) =>
  Array.from({ length: 50 }, (_, index) => {
    const number = column * 50 + index + 1;
    return {
      id: `id-${number}`,
      projectId: "proj_1",
      key: `BRD-${number}`,
      number,
      title: `Card ${number}`,
      stateId: state.id,
      stateName: state.name,
      priority: null,
      assigneeId: null,
      assigneeName: null,
      position: String(index + 1).padStart(3, "0"),
      labels: [label],
      unavailableFields: [],
    } as unknown as WorkItemRow;
  }),
);

type BoardProps = Partial<Parameters<typeof WorkItemBoard>[0]>;
const onRetry = vi.fn();
const onLoadMore = vi.fn();
const onSelectionChange = vi.fn();
const onOpenItem = vi.fn();

function board(props: BoardProps = {}) {
  const client = new QueryClient();
  const element = (next: BoardProps = {}): ReactNode => (
    <QueryClientProvider client={client}>
      <WorkItemBoard
        projectId="proj_1"
        states={states}
        statesError={false}
        workItems={items}
        isLoading={false}
        isError={false}
        onRetry={onRetry}
        hasMore={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
        canSelect={false}
        canTransition={true}
        canRank={true}
        selectedKeys={[]}
        onSelectionChange={onSelectionChange}
        onOpenItem={onOpenItem}
        {...props}
        {...next}
      />
    </QueryClientProvider>
  );
  const view = render(element());
  return { rerender: (next: BoardProps) => view.rerender(element(next)) };
}

function activator(number: number) {
  const found = document.querySelector<HTMLElement>(
    `[data-task-id="id-${number}"]`,
  );
  if (!found) throw new Error(`no card ${number}`);
  return found;
}

beforeEach(() => {
  useUserPreferencesStore.getState().resetDisplayPreferences();
  useUserPreferencesStore.setState({ showLabels: true });
  rank.mockReset();
  probe.sortableItems = [];
});
afterEach(cleanup);

describe("WorkItemBoard render cost (G11)", () => {
  it("renders every card body once on mount", () => {
    probe.bodyRenders = 0;
    board();
    expect(screen.getAllByTestId("work-item-board-card")).toHaveLength(200);
    expect(probe.bodyRenders).toBe(200);
  });

  it("re-renders no card body for an unrelated board prop change", () => {
    const view = board();
    probe.bodyRenders = 0;
    view.rerender({ hasMore: true });
    expect(probe.bodyRenders).toBe(0);
  });

  it("re-renders at most the one card whose selection changed", () => {
    const view = board({ canSelect: true });
    probe.bodyRenders = 0;
    view.rerender({ canSelect: true, selectedKeys: ["BRD-7"] });
    expect(probe.bodyRenders).toBeLessThanOrEqual(1);
    expect(activator(7).dataset.taskSelected).toBe("true");
  });

  it("re-renders no card body when drag capabilities arrive", () => {
    const view = board({ canTransition: false, canRank: false });
    probe.bodyRenders = 0;
    view.rerender({ canTransition: true, canRank: true });
    expect(probe.bodyRenders).toBe(0);
    expect(activator(1).getAttribute("aria-roledescription")).toBe("sortable");
  });

  it("keeps sensors and per-column sortable ids stable across renders", () => {
    const view = board();
    const sensors = probe.dnd?.sensors;
    const firstItems = probe.sortableItems.slice(-4);
    view.rerender({ hasMore: true });
    expect(probe.dnd?.sensors).toBe(sensors);
    const nextItems = probe.sortableItems.slice(-4);
    expect(nextItems).toHaveLength(4);
    nextItems.forEach((ids, index) => {
      expect(ids).toBe(firstItems[index]);
    });
  });

  it("renders only the overlay body when a keyboard drag starts and moves", () => {
    board();
    const card = activator(1);
    card.focus();
    probe.bodyRenders = 0;
    fireEvent.keyDown(card, { key: " ", code: "Space" });
    expect(screen.getByTestId("work-item-drag-overlay-card")).toBeVisible();
    // The drag overlay mounts one new card body; the 200 board cards stay put.
    expect(probe.bodyRenders).toBe(1);

    probe.bodyRenders = 0;
    fireEvent.keyDown(card, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(card, { key: "ArrowRight", code: "ArrowRight" });
    expect(probe.bodyRenders).toBe(0);

    fireEvent.keyDown(card, { key: "Escape", code: "Escape" });
    expect(probe.bodyRenders).toBe(0);
  });

  it("re-renders at most the dropped card body while a move is saving", async () => {
    let finish!: (value: unknown) => void;
    rank.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    board();
    const callbacks = probe.dnd as Record<string, (event: unknown) => unknown>;
    act(() => {
      callbacks.onDragStart?.({
        active: { id: "id-1" },
        activatorEvent: new MouseEvent("mousedown"),
      });
    });
    probe.bodyRenders = 0;
    let drop!: Promise<unknown>;
    act(() => {
      drop = Promise.resolve(
        callbacks.onDragEnd?.({
          active: { id: "id-1" },
          over: { id: "id-3" },
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rank).toHaveBeenCalledTimes(1);
    // Only the dropped card re-renders (it sits in its new slot and looks pending); the
    // other 199 cards, which only shift position, keep their body.
    expect(probe.bodyRenders).toBeLessThanOrEqual(1);
    probe.bodyRenders = 0;
    await act(async () => {
      finish({});
      await drop;
    });
    expect(probe.bodyRenders).toBe(0);
  });
});
