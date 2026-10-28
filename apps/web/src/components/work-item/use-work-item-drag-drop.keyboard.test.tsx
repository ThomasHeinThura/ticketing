import {
  closestCorners,
  DndContext,
  DragOverlay,
  type KeyboardCoordinateGetter,
  type KeyboardSensorOptions,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkItemRow } from "@/types/work-item";
import useWorkItemDragDrop from "./use-work-item-drag-drop";
import { sortableKeyboardCoordinatesWithVirtualRows } from "./virtualization/sortable-keyboard-coordinates";
import {
  SynchronousKeyboardSensor,
  VisibleTargetKeyboardSensor,
} from "./virtualization/synchronous-keyboard-sensor";

const mocks = vi.hoisted(() => ({
  rank: vi.fn(),
  offers: vi.fn(),
  transition: vi.fn(),
  children: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/fetchers/work-item/rank-work-item", () => ({
  default: (...args: unknown[]) => mocks.rank(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => mocks.offers(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => mocks.transition(...args),
}));
vi.mock("@/fetchers/work-item/get-hierarchy-children", () => ({
  getHierarchyChildren: (...args: unknown[]) => mocks.children(...args),
}));

const rows = Array.from({ length: 200 }, (_, index) => ({
  id: `item-${index + 1}`,
  key: `HELP-${index + 1}`,
  projectId: "project",
  workspaceId: "workspace",
  typeId: "type",
  number: index + 1,
  title: `Work ${index + 1}`,
  description: null,
  stateId: "open",
  stateName: "Open",
  stateCategory: "started",
  priority: null,
  position: String(index + 1),
  assigneeId: null,
  assigneeName: null,
  requesterId: null,
  parentId: null,
  customerVisibility: "private",
  unavailableFields: [],
  archivedAt: null,
  deletedAt: null,
  startDate: null,
  dueDate: null,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
  version: 1,
})) satisfies WorkItemRow[];

const coordinateTrace: Array<{
  code: string;
  activeId: string | null;
  activeIndex: number | null;
  overId: string | null;
  overIndex: number | null;
  collisionIds: string[];
  currentCoordinates: { x: number; y: number };
  collisionRect: { left: number; top: number } | null;
  targetId: string | null;
  targetRect: { left: number; top: number } | null;
  result: { x: number; y: number } | null;
}> = [];
const listOverTrace: string[] = [];

function rect(top: number) {
  return {
    x: 100,
    y: top,
    top,
    left: 100,
    right: 400,
    bottom: top + 72,
    width: 300,
    height: 72,
    toJSON: () => ({}),
  } as DOMRect;
}

function SortableRow({ item, index }: { item: WorkItemRow; index: number }) {
  const sortable = useSortable({ id: item.id });
  return (
    <div
      {...sortable.attributes}
      {...sortable.listeners}
      ref={(node) => {
        sortable.setNodeRef(node);
      }}
      data-testid="keyboard-sortable-row"
      data-row-id={item.id}
      data-virtual-item-id={item.id}
      data-index={index}
      style={{ height: 72 }}
    >
      {item.key}
    </div>
  );
}

function KeyboardHarness() {
  const drag = useWorkItemDragDrop({
    projectId: "project",
    states: [{ id: "open", name: "Open" }],
    workItems: rows,
    canRank: true,
    canTransition: false,
  });
  const sensors = drag.sensors.map((descriptor) => {
    if (
      descriptor.sensor !== SynchronousKeyboardSensor &&
      descriptor.sensor !== VisibleTargetKeyboardSensor
    )
      return descriptor;
    const options = descriptor.options as KeyboardSensorOptions;
    const original: KeyboardCoordinateGetter | undefined =
      options.coordinateGetter;
    if (!original) return descriptor;
    return {
      ...descriptor,
      options: {
        ...options,
        coordinateGetter: ((event, args) => {
          const activeSortable = args.context.active?.data.current?.sortable;
          const overSortable = args.context.over?.data.current?.sortable;
          const collisionId = args.context.collisions?.[0]?.id;
          const collisionSortable = collisionId
            ? args.context.droppableContainers.get(collisionId)?.data.current
                ?.sortable
            : undefined;
          const currentSortable =
            collisionSortable?.containerId === activeSortable?.containerId
              ? collisionSortable
              : overSortable?.containerId === activeSortable?.containerId
                ? overSortable
                : activeSortable;
          const step = event.code === "ArrowDown" ? 1 : -1;
          const targetId =
            currentSortable?.items[(currentSortable?.index ?? 0) + step];
          const targetRect = targetId
            ? args.context.droppableRects.get(targetId)
            : undefined;
          const result = original(event, args);
          coordinateTrace.push({
            code: event.code,
            activeId: args.context.active
              ? String(args.context.active.id)
              : null,
            activeIndex: activeSortable?.index ?? null,
            overId: args.context.over ? String(args.context.over.id) : null,
            overIndex: overSortable?.index ?? null,
            collisionIds: (args.context.collisions ?? []).map((collision) =>
              String(collision.id),
            ),
            currentCoordinates: args.currentCoordinates,
            collisionRect: args.context.collisionRect
              ? {
                  left: args.context.collisionRect.left,
                  top: args.context.collisionRect.top,
                }
              : null,
            targetId: targetId ? String(targetId) : null,
            targetRect: targetRect
              ? { left: targetRect.left, top: targetRect.top }
              : null,
            result: result ? { x: result.x, y: result.y } : null,
          });
          return result;
        }) satisfies KeyboardCoordinateGetter,
      },
    };
  });
  return (
    <DndContext
      sensors={sensors}
      onDragStart={drag.startDrag}
      onDragEnd={drag.endDrag}
      onDragCancel={drag.cancelDrag}
    >
      <SortableContext
        items={rows.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div data-testid="virtualized-keyboard-window" style={{ height: 400 }}>
          {rows.slice(0, 10).map((item, index) => (
            <SortableRow key={item.id} item={item} index={index} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function VirtualizedListSortableRow({
  item,
  index,
}: {
  item: WorkItemRow;
  index: number;
}) {
  const sortable = useSortable({ id: item.id });
  const height = index === 2 ? 60 : 45;
  return (
    <fieldset
      {...sortable.attributes}
      {...sortable.listeners}
      ref={sortable.setNodeRef}
      data-task-id={item.id}
      data-row-id={item.id}
      data-row-index={index}
      style={{ height }}
    >
      {item.key}
    </fieldset>
  );
}

function VirtualizedListKeyboardHarness({
  viewportHeight = 838,
}: {
  viewportHeight?: number;
} = {}) {
  const drag = useWorkItemDragDrop({
    projectId: "project",
    states: [{ id: "open", name: "Open" }],
    workItems: rows,
    canRank: true,
    canTransition: false,
    surface: "list",
  });
  const sensors = drag.sensors.map((descriptor) => {
    if (
      descriptor.sensor !== SynchronousKeyboardSensor &&
      descriptor.sensor !== VisibleTargetKeyboardSensor
    )
      return descriptor;
    const options = descriptor.options as KeyboardSensorOptions;
    const original: KeyboardCoordinateGetter | undefined =
      options.coordinateGetter;
    if (!original) return descriptor;
    return {
      ...descriptor,
      options: {
        ...options,
        coordinateGetter: ((event, args) => {
          const result = original(event, args);
          coordinateTrace.push({
            code: event.code,
            activeId: args.context.active
              ? String(args.context.active.id)
              : null,
            activeIndex:
              args.context.active?.data.current?.sortable?.index ?? null,
            overId: args.context.over ? String(args.context.over.id) : null,
            overIndex: args.context.over?.data.current?.sortable?.index ?? null,
            collisionIds: (args.context.collisions ?? []).map((collision) =>
              String(collision.id),
            ),
            currentCoordinates: args.currentCoordinates,
            collisionRect: args.context.collisionRect
              ? {
                  left: args.context.collisionRect.left,
                  top: args.context.collisionRect.top,
                }
              : null,
            targetId: null,
            targetRect: null,
            result: result ? { x: result.x, y: result.y } : null,
          });
          return result;
        }) satisfies KeyboardCoordinateGetter,
      },
    };
  });
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      modifiers={[snapCenterToCursor]}
      onDragStart={drag.startDrag}
      onDragOver={(event) => {
        if (event.over) listOverTrace.push(String(event.over.id));
      }}
      onDragEnd={drag.endDrag}
      onDragCancel={drag.cancelDrag}
    >
      <SortableContext
        items={rows.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          data-testid="list-scroll-container"
          data-viewport-height={viewportHeight}
          ref={(node) => {
            if (!node) return;
            Object.defineProperty(node, "scrollHeight", {
              configurable: true,
              value: 9871,
            });
            Object.defineProperty(node, "clientHeight", {
              configurable: true,
              value: viewportHeight,
            });
            Object.defineProperty(node, "scrollTop", {
              configurable: true,
              writable: true,
              value: 0,
            });
          }}
          style={{ height: viewportHeight, overflowY: "auto" }}
        >
          <div
            data-virtualized-list="true"
            style={{ position: "relative", height: rows.length * 45 }}
          >
            {rows.slice(0, 8).map((item, index) => (
              <div
                key={item.id}
                data-index={index}
                data-virtual-item-id={item.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${index < 3 ? index * 45 : 135 + (index - 3) * 45}px)`,
                }}
              >
                <VirtualizedListSortableRow item={item} index={index} />
              </div>
            ))}
          </div>
        </div>
      </SortableContext>
      <DragOverlay>
        {drag.dragged ? (
          <div
            data-testid="list-drag-overlay"
            style={{ width: 200, height: 34 }}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function BasicSortable({ id }: { id: string }) {
  const sortable = useSortable({ id });
  return (
    <div
      {...sortable.attributes}
      {...sortable.listeners}
      ref={sortable.setNodeRef}
      data-row-id={id}
      data-testid={`sortable-${id}`}
    >
      {id}
    </div>
  );
}

function CrossColumnKeyboardHarness() {
  const [overId, setOverId] = useState("");
  const sensors = useSensors(
    useSensor(SynchronousKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinatesWithVirtualRows,
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter"],
        cancel: ["Escape"],
      },
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      onDragOver={(event) => setOverId(String(event.over?.id ?? ""))}
    >
      <div>
        <SortableContext
          items={["source"]}
          strategy={verticalListSortingStrategy}
        >
          <BasicSortable id="source" />
        </SortableContext>
        <SortableContext
          items={["target"]}
          strategy={verticalListSortingStrategy}
        >
          <BasicSortable id="target" />
        </SortableContext>
      </div>
      <output data-testid="cross-column-over">{overId}</output>
    </DndContext>
  );
}

function KeyboardGroup({ id, items }: { id: string; items: string[] }) {
  const { setNodeRef } = useDroppable({
    id: `group:${id}`,
    data: { type: "group", group: id },
  });
  return (
    <div ref={setNodeRef} data-keyboard-group={id}>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <BasicSortable key={item} id={item} />
        ))}
      </SortableContext>
    </div>
  );
}

function GroupedKeyboardHarness() {
  const [overId, setOverId] = useState("");
  const sensors = useSensors(
    useSensor(SynchronousKeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinatesWithVirtualRows,
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter"],
        cancel: ["Escape"],
      },
    }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragOver={(event) => setOverId(String(event.over?.id ?? ""))}
    >
      <KeyboardGroup id="urgent" items={["source", "same-group-neighbor"]} />
      <KeyboardGroup id="high" items={["target", "target-next"]} />
      <KeyboardGroup id="empty" items={[]} />
      <output data-testid="grouped-keyboard-over">{overId}</output>
    </DndContext>
  );
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  coordinateTrace.length = 0;
  listOverTrace.length = 0;
  mocks.rank.mockReset().mockResolvedValue({});
  mocks.offers.mockReset().mockResolvedValue([]);
  mocks.transition.mockReset().mockResolvedValue({});
  mocks.children
    .mockReset()
    .mockResolvedValue({ data: [], progress: { total: 0, completed: 0 } });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (
        this instanceof HTMLElement &&
        this.dataset.testid === "list-scroll-container"
      ) {
        const height = Number(this.dataset.viewportHeight) || 838;
        return {
          x: 241,
          y: 53,
          top: 53,
          left: 241,
          right: 1431,
          bottom: 53 + height,
          width: 1190,
          height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (
        this instanceof HTMLElement &&
        this.dataset.testid === "list-drag-overlay"
      )
        return {
          x: 241,
          y: 375,
          top: 375,
          left: 241,
          right: 441,
          bottom: 409,
          width: 200,
          height: 34,
          toJSON: () => ({}),
        } as DOMRect;
      const id = (this as HTMLElement).dataset?.rowId;
      const rowIndex = Number((this as HTMLElement).dataset?.rowIndex);
      if (Number.isFinite(rowIndex) && rowIndex >= 0) {
        const top =
          rowIndex < 3 ? 375 + rowIndex * 45 : 510 + (rowIndex - 3) * 45;
        const height = rowIndex === 2 ? 60 : 45;
        return {
          x: 241,
          y: top,
          top,
          left: 241,
          right: 1431,
          bottom: top + height,
          width: 1190,
          height,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (id === "target")
        return { ...rect(0), x: 420, left: 420, right: 720 } as DOMRect;
      if (id === "target-next")
        return { ...rect(80), x: 420, left: 420, right: 720 } as DOMRect;
      if (id === "same-group-neighbor")
        return { ...rect(80), x: 102, left: 102, right: 402 } as DOMRect;
      const bucket = (this as HTMLElement).dataset?.keyboardGroup;
      if (bucket === "urgent")
        return {
          x: 100,
          y: 0,
          top: 0,
          left: 100,
          right: 400,
          bottom: 300,
          width: 300,
          height: 300,
          toJSON: () => ({}),
        } as DOMRect;
      if (bucket === "high")
        return {
          x: 420,
          y: 0,
          top: 0,
          left: 420,
          right: 720,
          bottom: 300,
          width: 300,
          height: 300,
          toJSON: () => ({}),
        } as DOMRect;
      if (bucket === "empty")
        return {
          x: 740,
          y: 0,
          top: 0,
          left: 740,
          right: 1040,
          bottom: 300,
          width: 300,
          height: 300,
          toJSON: () => ({}),
        } as DOMRect;
      if (id === "source") return rect(0);
      if (id?.startsWith("item-"))
        return rect((Number(id.slice("item-".length)) - 1) * 72);
      return originalRect.call(this);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function keyOnActive(key: string, code: string) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement))
    throw new Error("no focused sortable row");
  await act(async () => {
    fireEvent.keyDown(active, { key, code });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("moves through mounted virtual neighbors with real keyboard sensors and ranks the selected neighbor once", async () => {
  render(<KeyboardHarness />, { wrapper: Wrapper });
  const first = await screen.findByText("HELP-1");
  expect(screen.getAllByTestId("keyboard-sortable-row")).toHaveLength(10);

  first.focus();
  await keyOnActive(" ", "Space");
  await keyOnActive("ArrowDown", "ArrowDown");
  await waitFor(() =>
    expect(document.querySelector('[data-row-id="item-2"]')).toBeTruthy(),
  );
  await keyOnActive("ArrowDown", "ArrowDown");
  await keyOnActive("ArrowUp", "ArrowUp");
  await keyOnActive(" ", "Space");

  await waitFor(() => expect(mocks.rank).toHaveBeenCalledOnce());
  expect(mocks.rank).toHaveBeenCalledWith({
    key: "HELP-1",
    beforeId: "item-2",
    afterId: "item-3",
  });
});

it("commits rapid body-targeted arrows before the immediate keyboard drop", async () => {
  render(<KeyboardHarness />, { wrapper: Wrapper });
  const first = await screen.findByText("HELP-1");
  first.focus();

  // Let the real KeyboardSensor attach its document listener after Space.
  await keyOnActive(" ", "Space");

  act(() => {
    fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowUp", code: "ArrowUp" });
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
  });

  await waitFor(() => expect(mocks.rank).toHaveBeenCalledOnce());
  expect(
    coordinateTrace.map(
      ({
        code,
        overId,
        collisionIds,
        targetId,
        currentCoordinates,
        result,
      }) => ({
        code,
        overId,
        collisionIds,
        targetId,
        currentY: currentCoordinates.y,
        resultY: result?.y ?? null,
      }),
    ),
  ).toEqual([
    {
      code: "ArrowDown",
      overId: "item-1",
      collisionIds: ["item-1"],
      targetId: "item-2",
      currentY: 0,
      resultY: 72,
    },
    {
      code: "ArrowDown",
      overId: "item-2",
      collisionIds: ["item-2"],
      targetId: "item-3",
      currentY: 72,
      resultY: 144,
    },
    {
      code: "ArrowUp",
      overId: "item-3",
      collisionIds: ["item-3"],
      targetId: "item-2",
      currentY: 144,
      resultY: 72,
    },
  ]);
  expect(mocks.rank).toHaveBeenCalledWith({
    key: "HELP-1",
    beforeId: "item-2",
    afterId: "item-3",
  });
});

it("keeps rapid list moves active with the production overlay and uneven virtual rows", async () => {
  render(<VirtualizedListKeyboardHarness />, { wrapper: Wrapper });
  const scrollContainer = screen.getByTestId("list-scroll-container");
  fireEvent.scroll(scrollContainer);
  const first = await screen.findByText("HELP-1");
  Object.defineProperty(scrollContainer, "scrollTo", {
    configurable: true,
    value: vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") scrollContainer.scrollTop = top;
    }),
  });
  Object.defineProperty(scrollContainer, "scrollBy", {
    configurable: true,
    value: vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") scrollContainer.scrollTop += top;
    }),
  });

  first.focus();
  await keyOnActive(" ", "Space");
  act(() => {
    fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowUp", code: "ArrowUp" });
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
  });

  expect(listOverTrace).toEqual(["item-1", "item-2", "item-3", "item-2"]);
  await waitFor(() => expect(mocks.rank).toHaveBeenCalledOnce());
  expect(mocks.rank).toHaveBeenCalledWith({
    key: "HELP-1",
    beforeId: "item-2",
    afterId: "item-3",
  });
  expect(scrollContainer.scrollTo).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.queryByTestId("list-drag-overlay")).not.toBeInTheDocument(),
  );
});

it("keeps five rapid visible list moves ordered through uneven virtual rows", async () => {
  render(<VirtualizedListKeyboardHarness />, { wrapper: Wrapper });
  const scrollContainer = screen.getByTestId("list-scroll-container");
  fireEvent.scroll(scrollContainer);
  const first = await screen.findByText("HELP-1");
  const scrollTo = vi.fn(({ top }: { top?: number }) => {
    if (typeof top === "number") scrollContainer.scrollTop = top;
  });
  Object.defineProperty(scrollContainer, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(scrollContainer, "scrollBy", {
    configurable: true,
    value: vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") scrollContainer.scrollTop += top;
    }),
  });

  first.focus();
  await keyOnActive(" ", "Space");
  act(() => {
    for (let index = 0; index < 5; index += 1)
      fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "ArrowUp", code: "ArrowUp" });
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });
  });

  expect(listOverTrace).toEqual([
    "item-1",
    "item-2",
    "item-3",
    "item-4",
    "item-5",
    "item-6",
    "item-5",
  ]);
  await waitFor(() => expect(mocks.rank).toHaveBeenCalledOnce());
  expect(mocks.rank).toHaveBeenCalledWith({
    key: "HELP-1",
    beforeId: "item-5",
    afterId: "item-6",
  });
  expect(scrollTo).not.toHaveBeenCalled();
});

it("keeps stock list autoscroll when a keyboard target is outside the viewport", async () => {
  render(<VirtualizedListKeyboardHarness viewportHeight={400} />, {
    wrapper: Wrapper,
  });
  const scrollContainer = screen.getByTestId("list-scroll-container");
  fireEvent.scroll(scrollContainer);
  const first = await screen.findByText("HELP-1");
  const scrollTo = vi.fn(({ top }: { top?: number }) => {
    if (typeof top === "number") scrollContainer.scrollTop = top;
  });
  Object.defineProperty(scrollContainer, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  Object.defineProperty(scrollContainer, "scrollBy", {
    configurable: true,
    value: vi.fn(({ top }: { top?: number }) => {
      if (typeof top === "number") scrollContainer.scrollTop += top;
    }),
  });

  first.focus();
  await keyOnActive(" ", "Space");
  act(() => {
    fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
  });

  expect(scrollTo).toHaveBeenCalledOnce();
  expect(mocks.rank).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.queryByTestId("list-drag-overlay")).not.toBeInTheDocument(),
  );
});

it("cancels with Escape and ignores Enter when idle", async () => {
  render(<KeyboardHarness />, { wrapper: Wrapper });
  const first = await screen.findByText("HELP-1");
  first.focus();
  await keyOnActive("Enter", "Enter");
  expect(mocks.rank).not.toHaveBeenCalled();

  await keyOnActive(" ", "Space");
  await keyOnActive("ArrowDown", "ArrowDown");
  await keyOnActive("Escape", "Escape");
  expect(mocks.rank).not.toHaveBeenCalled();
});

it("keeps cross-column horizontal movement on dnd-kit's sortable getter", async () => {
  render(<CrossColumnKeyboardHarness />);
  const source = screen.getByTestId("sortable-source");
  source.focus();
  await keyOnActive(" ", "Space");
  await keyOnActive("ArrowRight", "ArrowRight");
  await waitFor(() =>
    expect(screen.getByTestId("cross-column-over")).toHaveTextContent("target"),
  );
  await keyOnActive("Escape", "Escape");
});

it("moves horizontally between distinct groups and then follows the new group's vertical order", async () => {
  render(<GroupedKeyboardHarness />);
  const source = screen.getByTestId("sortable-source");
  source.focus();
  await keyOnActive(" ", "Space");
  await keyOnActive("ArrowRight", "ArrowRight");
  await waitFor(() =>
    expect(screen.getByTestId("grouped-keyboard-over")).toHaveTextContent(
      "target",
    ),
  );

  await keyOnActive("ArrowDown", "ArrowDown");
  await waitFor(() =>
    expect(screen.getByTestId("grouped-keyboard-over")).toHaveTextContent(
      "target-next",
    ),
  );

  await keyOnActive("ArrowRight", "ArrowRight");
  await waitFor(() =>
    expect(screen.getByTestId("grouped-keyboard-over")).toHaveTextContent(
      "group:empty",
    ),
  );
  await keyOnActive("Escape", "Escape");
});
