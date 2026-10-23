import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import TaskDragPreview from "./task-drag-preview";

afterEach(cleanup);
it("uses the original compact flag/key/title preview without interactive substitutes", () => {
  render(
    <TaskDragPreview
      projectSlug="HELP"
      task={{ number: 7, title: "Real work title", priority: "high" }}
    />,
  );
  const preview = screen.getByTestId("list-task-drag-preview");
  expect(preview).toHaveClass(
    "bg-card",
    "border",
    "rounded-lg",
    "shadow-lg",
    "p-2",
    "max-w-[200px]",
    "cursor-grabbing",
  );
  expect(preview).toHaveTextContent("HELP-7");
  expect(preview).toHaveTextContent("Real work title");
  expect(preview.querySelector("svg")).not.toBeNull();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
