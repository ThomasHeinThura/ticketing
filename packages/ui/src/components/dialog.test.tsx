import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

afterEach(() => {
  cleanup();
});

describe("Dialog", () => {
  it("renders the close button with the caller-supplied accessible name", () => {
    render(
      <Dialog defaultOpen>
        <DialogPopup closeLabel="Close">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your preferences.</DialogDescription>
        </DialogPopup>
      </Dialog>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closes and returns focus to the trigger when the close button is activated", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open settings</DialogTrigger>
        <DialogPopup closeLabel="Close">
          <DialogTitle>Settings</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open settings" });
    fireEvent.click(trigger);
    expect(screen.getByText("Settings")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    // Base UI restores focus asynchronously (accessibility.md:51: "closing
    // returns focus to the trigger"), so poll rather than assert synchronously.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes and returns focus to the trigger when closed with Escape", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open settings</DialogTrigger>
        <DialogPopup closeLabel="Close">
          <DialogTitle>Settings</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );

    const trigger = screen.getByRole("button", { name: "Open settings" });
    fireEvent.click(trigger);
    expect(screen.getByText("Settings")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText("Settings"), { key: "Escape" });
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("uses the caller-selected final-focus target when the dialog closes", async () => {
    let currentTarget: HTMLButtonElement | null = null;
    const resolveFinalFocus = vi.fn(() => currentTarget ?? false);

    render(
      <>
        <button type="button">Original project trigger</button>
        <button
          type="button"
          ref={(node) => {
            currentTarget = node;
          }}
        >
          Current project trigger
        </button>
        <button type="button">Updated project trigger</button>
        <Dialog defaultOpen>
          <DialogPopup closeLabel="Close" finalFocus={resolveFinalFocus}>
            <DialogTitle>Create work item</DialogTitle>
          </DialogPopup>
        </Dialog>
      </>,
    );

    const currentTrigger = screen.getByRole("button", {
      name: "Current project trigger",
      hidden: true,
    });
    currentTarget = screen.getByRole("button", {
      name: "Updated project trigger",
      hidden: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(resolveFinalFocus).toHaveBeenCalled();
      expect(document.activeElement).toBe(currentTarget);
    });
    expect(currentTrigger).not.toBe(document.activeElement);
  });

  it("does not fall back to a stale default trigger when finalFocus rejects it", async () => {
    const resolveFinalFocus = vi.fn(() => false);

    render(
      <Dialog>
        <DialogTrigger>Stale project trigger</DialogTrigger>
        <DialogPopup closeLabel="Close" finalFocus={resolveFinalFocus}>
          <DialogTitle>Create work item</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );

    const staleTrigger = screen.getByRole("button", {
      name: "Stale project trigger",
    });
    fireEvent.click(staleTrigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(resolveFinalFocus).toHaveBeenCalled());
    expect(document.activeElement).not.toBe(staleTrigger);
  });

  it("does not render a close button when showCloseButton is false", () => {
    render(
      <Dialog defaultOpen>
        <DialogPopup showCloseButton={false}>
          <DialogTitle>Settings</DialogTitle>
        </DialogPopup>
      </Dialog>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no accessibility violations when open", async () => {
    const { baseElement } = render(
      <Dialog defaultOpen>
        <DialogPopup closeLabel="Close">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your preferences.</DialogDescription>
        </DialogPopup>
      </Dialog>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
