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
