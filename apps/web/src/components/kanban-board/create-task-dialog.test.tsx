import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardCreateTaskDialog } from "./create-task-dialog";

vi.mock("@/components/shared/modals/create-task-modal", () => ({
  default: ({ status, onClose }: { status: string; onClose: () => void }) => (
    <div data-status={status} role="dialog">
      <button onClick={onClose} type="button">
        Close create dialog
      </button>
    </div>
  ),
}));

function Harness() {
  const [status, setStatus] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        onClick={() => setStatus("backlog")}
        ref={triggerRef}
        type="button"
      >
        Add to backlog
      </button>
      <button onClick={() => setStatus("in-progress")} type="button">
        Add in progress
      </button>
      <BoardCreateTaskDialog
        onClose={() => setStatus(null)}
        projectId="project-1"
        status={status}
        trigger={triggerRef.current}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("board create dialog lazy lifecycle", () => {
  it("opens for the selected column, closes, restores focus, and reopens", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    render(<Harness />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to backlog" }));
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "data-status",
      "backlog",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close create dialog" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to backlog" }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Add in progress" }));
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "data-status",
      "in-progress",
    );
  });
});
