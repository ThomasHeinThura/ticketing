import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";

afterEach(() => {
  cleanup();
});

describe("Menu", () => {
  it("does not render the popup content when closed", () => {
    render(
      <Menu>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPopup>
          <MenuItem>Item one</MenuItem>
        </MenuPopup>
      </Menu>,
    );

    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.queryByText("Item one")).not.toBeInTheDocument();
  });

  it("opens the popup when the trigger is clicked and calls onClick when an item is selected", () => {
    const onSelect = vi.fn();
    render(
      <Menu>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPopup>
          <MenuItem onClick={onSelect}>Item one</MenuItem>
        </MenuPopup>
      </Menu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const item = screen.getByText("Item one");
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
