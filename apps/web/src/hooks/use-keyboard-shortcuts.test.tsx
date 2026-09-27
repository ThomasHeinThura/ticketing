import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
  useRegisterShortcuts,
} from "./use-keyboard-shortcuts";

/**
 * Issue #407: `useRegisterShortcuts`'s registration effect depended on the
 * whole `shortcutsConfig` object's identity. Every real caller
 * (`CommandPalette`, `SearchCommandMenu`, and every other
 * `useRegisterShortcuts` call site) passes a fresh object literal built in
 * the render body, never memoized.
 *
 * The loop this produced: `KeyboardShortcutsProvider`'s register/unregister
 * used `setState(prev => new Map(prev)...)`, a real state change → Provider
 * re-render → its inline context `value` object got a new identity → every
 * `useContext` consumer re-rendered (including the one that just
 * registered) → that consumer rebuilt its own config object → the effect's
 * dependency array saw a new identity and re-ran (unregister + register) →
 * back to the first step, indefinitely. Confirmed empirically before the
 * fix: this render hung a vitest run past its timeout and OOM'd a real
 * `CommandPalette` render at ~4GB heap.
 *
 * The fix moves the three shortcut registries off `useState` and onto
 * refs (they're only ever read inside the `keydown` handler, never during
 * render, so they never needed to be state) and memoizes the context
 * `value`. Registering a shortcut no longer produces a React state change
 * at all, so it can never cascade back into a re-render of the very
 * component that triggered it — regardless of whether callers memoize
 * their config object.
 */

function mustExist<T>(value: T | null | undefined): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error("expected value to be set by now");
  }
  return value as NonNullable<T>;
}

function InlineConfigConsumer({ onRender }: { onRender: () => void }) {
  onRender();
  // Mirrors every real caller's own pattern: a fresh object literal built
  // inline in the render body, never memoized with useMemo/useCallback.
  useRegisterShortcuts({
    modifierShortcuts: {
      "⌘": { k: () => {} },
    },
  });
  return null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useRegisterShortcuts + KeyboardShortcutsProvider (#407)", () => {
  it("settles within a small, bounded number of renders when passed an inline config object", () => {
    let renderCount = 0;
    render(
      <KeyboardShortcutsProvider>
        <InlineConfigConsumer onRender={() => renderCount++} />
      </KeyboardShortcutsProvider>,
    );

    // React may legitimately render a component more than once around a
    // mount (e.g. StrictMode double-invoke in dev), but it must settle. A
    // real loop keeps re-rendering forever; this bound is generous enough
    // to never trip on ordinary mount behavior but would have caught #407
    // (which never settles at all).
    expect(renderCount).toBeLessThanOrEqual(4);
  });

  it("registers on mount and unregisters on unmount", () => {
    const handler = vi.fn();
    let registerSpy: ReturnType<typeof vi.fn> | null = null;
    let unregisterSpy: ReturnType<typeof vi.fn> | null = null;

    function Probe() {
      const ctx = useKeyboardShortcuts();
      if (!registerSpy) {
        registerSpy = vi.spyOn(ctx, "registerModifierShortcut");
        unregisterSpy = vi.spyOn(ctx, "unregisterModifierShortcut");
      }
      useRegisterShortcuts({
        modifierShortcuts: { "⌘": { k: handler } },
      });
      return null;
    }

    const { unmount } = render(
      <KeyboardShortcutsProvider>
        <Probe />
      </KeyboardShortcutsProvider>,
    );

    expect(mustExist(registerSpy)).toHaveBeenCalledWith("⌘", "k", handler);
    expect(mustExist(unregisterSpy)).not.toHaveBeenCalled();

    unmount();

    expect(mustExist(unregisterSpy)).toHaveBeenCalledWith("⌘", "k");
  });

  it("re-registers with the latest handler when the actual binding changes", () => {
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    function Consumer({ handler }: { handler: () => void }) {
      useRegisterShortcuts({ shortcuts: { g: handler } });
      return null;
    }

    const { rerender } = render(
      <KeyboardShortcutsProvider>
        <Consumer handler={firstHandler} />
      </KeyboardShortcutsProvider>,
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    });
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).not.toHaveBeenCalled();

    rerender(
      <KeyboardShortcutsProvider>
        <Consumer handler={secondHandler} />
      </KeyboardShortcutsProvider>,
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
    });
    // The new handler fires; the stale closure from the first render does
    // not fire again.
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });

  it("does not force a sibling context consumer to re-render when a shortcut is (un)registered", () => {
    let siblingRenders = 0;
    const captured: {
      ctx: ReturnType<typeof useKeyboardShortcuts> | null;
    } = { ctx: null };

    function Sibling() {
      captured.ctx = useKeyboardShortcuts();
      siblingRenders++;
      return null;
    }

    render(
      <KeyboardShortcutsProvider>
        <Sibling />
      </KeyboardShortcutsProvider>,
    );

    const rendersAfterMount = siblingRenders;
    expect(rendersAfterMount).toBeGreaterThan(0);
    const ctx = mustExist(captured.ctx);

    // This is exactly what a caller's registration effect does. Before the
    // fix, this went through `setState`, which re-rendered the Provider,
    // recreated its context value, and re-rendered every consumer
    // (including siblings that never asked to re-render). Now it only
    // mutates a ref, so no consumer -- this one included -- re-renders.
    act(() => {
      ctx.registerShortcut("z", () => {});
    });
    expect(siblingRenders).toBe(rendersAfterMount);

    act(() => {
      ctx.unregisterShortcut("z");
    });
    expect(siblingRenders).toBe(rendersAfterMount);
  });
});
