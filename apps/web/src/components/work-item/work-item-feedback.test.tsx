import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  useWorkItemFeedback,
  WorkItemFeedbackProvider,
} from "./work-item-feedback";

let announce: (message: string) => void = () => {};
function Capture() {
  announce = useWorkItemFeedback().announce;
  return null;
}

describe("WorkItemFeedbackProvider", () => {
  it("changes the live region for a repeated message so it is announced again", () => {
    render(
      <WorkItemFeedbackProvider>
        <Capture />
      </WorkItemFeedbackProvider>,
    );
    const region = screen.getByTestId("work-item-status");
    expect(region).toHaveAttribute("role", "status");
    act(() => announce("Changes saved."));
    const first = region.textContent;
    act(() => announce("Changes saved."));
    const second = region.textContent;
    act(() => announce("Changes saved."));
    expect(first).toContain("Changes saved.");
    expect(second).toContain("Changes saved.");
    expect(second).not.toBe(first);
    expect(region.textContent).not.toBe(second);
  });
});
