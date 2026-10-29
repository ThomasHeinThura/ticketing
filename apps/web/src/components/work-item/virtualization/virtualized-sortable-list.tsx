import { useDndContext } from "@dnd-kit/core";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type {
  CSSProperties,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { mergeVirtualRange } from "./range";

export type VirtualizedSortableItem = {
  index: number;
  id: string;
  measureRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
};

type Props<Item> = {
  items: readonly Item[];
  getItemId: (item: Item) => string;
  renderItem: (item: Item, virtualItem: VirtualizedSortableItem) => ReactNode;
  as: "div" | "ul";
  className?: string;
  estimateSize: number;
  gap?: number;
  retainFocusId?: string;
  onRetainFocus?: () => void;
  testId?: string;
};

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function findVerticalScrollParent(element: HTMLElement | null) {
  let current = element?.parentElement ?? null;
  while (current) {
    const overflow = getComputedStyle(current).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return element?.parentElement ?? null;
}

function rowFocusTargets(row: HTMLElement) {
  const targets = Array.from(row.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (row.matches(FOCUSABLE)) targets.unshift(row);
  return targets.filter(
    (target) =>
      !target.hasAttribute("disabled") &&
      target.getAttribute("aria-hidden") !== "true" &&
      target.getAttribute("tabindex") !== "-1",
  );
}

/**
 * Virtual window for a Kaneo sortable column. SortableContext stays outside with every id;
 * this component keeps active/over items and one adjacent keyboard destination registered.
 */
export default function VirtualizedSortableList<Item>({
  items,
  getItemId,
  renderItem,
  as,
  className,
  estimateSize,
  gap = 0,
  retainFocusId,
  onRetainFocus,
  testId,
}: Props<Item>) {
  const { active, over } = useDndContext();
  const Container = as;
  const listRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<{ id: string; backwards: boolean } | null>(null);
  const [focusedId, setFocusedId] = useState<string>();
  const ids = useMemo(() => items.map(getItemId), [getItemId, items]);
  const activeIndex = active ? ids.indexOf(String(active.id)) : -1;
  const overIndex = over ? ids.indexOf(String(over.id)) : -1;
  const focusedIndex = focusedId ? ids.indexOf(focusedId) : -1;
  const retainedIndex = retainFocusId ? ids.indexOf(retainFocusId) : -1;

  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      return mergeVirtualRange(defaultRangeExtractor(range), items.length, [
        activeIndex,
        activeIndex - 1,
        activeIndex + 1,
        overIndex,
        overIndex - 1,
        overIndex + 1,
        focusedIndex,
        retainedIndex,
      ]);
    },
    [activeIndex, focusedIndex, items.length, overIndex, retainedIndex],
  );

  const getScrollElement = useCallback(
    () => findVerticalScrollParent(listRef.current),
    [],
  );
  const estimateItemSize = useCallback(() => estimateSize, [estimateSize]);
  const getItemKey = useCallback((index: number) => ids[index] ?? index, [ids]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement,
    initialRect: { width: 960, height: 640 },
    estimateSize: estimateItemSize,
    getItemKey,
    gap,
    overscan: 3,
    rangeExtractor,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useLayoutEffect(() => {
    if (!active || overIndex < 0) return;
    virtualizer.scrollToIndex(overIndex, { align: "auto" });
  }, [active, overIndex, virtualizer]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !listRef.current) return;
    const row = Array.from(
      listRef.current.querySelectorAll<HTMLElement>("[data-virtual-item-id]"),
    ).find((element) => element.dataset.virtualItemId === pending.id);
    if (!row) return;
    const targets = rowFocusTargets(row);
    const target = pending.backwards ? targets.at(-1) : targets[0];
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });

  const handleFocusCapture = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      if (!(event.target instanceof Element)) return;
      const row = event.target.closest<HTMLElement>("[data-virtual-item-id]");
      const id = row?.dataset.virtualItemId;
      if (!id) return;
      setFocusedId(id);
      if (id === retainFocusId) onRetainFocus?.();
    },
    [onRetainFocus, retainFocusId],
  );

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (
        event.key !== "Tab" ||
        event.defaultPrevented ||
        !(event.target instanceof Element)
      ) {
        return;
      }
      const row = event.target.closest<HTMLElement>("[data-virtual-item-id]");
      const id = row?.dataset.virtualItemId;
      const index = id ? ids.indexOf(id) : -1;
      if (!row || index < 0) return;
      const targets = rowFocusTargets(row);
      const focused = targets.indexOf(document.activeElement as HTMLElement);
      const backwards = event.shiftKey;
      const atBoundary = backwards
        ? focused === 0
        : focused === targets.length - 1;
      const nextIndex = index + (backwards ? -1 : 1);
      if (!atBoundary || nextIndex < 0 || nextIndex >= items.length) return;

      const nextId = ids[nextIndex];
      if (!nextId) return;
      event.preventDefault();
      pendingFocus.current = { id: nextId, backwards };
      setFocusedId(nextId);
      virtualizer.scrollToIndex(nextIndex, { align: "auto" });
    },
    [ids, items.length, virtualizer],
  );

  return (
    <Container
      ref={listRef as never}
      className={className}
      data-virtualized-list="true"
      data-testid={testId}
      onFocusCapture={handleFocusCapture}
      onKeyDownCapture={handleKeyDownCapture}
      style={{
        position: "relative",
        height: virtualizer.getTotalSize(),
        width: "100%",
      }}
    >
      {virtualItems.map((virtualItem) => {
        const item = items[virtualItem.index];
        const id = ids[virtualItem.index];
        if (!item || !id) return null;
        return renderItem(item, {
          index: virtualItem.index,
          id,
          measureRef: (node) => virtualizer.measureElement(node),
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${virtualItem.start}px)`,
          },
        });
      })}
    </Container>
  );
}
