import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectTaskSearchInput from "./project-task-search-input";

afterEach(cleanup);

describe("ProjectTaskSearchInput", () => {
  it("shows an active query and exposes a direct clear action", () => {
    const onValueChange = vi.fn();
    render(
      <ProjectTaskSearchInput
        value="release blocker"
        onValueChange={onValueChange}
        placeholder="Search tickets..."
        clearLabel="Clear search"
      />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search tickets..." }),
    ).toHaveValue("release blocker");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith("");
  });

  it("keeps search reachable from the keyboard shortcut when the query is empty", () => {
    render(
      <ProjectTaskSearchInput
        value=""
        onValueChange={vi.fn()}
        placeholder="Search tickets..."
        clearLabel="Clear search"
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search tickets..." });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
  });
});
