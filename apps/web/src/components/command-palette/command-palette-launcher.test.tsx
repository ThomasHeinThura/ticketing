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

describe("CommandPaletteLauncher warm mount", () => {
  it("waits for real work content before importing the closed palette", async () => {
    window.history.replaceState({}, "", "/agent/projects/OPS/work");
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
    render(<CommandPaletteLauncher />);

    expect(mocks.moduleLoaded).not.toHaveBeenCalled();
    const content = document.createElement("div");
    content.dataset.primaryContentReady = "true";
    await act(async () => {
      document.body.append(content);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(0));
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(16));

    await waitFor(() =>
      expect(screen.getByTestId("palette-instance")).toHaveAttribute(
        "data-warmed",
        "true",
      ),
    );
    expect(mocks.moduleLoaded).toHaveBeenCalledOnce();
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
