import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";
import {
  MenuItem as SplitMenuItem,
  MenuPopup as SplitMenuPopup,
} from "./menu-content";
import {
  Menu as SplitMenu,
  MenuTrigger as SplitMenuTrigger,
} from "./menu-root";

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

  it("has no accessibility violations when open", async () => {
    const { baseElement } = render(
      <Menu>
        <MenuTrigger>Open</MenuTrigger>
        <MenuPopup>
          <MenuItem>Item one</MenuItem>
        </MenuPopup>
      </Menu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Item one")).toBeInTheDocument();

    await expectNoA11yViolations(baseElement);
  });

  it("composes the split root and content modules without changing selection", () => {
    const onSelect = vi.fn();
    render(
      <SplitMenu>
        <SplitMenuTrigger>Open split menu</SplitMenuTrigger>
        <SplitMenuPopup>
          <SplitMenuItem onClick={onSelect}>Split item</SplitMenuItem>
        </SplitMenuPopup>
      </SplitMenu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open split menu" }));
    const item = screen.getByText("Split item");
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
