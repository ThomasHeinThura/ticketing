import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  AnchoredToastProvider,
  anchoredToastManager,
  ToastProvider,
  toastManager,
} from "./toast";

afterEach(() => {
  cleanup();
  toastManager.close();
  anchoredToastManager.close();
});

describe("ToastProvider", () => {
  it("renders a shared toast without accessibility violations", async () => {
    const { baseElement } = render(<ToastProvider />);

    act(() => {
      toastManager.add({ title: "Saved", type: "success" });
    });

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });
  it("keeps its children mounted while the viewport loads and delivers an early toast", async () => {
    const { container } = render(
      <ToastProvider position="top-left">
        <span data-testid="shell">Work list</span>
      </ToastProvider>,
    );
    const shell = screen.getByTestId("shell");
    const viewport = screen.getByRole("region", { name: "Notifications" });
    expect(viewport).toHaveAttribute("aria-live", "polite");
    expect(shell).toBeVisible();
    act(() => {
      toastManager.add({ title: "Early notification", type: "info" });
    });
    expect(await screen.findByText("Early notification")).toBeVisible();
    expect(screen.getByRole("region", { name: "Notifications" })).toBe(
      viewport,
    );
    expect(container.querySelector('[data-testid="shell"]')).toBe(shell);
    expect(
      document.querySelector('[data-slot="toast-viewport"]'),
    ).toHaveAttribute("data-position", "top-left");
  });
  it("preserves toast actions after the viewport loads", async () => {
    const onClick = vi.fn();
    render(<ToastProvider />);
    act(() => {
      toastManager.add({
        title: "Action available",
        actionProps: { children: "Undo", onClick },
      });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("uses the provider or per-toast lifetime and pauses the decorative line", async () => {
    render(<ToastProvider timeout={8000} />);
    act(() => {
      toastManager.add({ title: "First save", type: "success" });
    });
    await screen.findByText("First save");
    const track = await vi.waitFor(() => {
      const element = document.querySelector('[data-slot="toast-progress"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(track).toHaveAttribute("aria-hidden", "true");
    const line = track.querySelector(".toast-progress-line") as HTMLElement;
    expect(line.style.animationDuration).toBe("8000ms");
    expect(track.querySelector("style")?.textContent).toContain(
      "[data-expanded]",
    );
    expect(track.querySelector("style")?.textContent).toContain(
      "prefers-reduced-motion: reduce",
    );
    expect(track.querySelector("style")?.textContent).toContain(
      "animation-timing-function: var(--ease-progress)",
    );
    fireEvent.blur(window);
    expect(line).toHaveAttribute("data-paused");
    fireEvent.focus(window, { relatedTarget: document.body });
    expect(line).not.toHaveAttribute("data-paused");
    const viewport = screen.getByRole("region", { name: "Notifications" });
    fireEvent.mouseEnter(viewport);
    expect(viewport).toHaveAttribute("data-expanded");
    expect(getComputedStyle(line).animationPlayState).toBe("paused");
    fireEvent.mouseLeave(viewport);
    expect(viewport).not.toHaveAttribute("data-expanded");
    expect(getComputedStyle(line).animationPlayState).not.toBe("paused");
    fireEvent.keyDown(document, { key: "F6" });
    expect(viewport).toHaveFocus();
    expect(viewport).toHaveAttribute("data-expanded");
    expect(getComputedStyle(line).animationPlayState).toBe("paused");
    fireEvent.blur(viewport, { relatedTarget: document.body });
    expect(viewport).not.toHaveAttribute("data-expanded");
    expect(getComputedStyle(line).animationPlayState).not.toBe("paused");
    let secondId = "";
    act(() => {
      secondId = toastManager.add({ title: "Second save", type: "success" });
    });
    const second = await screen.findByText("Second save");
    expect(
      second.closest("[data-position]")?.querySelector(".toast-progress-line"),
    ).toBeNull();
    act(() => {
      toastManager.update(secondId, { timeout: 8000 });
    });
    expect(
      second
        .closest("[data-position]")
        ?.querySelector<HTMLElement>(".toast-progress-line")?.style
        .animationDuration,
    ).toBe("8000ms");
    let customId = "";
    act(() => {
      customId = toastManager.add({
        title: "Custom save",
        type: "success",
        timeout: 12000,
      });
    });
    const custom = await screen.findByText("Custom save");
    expect(
      custom.closest("[data-position]")?.querySelector(".toast-progress-line"),
    ).toBeNull();
    act(() => {
      toastManager.update(customId, { timeout: 13000 });
    });
    expect(
      custom
        .closest("[data-position]")
        ?.querySelector<HTMLElement>(".toast-progress-line")?.style
        .animationDuration,
    ).toBe("13000ms");
    act(() => {
      toastManager.add({
        title: "Persistent save",
        type: "success",
        timeout: 0,
      });
    });
    const persistent = await screen.findByText("Persistent save");
    expect(
      persistent
        .closest("[data-position]")
        ?.querySelector(".toast-progress-line"),
    ).toBeNull();
  });

  it("hides ambiguous text updates and restarts on a new timeout or loading completion", async () => {
    render(<ToastProvider timeout={8000} />);
    let id = "";
    act(() => {
      id = toastManager.add({ title: "Original", type: "success" });
    });
    await screen.findByText("Original");
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-slot="toast-progress"]'),
      ).not.toBeNull(),
    );
    act(() => {
      toastManager.update(id, { title: "Renamed" });
    });
    const renamed = await screen.findByText("Renamed");
    expect(
      renamed
        .closest("[data-position]")
        ?.querySelector('[data-slot="toast-progress"]'),
    ).toBeNull();
    act(() => {
      toastManager.update(id, { timeout: 12000 });
    });
    expect(
      renamed
        .closest("[data-position]")
        ?.querySelector<HTMLElement>(".toast-progress-line")?.style
        .animationDuration,
    ).toBe("12000ms");
    act(() => {
      toastManager.add({
        id,
        title: "Upserted",
        type: "success",
        timeout: 12000,
      });
    });
    const upserted = await screen.findByText("Upserted");
    expect(
      upserted
        .closest("[data-position]")
        ?.querySelector('[data-slot="toast-progress"]'),
    ).toBeNull();
    act(() => {
      toastManager.update(id, { timeout: 0 });
    });
    expect(
      upserted
        .closest("[data-position]")
        ?.querySelector('[data-slot="toast-progress"]'),
    ).toBeNull();
    act(() => {
      toastManager.update(id, { type: "loading", timeout: 3000 });
    });
    act(() => {
      toastManager.update(id, { type: "success" });
    });
    expect(
      upserted
        .closest("[data-position]")
        ?.querySelector<HTMLElement>(".toast-progress-line")?.style
        .animationDuration,
    ).toBe("3000ms");
  });

  it("renders anchored notifications through the separate shared manager", async () => {
    const anchor = document.createElement("span");
    document.body.append(anchor);
    try {
      render(<AnchoredToastProvider />);
      act(() => {
        anchoredToastManager.add({
          title: "Anchored notification",
          positionerProps: { anchor },
        });
      });
      expect(
        await screen.findByText("Anchored notification"),
      ).toBeInTheDocument();
      expect(
        document.querySelector('[data-slot="toast-viewport-anchored"]'),
      ).toBeInTheDocument();
    } finally {
      anchor.remove();
    }
  });
});
