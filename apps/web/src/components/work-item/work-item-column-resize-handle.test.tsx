import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkItemColumnResizeHandle from "./work-item-column-resize-handle";

function mount(
  overrides: Partial<Parameters<typeof WorkItemColumnResizeHandle>[0]> = {},
) {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const props = {
    label: "Resize Title column",
    currentWidth: 120,
    onPreview,
    onCommit,
    onCancel,
    ...overrides,
  };
  const view = render(
    <table>
      <thead>
        <tr>
          <th>
            <WorkItemColumnResizeHandle {...props} />
          </th>
        </tr>
      </thead>
    </table>,
  );
  return {
    handle: screen.getByRole("separator", { name: props.label }),
    onPreview,
    onCommit,
    onCancel,
    unmount: view.unmount,
    rerender: (
      next: Partial<Parameters<typeof WorkItemColumnResizeHandle>[0]>,
    ) =>
      view.rerender(
        <table>
          <thead>
            <tr>
              <th>
                <WorkItemColumnResizeHandle {...props} {...next} />
              </th>
            </tr>
          </thead>
        </table>,
      ),
  };
}

describe("WorkItemColumnResizeHandle", () => {
  it("previews pointer movement but commits once on pointerup", () => {
    const { handle, onPreview, onCommit, onCancel } = mount();
    fireEvent.pointerDown(handle, {
      pointerId: 7,
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, {
      pointerId: 7,
      clientX: 145,
    });

    expect(handle).toHaveAttribute("aria-valuenow", "165");
    expect(onPreview).toHaveBeenLastCalledWith(165);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, {
      pointerId: 7,
      clientX: 145,
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(165, 120);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each(["Escape", "pointercancel"] as const)(
    "restores the starting width and writes nothing on %s",
    (cancelType) => {
      const { handle, onCommit, onCancel } = mount();
      fireEvent.pointerDown(handle, {
        pointerId: 3,
        button: 0,
        clientX: 100,
      });
      fireEvent.pointerMove(handle, { pointerId: 3, clientX: 180 });

      if (cancelType === "Escape") {
        // Pointer-down prevents default focus, so Escape must still cancel from
        // the document while the pointer is captured by the separator.
        fireEvent.keyDown(document, { key: "Escape" });
        fireEvent.pointerUp(handle, { pointerId: 3, clientX: 180 });
      } else fireEvent.pointerCancel(handle, { pointerId: 3 });

      expect(handle).toHaveAttribute("aria-valuenow", "120");
      expect(onCancel).toHaveBeenCalledWith(120);
      expect(onCommit).not.toHaveBeenCalled();
    },
  );

  it("commits keyboard changes with bounded Home and End values", () => {
    const { handle, onCommit } = mount();
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "End" });
    fireEvent.keyDown(handle, { key: "Home" });

    expect(onCommit.mock.calls).toEqual([
      [128, 120],
      [800, 128],
      [64, 800],
    ]);
    expect(handle).toHaveAttribute("aria-valuemin", "64");
    expect(handle).toHaveAttribute("aria-valuemax", "800");
    expect(handle).toHaveAttribute("aria-valuenow", "64");
  });

  it("supports reversed sidebar dragging and keyboard resizing within its own bounds", () => {
    const { handle, onPreview, onCommit } = mount({
      label: "Resize Properties panel",
      currentWidth: 360,
      minWidth: 240,
      maxWidth: 520,
      direction: "reverse",
      stretch: true,
    });
    expect(handle).toHaveAttribute("aria-valuemin", "240");
    expect(handle).toHaveAttribute("aria-valuemax", "520");
    expect(handle).toHaveClass("h-full");

    fireEvent.pointerDown(handle, {
      pointerId: 8,
      button: 0,
      clientX: 200,
    });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 160 });
    expect(handle).toHaveAttribute("aria-valuenow", "400");
    expect(onPreview).toHaveBeenLastCalledWith(400);
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 160 });
    expect(onCommit).toHaveBeenLastCalledWith(400, 360);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenLastCalledWith(408, 400);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(520, 408);
    expect(handle).toHaveAttribute("aria-valuenow", "520");
  });

  it("cancels an active drag when its project scope changes", () => {
    const { handle, onCommit, onCancel, rerender } = mount({
      scopeKey: "project-one",
    });
    fireEvent.pointerDown(handle, {
      pointerId: 4,
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 155 });

    rerender({ scopeKey: "project-two" });
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 155 });

    expect(onCancel).toHaveBeenCalledWith(120);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("restores an active preview and clears its key handler on unmount", () => {
    const { handle, onCommit, onCancel, unmount } = mount();
    fireEvent.pointerDown(handle, {
      pointerId: 5,
      button: 0,
      clientX: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 5, clientX: 160 });

    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(handle, { pointerId: 5, clientX: 160 });

    expect(onCancel).toHaveBeenCalledWith(120);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
