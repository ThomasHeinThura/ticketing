import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { ToastProvider, toastManager } from "./toast";

afterEach(() => {
  cleanup();
});

describe("ToastProvider", () => {
  it("renders a shared toast without accessibility violations", async () => {
    const { baseElement } = render(<ToastProvider />);

    act(() => {
      toastManager.add({ title: "Saved", type: "success" });
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
    await expectNoA11yViolations(baseElement);
  });
});
