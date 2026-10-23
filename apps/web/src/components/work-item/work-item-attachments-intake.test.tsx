vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { act, cleanup, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  useWorkItemFileIntake,
  WorkItemFileDropOverlay,
} from "./work-item-attachments-intake";

function Harness({
  enabled = true,
  onFiles,
}: {
  enabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const { dragging, bounds } = useWorkItemFileIntake({
    enabled,
    onFiles,
    anchorRef: anchor,
  });
  return (
    <div>
      <div data-testid="outside" />
      <div data-work-item-intake-scope="" data-testid="detail">
        <div ref={anchor} data-testid="inside" />
      </div>
      <WorkItemFileDropOverlay active={dragging} bounds={bounds} />
    </div>
  );
}
const inside = () => screen.getByTestId("inside");
const outside = () => screen.getByTestId("outside");

function dragEvent(type: string, files: File[], withFiles = true) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: withFiles ? ["Files"] : ["text/plain"], files },
  });
  return event;
}

afterEach(cleanup);

describe("AT-10/AT-11 detail-wide file intake", () => {
  it("shows the drop target while files are dragged and attaches every dropped file", () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    const files = [new File(["a"], "a.png"), new File(["b"], "b.pdf")];
    act(() => {
      inside().dispatchEvent(dragEvent("dragenter", files));
    });
    expect(screen.getByTestId("work-item-drop-overlay")).toBeInTheDocument();
    const over = dragEvent("dragover", files);
    act(() => {
      inside().dispatchEvent(over);
    });
    // Allowing the drop also stops the browser from navigating to the file.
    expect(over.defaultPrevented).toBe(true);
    act(() => {
      inside().dispatchEvent(dragEvent("drop", files));
    });
    expect(onFiles).toHaveBeenCalledWith(files);
    expect(screen.queryByTestId("work-item-drop-overlay")).toBeNull();
  });

  it("ignores files dropped or pasted outside the detail, such as on the board behind a side pane", () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    const files = [new File(["a"], "a.png")];
    act(() => {
      outside().dispatchEvent(dragEvent("dragenter", files));
    });
    expect(screen.queryByTestId("work-item-drop-overlay")).toBeNull();
    const drop = dragEvent("drop", files);
    act(() => {
      outside().dispatchEvent(drop);
      document.dispatchEvent(dragEvent("drop", files));
    });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files } });
    act(() => {
      outside().dispatchEvent(paste);
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect(drop.defaultPrevented).toBe(false);
  });

  it("ignores drags that carry no files", () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    act(() => {
      inside().dispatchEvent(dragEvent("dragenter", [], false));
      inside().dispatchEvent(dragEvent("drop", [], false));
    });
    expect(screen.queryByTestId("work-item-drop-overlay")).toBeNull();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("leaves a drop an editor already handled alone, so staged comment files are not attached twice", () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    const editorHandled = dragEvent("drop", [new File(["a"], "a.png")]);
    editorHandled.preventDefault();
    act(() => {
      inside().dispatchEvent(editorHandled);
    });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("attaches files pasted from the clipboard, such as a screenshot, but not pasted text", () => {
    const onFiles = vi.fn();
    render(<Harness onFiles={onFiles} />);
    const screenshot = new File(["png"], "image.png", { type: "image/png" });
    const paste = (files: File[]) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { files } });
      inside().dispatchEvent(event);
      return event;
    };
    act(() => {
      paste([]);
    });
    expect(onFiles).not.toHaveBeenCalled();
    act(() => {
      paste([screenshot]);
    });
    expect(onFiles).toHaveBeenCalledWith([screenshot]);
  });

  it("does nothing without the capability to attach", () => {
    const onFiles = vi.fn();
    render(<Harness enabled={false} onFiles={onFiles} />);
    act(() => {
      inside().dispatchEvent(dragEvent("dragenter", [new File(["a"], "a")]));
      inside().dispatchEvent(dragEvent("drop", [new File(["a"], "a")]));
    });
    expect(screen.queryByTestId("work-item-drop-overlay")).toBeNull();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stops listening when the detail unmounts", () => {
    const onFiles = vi.fn();
    const view = render(<Harness onFiles={onFiles} />);
    const target = inside();
    view.unmount();
    act(() => {
      target.dispatchEvent(dragEvent("drop", [new File(["a"], "a")]));
    });
    expect(onFiles).not.toHaveBeenCalled();
  });
});
