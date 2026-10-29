import { DndContext } from "@dnd-kit/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import VirtualizedSortableList from "./virtualized-sortable-list";

const observed = vi.hoisted(() => ({
  windows: [] as ReturnType<
    ReturnType<
      typeof import("@tanstack/react-virtual").useVirtualizer
    >["getVirtualItems"]
  >[],
  current: undefined as
    | undefined
    | Pick<
        ReturnType<typeof import("@tanstack/react-virtual").useVirtualizer>,
        "resizeItem" | "getVirtualItems" | "getTotalSize"
      >,
}));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (...args: Parameters<typeof actual.useVirtualizer>) => {
      const virtualizer = actual.useVirtualizer(...args);
      observed.current = virtualizer;
      observed.windows.push(virtualizer.getVirtualItems());
      return virtualizer;
    },
  };
});
afterEach(() => {
  cleanup();
  observed.windows = [];
  observed.current = undefined;
  vi.restoreAllMocks();
});

it("retains real measurements on unrelated renders and recomputes for changed ids", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(640);
  const items = Array.from({ length: 500 }, (_, index) => ({
    id: `item-${index}`,
  }));
  const getItemId = (item: { id: string }) => item.id;
  const renderItem = (item: { id: string }) => (
    <div key={item.id}>{item.id}</div>
  );
  const viewFor = (rows: typeof items, label: string) => (
    <DndContext>
      <VirtualizedSortableList
        items={rows}
        getItemId={getItemId}
        renderItem={renderItem}
        as="div"
        estimateSize={46}
        testId={label}
      />
    </DndContext>
  );
  const view = render(viewFor(items, "first"));
  const initial = observed.windows.at(-1);
  view.rerender(viewFor(items, "second"));
  expect(observed.windows.at(-1)).toBe(initial);
  const reordered = [items[1], items[0], ...items.slice(2)];
  view.rerender(viewFor(reordered, "second"));
  const changed = observed.windows.at(-1);
  if (!changed) throw new Error("Expected virtual window");
  expect(changed).not.toBe(initial);
  expect(changed[0].key).toBe("item-1");
  expect(changed[1].key).toBe("item-0");
  const total = observed.current?.getTotalSize();
  view.rerender(viewFor([{ id: "new" }, ...reordered], "second"));
  expect(observed.windows.at(-1)?.[0].key).toBe("new");
  expect(observed.current?.getTotalSize()).toBe((total ?? 0) + 46);
});

it("updates real measured offsets and visible row content without changing IDs", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(960);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 960,
    height: 640,
    top: 0,
    left: 0,
    right: 960,
    bottom: 640,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const items = Array.from({ length: 500 }, (_, index) => ({
    id: `item-${index}`,
    title: `Title ${index}`,
  }));
  const getItemId = (item: (typeof items)[number]) => item.id;
  const renderItem = (item: (typeof items)[number]) => (
    <div key={item.id}>{item.title}</div>
  );
  const viewFor = (rows: typeof items) => (
    <DndContext>
      <VirtualizedSortableList
        items={rows}
        getItemId={getItemId}
        renderItem={renderItem}
        as="div"
        estimateSize={46}
      />
    </DndContext>
  );
  const view = render(viewFor(items));
  expect(screen.getByText("Title 0")).toBeInTheDocument();
  const virtualizer = observed.current;
  if (!virtualizer) throw new Error("Expected real virtualizer");
  expect(virtualizer.getVirtualItems()[1].start).toBe(46);
  act(() => virtualizer.resizeItem(0, 90));
  expect(virtualizer.getVirtualItems()[0].size).toBe(90);
  expect(virtualizer.getVirtualItems()[1].start).toBe(90);
  const updated = items.map((item, index) =>
    index === 0 ? { ...item, title: "Updated title" } : item,
  );
  view.rerender(viewFor(updated));
  expect(screen.getByText("Updated title")).toBeInTheDocument();
  expect(virtualizer.getVirtualItems()[1].start).toBe(90);
});
