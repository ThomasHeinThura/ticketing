import {
  KeyboardSensor as DndKeyboardSensor,
  type KeyboardCoordinateGetter,
  type KeyboardSensorProps,
} from "@dnd-kit/core";
import { flushSync } from "react-dom";

type Coordinates = { x: number; y: number };

function commitMove(props: KeyboardSensorProps, coordinates: Coordinates) {
  flushSync(() => props.onMove(coordinates));
  const context = props.context.current;
  const collision = context.collisions?.[0];
  const container = collision
    ? context.droppableContainers.get(collision.id)
    : undefined;
  const rect = collision ? context.droppableRects.get(collision.id) : undefined;
  context.over =
    container && !container.disabled && rect
      ? {
          id: container.id,
          rect,
          data: container.data,
          disabled: container.disabled,
        }
      : null;
}

function targetCrossesCenterBand(
  event: KeyboardEvent,
  target: Coordinates,
  current: Coordinates,
  context: KeyboardSensorProps["context"]["current"],
) {
  if (
    (event.code !== "ArrowDown" && event.code !== "ArrowUp") ||
    target.x !== current.x ||
    !context.collisionRect
  ) {
    return false;
  }

  let crossesBand = false;
  for (const ancestor of context.scrollableAncestors) {
    const rect = ancestor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const fullyVisible =
      target.x >= rect.left &&
      target.x + context.collisionRect.width <= rect.right &&
      target.y >= rect.top &&
      target.y + context.collisionRect.height <= rect.bottom;
    if (!fullyVisible) return false;

    const centerBoundary =
      event.code === "ArrowDown"
        ? rect.bottom - rect.height / 2
        : rect.top + rect.height / 2;
    crossesBand ||=
      event.code === "ArrowDown"
        ? target.y > centerBoundary
        : target.y < centerBoundary;
  }

  return context.scrollableAncestors.length > 0 && crossesBand;
}

function withSynchronousMoves(
  props: KeyboardSensorProps,
  keepVisibleTargetsMoving: boolean,
): KeyboardSensorProps {
  const coordinateGetter = props.options.coordinateGetter;
  let referenceCoordinates: Coordinates | undefined;

  const options =
    keepVisibleTargetsMoving && coordinateGetter
      ? {
          ...props.options,
          coordinateGetter: ((event, args) => {
            referenceCoordinates ??= args.currentCoordinates;
            const target = coordinateGetter(event, args);
            if (
              target &&
              targetCrossesCenterBand(
                event,
                target,
                args.currentCoordinates,
                args.context,
              )
            ) {
              event.preventDefault();
              commitMove(props, {
                x: target.x - referenceCoordinates.x,
                y: target.y - referenceCoordinates.y,
              });
              return undefined;
            }
            return target;
          }) satisfies KeyboardCoordinateGetter,
        }
      : props.options;

  return {
    ...props,
    options,
    onMove: (coordinates) => commitMove(props, coordinates),
  };
}

/** Commits each keyboard sensor move before the next native document keydown. */
export const SynchronousKeyboardSensor = class KeyboardSensor extends DndKeyboardSensor {
  constructor(props: KeyboardSensorProps) {
    super(withSynchronousMoves(props, false));
  }
};

/**
 * A list target can be fully visible while dnd-kit starts centering its overlay. In that case,
 * commit the exact coordinate through the same keyboard sensor move path and keep stock
 * autoscroll for targets outside a scroll viewport.
 */
export const VisibleTargetKeyboardSensor = class KeyboardSensor extends DndKeyboardSensor {
  constructor(props: KeyboardSensorProps) {
    super(withSynchronousMoves(props, true));
  }
};
