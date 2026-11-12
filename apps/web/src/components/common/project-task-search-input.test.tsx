import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
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

  it.each(["internal", "object", "callback"] as const)(
    "returns focus after clearing with the %s ref",
    (kind) => {
      const objectRef = createRef<HTMLInputElement>();
      const callbackRef = vi.fn();
      function Harness() {
        const [value, setValue] = useState("urgent");
        return (
          <ProjectTaskSearchInput
            value={value}
            onValueChange={setValue}
            placeholder="Search"
            clearLabel="Clear"
            inputRef={
              kind === "object"
                ? objectRef
                : kind === "callback"
                  ? callbackRef
                  : undefined
            }
          />
        );
      }
      render(<Harness />);
      const input = screen.getByRole("searchbox");
      const clear = screen.getByRole("button", { name: "Clear" });
      clear.focus();
      fireEvent.click(clear);
      expect(input).toHaveFocus();
      expect(input).toHaveValue("");
      expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
      if (kind === "object") expect(objectRef.current).toBe(input);
      if (kind === "callback") expect(callbackRef).toHaveBeenCalledWith(input);
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
      expect(input).toHaveFocus();
    },
  );
});
