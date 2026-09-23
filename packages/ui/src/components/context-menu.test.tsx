import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./context-menu";

afterEach(() => {
  cleanup();
});

describe("ContextMenu", () => {
  it("does not render the content before the trigger is right-clicked", () => {
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Copy</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("opens on a right-click and calls onClick when an item is selected", () => {
    const onCopy = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onCopy}>Copy</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Right-click me"));
    const item = screen.getByText("Copy");
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });
});
