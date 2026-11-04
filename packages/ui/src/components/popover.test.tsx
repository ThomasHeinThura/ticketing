import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "./popover";

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

  it("accepts anchor tracking control for the positioner", () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup disableAnchorTracking>Popup content</PopoverPopup>
      </Popover>,
    );

    expect(screen.getByText("Popup content")).toBeInTheDocument();
  });

  it("pauses native anchor observers while closed and restores them when reopened", async () => {
    const resizeObservers: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    const originalResizeObserver = window.ResizeObserver;

    class ResizeObserverProbe {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);

      constructor(_callback: ResizeObserverCallback) {
        resizeObservers.push(this);
      }
    }

    window.ResizeObserver =
      ResizeObserverProbe as unknown as typeof ResizeObserver;

    function ControlledPopover() {
      const [open, setOpen] = useState(false);
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverPopup disableAnchorTracking={!open}>
            Popup content
          </PopoverPopup>
        </Popover>
      );
    }

    try {
      render(<ControlledPopover />);
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      await waitFor(() => {
        expect(
          resizeObservers.some(
            (observer) => observer.observe.mock.calls.length > 0,
          ),
        ).toBe(true);
      });

      const trackedResizeObserver = resizeObservers.find(
        (observer) => observer.observe.mock.calls.length > 0,
      );
      expect(trackedResizeObserver).toBeDefined();

      fireEvent.click(screen.getByRole("button", { name: "Open" }));
      await waitFor(() => {
        expect(trackedResizeObserver?.disconnect).toHaveBeenCalled();
      });

      const resizeObserverCount = resizeObservers.length;
      fireEvent.click(screen.getByRole("button", { name: "Open" }));

      await waitFor(() => {
        expect(resizeObservers.length).toBeGreaterThan(resizeObserverCount);
        expect(
          resizeObservers
            .slice(resizeObserverCount)
            .some((observer) => observer.observe.mock.calls.length > 0),
        ).toBe(true);
      });
    } finally {
      window.ResizeObserver = originalResizeObserver;
    }
  });

  it("has no accessibility violations when open", async () => {
    const { baseElement } = render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup>
          <PopoverTitle>Notifications</PopoverTitle>
        </PopoverPopup>
      </Popover>,
    );

    await expectNoA11yViolations(baseElement);
  });

  // UAT re-audit: option pickers rendered unnamed role=dialog popups (axe aria-dialog-name).
  it("names an unlabelled popup by the trigger that opened it", async () => {
    const { baseElement } = render(
      <Popover>
        <PopoverTrigger aria-label="Priority">High</PopoverTrigger>
        <PopoverPopup>
          <span>Urgent</span>
        </PopoverPopup>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Priority" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAccessibleName("Priority"));
    await expectNoA11yViolations(baseElement);
  });

  it("keeps an explicit aria-label or title over the trigger name", async () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup aria-label="Choose a status">
          <span>Todo</span>
        </PopoverPopup>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Choose a status");
    expect(dialog).not.toHaveAttribute("aria-labelledby");
    cleanup();

    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup>
          <PopoverTitle>Notifications</PopoverTitle>
        </PopoverPopup>
      </Popover>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("dialog")).toHaveAccessibleName(
      "Notifications",
    );
  });

  it("forwards its ref to the popup element", () => {
    const ref = { current: null as HTMLDivElement | null };
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverPopup ref={ref}>content</PopoverPopup>
      </Popover>,
    );
    expect(ref.current?.getAttribute("data-slot")).toBe("popover-popup");
  });

  it("names the popup even when the rendered trigger carries no id", async () => {
    render(
      <Popover>
        <PopoverTrigger aria-label="Filter activity">Everything</PopoverTrigger>
        <PopoverPopup>
          <span>All activity</span>
        </PopoverPopup>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Filter activity" });
    trigger.removeAttribute("id");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog).toHaveAccessibleName("Filter activity"));
  });
});
