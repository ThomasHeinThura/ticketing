const deferredKeyboardSensorEvents = new WeakSet<KeyboardEvent>();

export function isDeferredKeyboardSensorEvent(event: KeyboardEvent): boolean {
  return deferredKeyboardSensorEvents.has(event);
}

/**
 * dnd-kit attaches KeyboardSensor's document listener on the task after Space
 * activates it. Replay an unhandled movement/end/cancel key only while this
 * same card remains connected and marked active; handled, stale, and replayed
 * events are ignored.
 */
export function deferKeyboardSensorKey(
  card: HTMLElement,
  event: KeyboardEvent,
): void {
  if (
    isDeferredKeyboardSensorEvent(event) ||
    ![
      "Space",
      "Enter",
      "Escape",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(event.code)
  )
    return;

  window.setTimeout(() => {
    if (
      event.defaultPrevented ||
      !card.isConnected ||
      card.dataset.taskDragging !== "true"
    )
      return;

    const deferredEvent = new KeyboardEvent("keydown", {
      key: event.key,
      code: event.code,
      bubbles: true,
      cancelable: true,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
    });
    deferredKeyboardSensorEvents.add(deferredEvent);
    card.dispatchEvent(deferredEvent);
  });
}

/** @deprecated Use deferKeyboardSensorKey; retained for existing callers/tests. */
export function deferKeyboardSensorEndKey(
  card: HTMLElement,
  event: KeyboardEvent,
): void {
  deferKeyboardSensorKey(card, event);
}
