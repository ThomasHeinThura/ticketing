import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TaskDetailContentPresentation,
  TaskTitlePresentation,
} from "./task-detail-presentation";

afterEach(cleanup);
describe("shared Kaneo task presentation", () => {
  it("places core task sections in original order before Activity", () => {
    render(
      <TaskDetailContentPresentation
        className="flex flex-col"
        heading={<h1>Title</h1>}
        subtasks={<section aria-label="Sub-tasks" />}
        relations={<section aria-label="Relations" />}
        activity={<section aria-label="Activity" />}
      />,
    );
    const title = screen.getByRole("heading", { name: "Title" });
    const subtasks = screen.getByRole("region", { name: "Sub-tasks" });
    const relations = screen.getByRole("region", { name: "Relations" });
    const activity = screen.getByRole("region", { name: "Activity" });
    expect(
      title.compareDocumentPosition(subtasks) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      subtasks.compareDocumentPosition(relations) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      relations.compareDocumentPosition(activity) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it("uses a wrapping title field while retaining original typography and read-only access", () => {
    const longTitle = "A long persisted task title ".repeat(15);
    render(
      <TaskTitlePresentation aria-label="Title" value={longTitle} readOnly />,
    );
    const title = screen.getByRole("textbox", { name: "Title" });
    expect(title.tagName).toBe("TEXTAREA");
    expect(title).toHaveValue(longTitle);
    expect(title).toHaveAttribute("readonly");
    expect(title.closest("[data-slot=textarea-control]")).toHaveClass(
      "[&_textarea]:text-[2rem]",
      "[&_textarea]:leading-[1.15]",
    );
  });
});
