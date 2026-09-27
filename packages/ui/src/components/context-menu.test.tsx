import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
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

  it("has no accessibility violations when open", async () => {
    const { baseElement } = render(
      <ContextMenu>
        <ContextMenuTrigger>Right-click me</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Copy</ContextMenuItem>
          <ContextMenuItem>Paste</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Right-click me"));
    expect(screen.getByText("Copy")).toBeInTheDocument();

    await expectNoA11yViolations(baseElement);
  });
});
