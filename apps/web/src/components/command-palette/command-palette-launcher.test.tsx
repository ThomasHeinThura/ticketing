import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcuts } from "@/constants/shortcuts";
import CommandPaletteLauncher from "./command-palette-launcher";

const mocks = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  sidebarShown: vi.fn(),
  sidebarShownPromise: undefined as Promise<void> | undefined,
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
      open,
    }: {
      keepMounted: boolean;
      open: boolean;
    }) => (
      <div
        data-testid="palette-instance"
        data-warmed={keepMounted ? "true" : undefined}
        data-open={open ? "true" : "false"}
      />
    ),
  };
});

vi.mock("@/lib/sidebar-shown", () => ({
  whenSidebarShown: () => {
    mocks.sidebarShown();
    return mocks.sidebarShownPromise ?? Promise.resolve();
  },
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
  useRegisterShortcuts: (config: typeof mocks.registered) => {
    mocks.registered = config;
  },
}));

afterEach(() => {
  cleanup();
  mocks.sidebarShownPromise = undefined;
  mocks.sidebarShown.mockClear();
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
  it("downloads at primary content and mounts after paint frames and browser idle", async () => {
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
    // The download starts with the primary content; on this screen the mount waits for the
    // sidebar to render, then for paint frames and idle time.
    await waitFor(() => expect(mocks.moduleLoaded).toHaveBeenCalled());
    expect(mocks.sidebarShown).toHaveBeenCalled();
    await act(async () => {});
    expect(frames).toHaveLength(1);
    runNextFrame(frames);
    expect(frames).toHaveLength(1);
    runNextFrame(frames);
    expect(screen.queryByTestId("palette-instance")).toBeNull();
    expect(idleCallbacks.size).toBe(1);

    act(() => idleCallbacks.get(1)?.());

    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-warmed",
        "true",
      ),
    );
    expect(mocks.moduleLoaded).toHaveBeenCalledOnce();
  });

  it("cancels the pending idle warm-up when the user requests the palette", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    let idleCallback: (() => void) | undefined;
    let idleOptions: { timeout?: number } | undefined;
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal(
      "requestIdleCallback",
      (callback: () => void, options?: { timeout?: number }) => {
        idleCallback = callback;
        idleOptions = options;
        return 7;
      },
    );
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    document.body.append(content);
    render(<CommandPaletteLauncher />);
    await act(async () => {}); // the sidebar has rendered
    runNextFrame(frames);
    runNextFrame(frames);

    const openPalette =
      mocks.registered?.modifierShortcuts?.[shortcuts.palette.prefix]?.[
        shortcuts.palette.open
      ];
    act(() => openPalette?.());

    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(idleCallback).toBeTypeOf("function");
    // The warm-up is bounded, so a busy main thread cannot leave the palette cold.
    // On the work list the sidebar has already rendered, so idle time is waited for briefly.
    expect(idleOptions).toEqual({ timeout: 300 });
    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );
  });

  it("on the work list, mounts only after the sidebar has rendered", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    let sidebarRendered: () => void = () => {};
    mocks.sidebarShownPromise = new Promise<void>((resolve) => {
      sidebarRendered = resolve;
    });
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    document.body.append(content);
    render(<CommandPaletteLauncher />);
    await act(async () => {});
    // No mount is scheduled while the sidebar renders.
    expect(mocks.sidebarShown).toHaveBeenCalled();
    expect(frames).toHaveLength(0);

    await act(async () => sidebarRendered());
    expect(frames).toHaveLength(1);
  });

  it("opens on ⌘K while it waits for the sidebar, and schedules no warm mount afterwards", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    let sidebarRendered: () => void = () => {};
    mocks.sidebarShownPromise = new Promise<void>((resolve) => {
      sidebarRendered = resolve;
    });
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    document.body.append(content);
    render(<CommandPaletteLauncher />);
    await act(async () => {});

    const openPalette =
      mocks.registered?.modifierShortcuts?.[shortcuts.palette.prefix]?.[
        shortcuts.palette.open
      ];
    act(() => openPalette?.());
    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-open",
        "true",
      ),
    );

    await act(async () => sidebarRendered());
    expect(frames).toHaveLength(0);
  });

  it("does not wait for the sidebar outside the work list and boards", async () => {
    window.history.replaceState({}, "", "/agent/inbox");
    mockFrames();
    vi.stubGlobal("requestIdleCallback", () => 3);
    render(<CommandPaletteLauncher />);
    await act(async () => {});
    expect(mocks.sidebarShown).not.toHaveBeenCalled();
  });

  it("cancels an outstanding idle callback on unmount", async () => {
    const frames = mockFrames();
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", () => 9);
    vi.stubGlobal("cancelIdleCallback", cancelIdleCallback);
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    document.body.append(content);
    const { unmount } = render(<CommandPaletteLauncher />);
    await act(async () => {}); // the sidebar has rendered
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
  it("warms when existing primary content becomes ready without inserting nodes", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
    const frames = mockFrames();
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "false";
    document.body.append(content);
    render(<CommandPaletteLauncher />);
    await act(async () => {});
    expect(mocks.sidebarShown).not.toHaveBeenCalled();

    await act(async () => {
      content.dataset.primaryContentReady = "true";
    });
    await waitFor(() => expect(mocks.sidebarShown).toHaveBeenCalledOnce());
    runNextFrame(frames);
    runNextFrame(frames);
    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-warmed",
        "true",
      ),
    );
  });
});
