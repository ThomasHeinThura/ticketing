import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ load: vi.fn(), warm: vi.fn() }));
vi.mock("./toast-loader", () => ({
  loadToastContents: control.load,
  warmToastContents: control.warm,
}));

let toast: typeof import("./toast");
let contents: typeof import("./toast-viewport");
let resolve: (module: typeof contents) => void;
let reject: (error: Error) => void;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  control.load.mockReset();
  control.warm.mockReset();
  const pending = new Promise<typeof contents>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  control.load.mockReturnValue(pending);
  toast = await import("./toast");
  contents = await import("./toast-viewport");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
};
const finishLoad = async () => {
  await act(async () => {
    resolve(contents);
  });
  await flush();
};

describe("deferred notification recovery", () => {
  it("shows several queued toasts in library order with their full visible durations", async () => {
    const closed = vi.fn();
    render(<toast.ToastProvider limit={10} />);
    act(() => {
      toast.toastManager.add({
        title: "First",
        timeout: 2_000,
        onClose: closed,
      });
      toast.toastManager.add({
        title: "Second",
        timeout: 2_000,
        onClose: closed,
      });
      toast.toastManager.add({
        title: "Third",
        timeout: 2_000,
        onClose: closed,
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(closed).not.toHaveBeenCalled();
    expect(screen.queryByText("First")).not.toBeInTheDocument();
    await finishLoad();
    const titles = [
      ...document.querySelectorAll('[data-slot="toast-title"]'),
    ].map((node) => node.textContent);
    expect(titles).toEqual(["Third", "Second", "First"]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_649);
    });
    expect(closed).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(closed).toHaveBeenCalledTimes(3);
  });

  it("does not flash a closed toast and shows updates made before load", async () => {
    render(<toast.ToastProvider />);
    act(() => {
      const removed = toast.toastManager.add({ title: "Never visible" });
      const updated = toast.toastManager.add({
        title: "Loading",
        type: "loading",
      });
      toast.toastManager.close(removed);
      toast.toastManager.update(updated, {
        title: "Finished",
        description: "Current description",
        type: "success",
      });
    });
    await finishLoad();
    expect(screen.queryByText("Never visible")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText("Current description")).toBeInTheDocument();
  });

  it("contains a failed import, renders text, and retries on the next notification", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const closed = vi.fn();
    render(
      <toast.ToastProvider>
        <span data-testid="page">Unsaved page</span>
      </toast.ToastProvider>,
    );
    const page = screen.getByTestId("page");
    act(() => {
      toast.toastManager.add({
        title: "Save failed",
        description: "Try later",
        timeout: 1_000,
        onClose: closed,
      });
    });
    await act(async () => {
      reject(new Error("offline"));
    });
    await flush();
    expect(screen.getByText("Save failed")).toBeInTheDocument();
    expect(screen.getByText("Try later")).toBeInTheDocument();
    expect(screen.getByTestId("page")).toBe(page);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(closed).toHaveBeenCalledOnce();
    expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
    control.load.mockResolvedValue(contents);
    act(() => {
      toast.toastManager.add({ title: "Recovered" });
    });
    await flush();
    expect(screen.getByText("Recovered")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="toast-title"]'),
    ).toBeInTheDocument();
    expect(control.load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("page")).toBe(page);
  });

  it("stacks and dismisses text fallbacks while preserving them during a slow retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<toast.ToastProvider limit={2} />);
    act(() => {
      toast.toastManager.add({ title: "Older", timeout: 0 });
      toast.toastManager.add({ title: "Latest", timeout: 0 });
    });
    await act(async () => {
      reject(new Error("offline"));
    });
    await flush();
    const card = screen.getByText("Latest").closest('[data-slot="card"]');
    expect(card?.parentElement).toHaveClass("flex-col", "gap-2");
    expect(screen.getByText("Latest")).toHaveClass("font-normal", "text-sm");
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(screen.queryByText("Older")).not.toBeInTheDocument();
    control.load.mockReturnValue(new Promise(() => {}));
    act(() => {
      toast.toastManager.add({ title: "Retry", timeout: 0 });
    });
    await flush();
    expect(screen.getByText("Latest")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
    expect(control.load).toHaveBeenCalledTimes(2);
  });

  it("requests warm-up in the provider effect without importing contents during render", () => {
    expect(control.warm).not.toHaveBeenCalled();
    render(<toast.ToastProvider />);
    expect(control.warm).toHaveBeenCalledOnce();
    expect(control.load).not.toHaveBeenCalled();
  });
});

it("pauses, resumes, restarts, persists and expires the real toast timer", async () => {
  const closed = vi.fn();
  render(<toast.ToastProvider />);
  let id = "";
  act(() => {
    id = toast.toastManager.add({
      title: "Counting",
      type: "loading",
      timeout: 0,
      onClose: closed,
    });
  });
  await finishLoad();
  act(() => toast.toastManager.update(id, { type: "success", timeout: 4000 }));
  fireEvent.focus(window, { relatedTarget: document.body });
  const viewport = screen.getByRole("region", { name: "Notifications" });
  const line = () =>
    document.querySelector<HTMLElement>(".toast-progress-line");
  expect(line()?.style.animationDuration).toBe("4000ms");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  fireEvent.mouseEnter(viewport);
  expect(viewport).toHaveAttribute("data-expanded");
  expect(getComputedStyle(line() as HTMLElement).animationPlayState).toBe(
    "paused",
  );
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(closed).not.toHaveBeenCalled();
  fireEvent.mouseLeave(viewport);
  expect(viewport).not.toHaveAttribute("data-expanded");
  expect(getComputedStyle(line() as HTMLElement).animationPlayState).not.toBe(
    "paused",
  );
  act(() => toast.toastManager.update(id, { timeout: 6000 }));
  expect(line()?.style.animationDuration).toBe("6000ms");
  await act(async () => vi.advanceTimersByTimeAsync(5999));
  expect(closed).not.toHaveBeenCalled();
  act(() => toast.toastManager.update(id, { timeout: 0 }));
  expect(line()).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(closed).not.toHaveBeenCalled();
  act(() => toast.toastManager.update(id, { timeout: 4000 }));
  expect(line()?.style.animationDuration).toBe("4000ms");
  await act(async () => vi.advanceTimersByTimeAsync(3999));
  expect(closed).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(closed).toHaveBeenCalledOnce();
});

it("keeps the reduced-motion spinner and toast rules in the rendered production CSS", async () => {
  const { mountCompiledMotionStyles } = await import(
    "../test/compile-motion-css"
  );
  const styles = await mountCompiledMotionStyles([
    "animate-spin",
    "motion-reduce:animate-none",
  ]);
  try {
    expect(styles.css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.motion-reduce\\:animate-none\s*\{\s*animation:\s*none/,
    );
    render(<toast.ToastProvider />);
    let id = "";
    act(() => {
      id = toast.toastManager.add({
        title: "Motion",
        type: "loading",
        timeout: 0,
      });
    });
    await finishLoad();
    act(() =>
      toast.toastManager.update(id, { type: "success", timeout: 4000 }),
    );
    const track = document.querySelector('[data-slot="toast-progress"]');
    expect(track).not.toBeNull();
    const actualRules = track?.querySelector("style")?.textContent ?? "";
    expect(actualRules).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.toast-progress-track\s*\{\s*display:\s*none/,
    );
    expect(actualRules).toMatch(
      /\[data-expanded\][\s\S]*?\.toast-progress-line[\s\S]*?animation-play-state:\s*paused/,
    );
  } finally {
    styles.cleanup();
  }
});
