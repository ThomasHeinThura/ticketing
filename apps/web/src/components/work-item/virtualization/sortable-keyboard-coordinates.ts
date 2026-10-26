import {
  closestCorners,
  getFirstCollision,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

type Rect = { left: number; right: number; top: number; bottom: number };

function containsPoint(rect: Rect, x: number, y: number) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isBoardBucket(data: unknown): data is { type: "column" | "group" } {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    (data.type === "column" || data.type === "group")
  );
}

function horizontalCoordinates(
  event: Parameters<KeyboardCoordinateGetter>[0],
  args: Parameters<KeyboardCoordinateGetter>[1],
) {
  const { context } = args;
  const active = context.active;
  const collisionRect = context.collisionRect;
  if (!active || !collisionRect) return undefined;
  event.preventDefault();

  const activeSortable = active.data.current?.sortable;
  const overSortable = context.over?.data.current?.sortable;
  const collisionId = context.collisions?.[0]?.id;
  const collisionSortable = collisionId
    ? context.droppableContainers.get(collisionId)?.data.current?.sortable
    : undefined;
  const currentSortable = overSortable ?? collisionSortable ?? activeSortable;

  const bucketContainers = context.droppableContainers
    .getEnabled()
    .filter((container) => isBoardBucket(container.data.current));
  const overData = context.over?.data.current;
  const overBucketId = isBoardBucket(overData) ? context.over?.id : undefined;
  const referenceRect = context.over?.rect ?? collisionRect;
  const referenceX = referenceRect.left + referenceRect.width / 2;
  const referenceY = referenceRect.top + referenceRect.height / 2;
  const currentBucketId =
    overBucketId ??
    bucketContainers.find((container) => {
      const rect = context.droppableRects.get(container.id);
      return rect ? containsPoint(rect, referenceX, referenceY) : false;
    })?.id;

  const enabledContainers = context.droppableContainers.getEnabled();
  const candidates = enabledContainers.filter((container) => {
    if (container.id === currentBucketId) return false;
    const rect = context.droppableRects.get(container.id);
    if (!rect) return false;

    const isInDirection =
      event.code === "ArrowRight"
        ? collisionRect.left < rect.left
        : collisionRect.left > rect.left;
    if (!isInDirection) return false;

    const sortable = container.data.current?.sortable;
    if (sortable) {
      if (sortable.containerId === currentSortable?.containerId) return false;

      const targetBucket = bucketContainers.find((bucket) => {
        const bucketRect = context.droppableRects.get(bucket.id);
        return bucketRect
          ? containsPoint(
              bucketRect,
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )
          : false;
      });
      if (targetBucket && targetBucket.id === currentBucketId) return false;
      return true;
    }

    if (isBoardBucket(container.data.current)) {
      const containsSortable = enabledContainers.some((candidate) => {
        if (!candidate.data.current?.sortable) return false;
        const candidateRect = context.droppableRects.get(candidate.id);
        return candidateRect
          ? containsPoint(
              rect,
              candidateRect.left + candidateRect.width / 2,
              candidateRect.top + candidateRect.height / 2,
            )
          : false;
      });
      return !containsSortable;
    }

    return true;
  });

  if (candidates.length === 0) return undefined;

  const collisions = closestCorners({
    active,
    collisionRect,
    droppableRects: context.droppableRects,
    droppableContainers: candidates,
    pointerCoordinates: null,
  });
  const targetId = getFirstCollision(collisions, "id");
  const target = targetId
    ? context.droppableContainers.get(targetId)
    : undefined;
  const targetRect = targetId
    ? context.droppableRects.get(targetId)
    : undefined;
  if (!target || target.disabled || !target.node.current || !targetRect)
    return undefined;

  return { x: targetRect.left, y: targetRect.top };
}

/**
 * dnd-kit's stock getter picks a vertical target from geometry alone. Virtual rows can be
 * mounted and measured while that geometry is still settling, so use the sortable's actual
 * ordered IDs for vertical movement. Horizontal movement selects a distinct adjacent bucket
 * so a small difference in same-bucket card geometry cannot trap keyboard movement there.
 */
export const sortableKeyboardCoordinatesWithVirtualRows: KeyboardCoordinateGetter =
  (event, args) => {
    const { context } = args;
    if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      return horizontalCoordinates(event, args);
    }
    if (event.code !== "ArrowDown" && event.code !== "ArrowUp") {
      return sortableKeyboardCoordinates(event, args);
    }

    const active = context.active;
    const activeSortable = active?.data.current?.sortable;
    if (!active || !activeSortable) {
      return sortableKeyboardCoordinates(event, args);
    }

    const collisionId = context.collisions?.[0]?.id;
    const collisionSortable = collisionId
      ? context.droppableContainers.get(collisionId)?.data.current?.sortable
      : undefined;
    const overSortable = context.over?.data.current?.sortable;
    const currentSortable = overSortable ?? collisionSortable ?? activeSortable;
    const step = event.code === "ArrowDown" ? 1 : -1;
    const targetId = currentSortable.items[currentSortable.index + step];
    const target = targetId
      ? context.droppableContainers.get(targetId)
      : undefined;
    const targetRect = targetId
      ? context.droppableRects.get(targetId)
      : undefined;
    const activeRect = context.collisionRect;

    if (
      !target ||
      target.disabled ||
      !target.node.current ||
      !targetRect ||
      !activeRect
    ) {
      return sortableKeyboardCoordinates(event, args);
    }

    event.preventDefault();

    // Position the moving rect so its lower edge meets the next row's lower edge when moving
    // down, matching sortableKeyboardCoordinates' size adjustment for unequal row heights.
    const movingDown = step > 0;
    return {
      x: targetRect.left,
      y:
        targetRect.top -
        (movingDown ? activeRect.height - targetRect.height : 0),
    };
  };
