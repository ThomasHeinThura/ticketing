import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
