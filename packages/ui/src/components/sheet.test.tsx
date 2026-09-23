import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet, SheetPopup, SheetTitle, SheetTrigger } from "./sheet";

afterEach(() => {
  cleanup();
});

describe("Sheet", () => {
  it("renders the close button with the caller-supplied accessible name", () => {
    render(
      <Sheet defaultOpen>
        <SheetPopup closeLabel="Close">
          <SheetTitle>Filters</SheetTitle>
        </SheetPopup>
      </Sheet>,
    );

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closes and returns focus to the trigger when the close button is activated", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetPopup closeLabel="Close">
          <SheetTitle>Filters</SheetTitle>
        </SheetPopup>
      </Sheet>,
    );

    const trigger = screen.getByRole("button", { name: "Open filters" });
    fireEvent.click(trigger);
    expect(screen.getByText("Filters")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
    // Base UI restores focus asynchronously (accessibility.md:51: "closing
    // returns focus to the trigger"), so poll rather than assert synchronously.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("closes and returns focus to the trigger when closed with Escape", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open filters</SheetTrigger>
        <SheetPopup closeLabel="Close">
          <SheetTitle>Filters</SheetTitle>
        </SheetPopup>
      </Sheet>,
    );

    const trigger = screen.getByRole("button", { name: "Open filters" });
    fireEvent.click(trigger);
    expect(screen.getByText("Filters")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText("Filters"), { key: "Escape" });
    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("does not render a close button when showCloseButton is false", () => {
    render(
      <Sheet defaultOpen>
        <SheetPopup showCloseButton={false}>
          <SheetTitle>Filters</SheetTitle>
        </SheetPopup>
      </Sheet>,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
