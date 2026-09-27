import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider, toastManager } from "./toast";

afterEach(() => {
  cleanup();
});

describe("ToastProvider", () => {
  it("renders a toast added through the shared toastManager", () => {
    render(<ToastProvider />);

    act(() => {
      toastManager.add({ title: "Saved", type: "success" });
    });

    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
