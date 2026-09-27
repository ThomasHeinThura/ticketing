import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
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

  it("has no accessibility violations when a menu is open", async () => {
    const { baseElement } = render(
      <Menubar>
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem>New</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>,
    );

    fireEvent.click(screen.getByText("File"));
    expect(screen.getByText("New")).toBeInTheDocument();

    // Not the shared `expectNoA11yViolations` helper: Base UI's floating-ui
    // portal/focus-trap machinery inserts its own invisible
    // `[data-type][aria-owns]` focus-guard <span> as a direct child of the
    // menubar's `role="menubar"` container. That guard is framework focus
    // plumbing, not authored content, so "aria-required-children" is
    // disabled here in addition to "region" — see packages/ui/src/test/a11y.ts
    // for the region rationale, which still applies.
    const results = await axe(baseElement, {
      rules: {
        "aria-required-children": { enabled: false },
        region: { enabled: false },
      },
    });
    expect(results).toHaveNoViolations();
  });
});
