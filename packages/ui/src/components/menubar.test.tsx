import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "./menubar";

afterEach(() => {
  cleanup();
});

describe("Menubar", () => {
  it("does not render a menu's content before its trigger is clicked", () => {
    render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );

    expect(screen.getByText("File")).toBeInTheDocument();
    expect(screen.queryByText("New")).not.toBeInTheDocument();
  });

  it("opens a menu on trigger click and calls onClick when an item is selected", () => {
    const onNew = vi.fn();
    render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onClick={onNew}>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );

    fireEvent.click(screen.getByText("File"));
    const item = screen.getByText("New");
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
