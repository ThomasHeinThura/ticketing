import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcuts } from "@/constants/shortcuts";
import CommandPaletteLauncher from "./command-palette-launcher";

const mocks = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  registered: undefined as
    | {
        modifierShortcuts?: Record<string, Record<string, () => void>>;
      }
    | undefined,
}));

vi.mock("./index", () => {
  mocks.moduleLoaded();
  return {
    CommandPalette: ({
      keepMounted,
      hasOpened,
      open,
    }: {
      keepMounted: boolean;
      hasOpened: boolean;
      open: boolean;
    }) => (
      <div
        data-testid="palette-instance"
        data-warmed={keepMounted ? "true" : undefined}
        data-has-opened={hasOpened ? "true" : "false"}
        data-open={open ? "true" : "false"}
      />
    ),
  };
});

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
  useRegisterShortcuts: (config: typeof mocks.registered) => {
    mocks.registered = config;
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  document.querySelector("[data-primary-content-ready]")?.remove();
  window.history.replaceState({}, "", "/");
});

function mockFrames() {
  const frames: FrameRequestCallback[] = [];
  let frameId = 0;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      frameId += 1;
      return frameId;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return frames;
}

function runNextFrame(frames: FrameRequestCallback[]) {
  act(() => frames.shift()?.(0));
}

describe("CommandPaletteLauncher warm mount", () => {
  it("waits for primary content, paint frames, and browser idle before importing", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    const idleCallbacks = new Map<number, () => void>();
    let idleId = 0;
    vi.stubGlobal(
      "requestIdleCallback",
      vi.fn((callback: () => void) => {
        idleId += 1;
        idleCallbacks.set(idleId, callback);
        return idleId;
      }),
    );
    vi.stubGlobal(
      "cancelIdleCallback",
      vi.fn((id: number) => idleCallbacks.delete(id)),
    );
    render(<CommandPaletteLauncher />);

    expect(mocks.moduleLoaded).not.toHaveBeenCalled();
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    await act(async () => {
      document.body.append(content);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(frames).toHaveLength(1);
    runNextFrame(frames);
    expect(frames).toHaveLength(1);
    runNextFrame(frames);
    expect(mocks.moduleLoaded).not.toHaveBeenCalled();
    expect(idleCallbacks.size).toBe(1);

    act(() => idleCallbacks.get(1)?.());

    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-warmed",
        "true",
      ),
    );
    expect(screen.getByTestId("palette-instance")).toHaveAttribute(
      "data-has-opened",
      "false",
    );
    expect(mocks.moduleLoaded).toHaveBeenCalledOnce();
  });

  it("cancels the pending idle warm-up when the user requests the palette", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    let idleCallback: (() => void) | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idleCallback = callback;
      return 7;
    });
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    document.body.append(content);
    render(<CommandPaletteLauncher />);
    runNextFrame(frames);
    runNextFrame(frames);

    const openPalette =
      mocks.registered?.modifierShortcuts?.[shortcuts.palette.prefix]?.[
        shortcuts.palette.open
      ];
    act(() => openPalette?.());

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(idleCallback).toBeTypeOf("function");
    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );
    expect(screen.getByTestId("palette-instance")).toHaveAttribute(
      "data-has-opened",
      "true",
    );
  });

  it("cancels an outstanding idle callback on unmount", () => {
    const frames = mockFrames();
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", () => 9);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    document.body.append(content);
    const { unmount } = render(<CommandPaletteLauncher />);
    runNextFrame(frames);
    runNextFrame(frames);

    unmount();

    expect(cancelIdleCallback).toHaveBeenCalledWith(9);
  });

  it("keeps the existing paint-frame warm-up when idle callbacks are unsupported", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    render(<CommandPaletteLauncher />);
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    await act(async () => {
      document.body.append(content);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    runNextFrame(frames);
    expect(mocks.moduleLoaded).not.toHaveBeenCalled();
    runNextFrame(frames);

    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-warmed",
        "true",
      ),
    );
  });

  it("loads immediately on explicit shortcut intent without waiting for content", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    render(<CommandPaletteLauncher />);

    const openPalette =
      mocks.registered?.modifierShortcuts?.[shortcuts.palette.prefix]?.[
        shortcuts.palette.open
      ];
    expect(openPalette).toBeTypeOf("function");
    act(() => openPalette?.());

    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );
  });
});
