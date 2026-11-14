"use client";

import * as React from "react";

export interface UseKeyboardPressOptions {
  /** Whether keyboard press feedback is active on this element. Defaults to `true`. */
  enabled?: boolean;
  /** Suppresses keyboard press feedback when the control is disabled or non-interactive. */
  disabled?: boolean;
  /** Whether Space triggers press feedback in addition to Enter. Defaults to `true`. */
  allowSpace?: boolean;
  /** Optional predicate to ignore synthetic or replayed keyboard events (e.g. dnd-kit sensor replays). */
  shouldIgnoreEvent?: (event: React.KeyboardEvent<HTMLElement>) => boolean;
}

export interface KeyboardPressProps {
  "data-pressed"?: "";
  "data-keyboard-press"?: "";
  onBlur: (event: React.FocusEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}

function isElementNonInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches(":disabled") ||
    target.getAttribute("aria-disabled") === "true" ||
    target.hasAttribute("data-disabled") ||
    target.getAttribute("data-read-only") === "true" ||
    target.hasAttribute("data-dragging") ||
    target.getAttribute("data-task-dragging") === "true"
  );
}

/**
 * Mirrors pointer `:active` feedback onto `[data-pressed]` for keyboard activation (`Enter`
 * and optionally `Space`), while keeping `[data-keyboard-press]` active until a subsequent
 * pointer interaction or disable so keyboard press and release stay instantaneous (plan section 6 rule 8).
 *
 * When idle, `"data-pressed"` and `"data-keyboard-press"` are omitted from the returned object
 * so `mergeProps(defaultProps, props, keyboardPressProps)` preserves any external `data-pressed`
 * state (such as Base UI popup triggers).
 */
export function useKeyboardPress(
  options: UseKeyboardPressOptions = {},
): KeyboardPressProps {
  const {
    enabled = true,
    disabled = false,
    allowSpace = true,
    shouldIgnoreEvent,
  } = options;
  const [pressed, setPressed] = React.useState(false);
  const [keyboardMode, setKeyboardMode] = React.useState(false);
  const activeKeyRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!enabled || disabled) {
      activeKeyRef.current = null;
      setPressed(false);
      setKeyboardMode(false);
    }
  }, [disabled, enabled]);

  const releaseKeyboardPress = React.useCallback(() => {
    activeKeyRef.current = null;
    setPressed(false);
  }, []);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled || disabled) return;
      if (event.target !== event.currentTarget) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (shouldIgnoreEvent?.(event)) return;
      if (isElementNonInteractive(event.currentTarget)) return;
      if (
        event.key === " " &&
        event.currentTarget.hasAttribute("data-taskdesk-sortable")
      ) {
        return;
      }

      if (event.key === "Escape") {
        if (activeKeyRef.current !== null) {
          releaseKeyboardPress();
        }
        return;
      }

      const isActivationKey =
        event.key === "Enter" || (allowSpace && event.key === " ");
      if (!isActivationKey || event.repeat) return;

      activeKeyRef.current = event.key;
      setKeyboardMode(true);
      setPressed(true);
    },
    [allowSpace, disabled, enabled, releaseKeyboardPress, shouldIgnoreEvent],
  );

  const onKeyUp = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (activeKeyRef.current === null) return;
      if (
        event.key === activeKeyRef.current ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        releaseKeyboardPress();
      }
    },
    [releaseKeyboardPress],
  );

  const onBlur = React.useCallback(() => {
    if (activeKeyRef.current !== null || pressed) {
      releaseKeyboardPress();
    }
  }, [pressed, releaseKeyboardPress]);

  const onPointerCancel = React.useCallback(() => {
    if (activeKeyRef.current !== null || pressed) {
      releaseKeyboardPress();
    }
  }, [pressed, releaseKeyboardPress]);

  const onPointerDown = React.useCallback(() => {
    activeKeyRef.current = null;
    if (pressed) setPressed(false);
    if (keyboardMode) setKeyboardMode(false);
  }, [keyboardMode, pressed]);

  const showPressed = enabled && !disabled && pressed;
  const showKeyboardMode = enabled && !disabled && keyboardMode;

  return {
    ...(showPressed ? { "data-pressed": "" as const } : undefined),
    ...(showKeyboardMode ? { "data-keyboard-press": "" as const } : undefined),
    onBlur,
    onKeyDown,
    onKeyUp,
    onPointerCancel,
    onPointerDown,
  };
}
