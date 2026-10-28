import { Timeline } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActivityEventPresentation,
  CommentCardPresentation,
} from "./comment-card-presentation";

afterEach(cleanup);
describe("shared original Kaneo activity presentation", () => {
  it("keeps supplied controls functional and the native comment focus anchor on the card", () => {
    const ref = createRef<HTMLDivElement>();
    const edit = vi.fn();
    render(
      <CommentCardPresentation
        ref={ref}
        id="comment-1"
        tabIndex={-1}
        header={<span>Actor</span>}
        actions={
          // ui-exempt: test callback standing in for the persisted controller's shared Button.
          <button type="button" onClick={edit}>
            Edit
          </button>
        }
        footer={<span>Save controls</span>}
      >
        <p>Comment body</p>
      </CommentCardPresentation>,
    );
    expect(ref.current).toBe(document.getElementById("comment-1"));
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(edit).toHaveBeenCalledOnce();
    expect(
      screen
        .getByText("Actor")
        .compareDocumentPosition(screen.getByText("Comment body")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByText("Comment body")
        .compareDocumentPosition(screen.getByText("Save controls")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("uses original TimelineItem geometry for server events without introducing comment cards", () => {
    render(
      <Timeline role="list">
        <ActivityEventPresentation
          step={1}
          icon={<span>Event icon</span>}
          avatar={<span>Avatar</span>}
          actor={<span>Actor</span>}
          timestamp={<time>Now</time>}
          showConnector
        >
          <span>Changed state</span>
        </ActivityEventPresentation>
      </Timeline>,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-slot", "timeline-item");
    expect(row).toHaveClass("flex-row", "items-center", "gap-3");
    expect(
      row.querySelector('[data-slot="timeline-content"]'),
    ).toHaveTextContent("Actor Changed state Now");
    expect(row).not.toHaveClass("border", "rounded-lg");
  });
});
