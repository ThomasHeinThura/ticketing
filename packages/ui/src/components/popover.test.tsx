import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Popover, PopoverPopup, PopoverTrigger } from "./popover";

afterEach(() => {
  cleanup();
});

describe("Popover", () => {
  it("does not render the popup content when closed", () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup>Popup content</PopoverPopup>
      </Popover>,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByText("Popup content")).not.toBeInTheDocument();
  });

  it("renders the popup content after the trigger is clicked", () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup>Popup content</PopoverPopup>
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Popup content")).toBeInTheDocument();
  });
});
