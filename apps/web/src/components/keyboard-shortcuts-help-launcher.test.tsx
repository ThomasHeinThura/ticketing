import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyboardShortcutsHelpLauncher from "./keyboard-shortcuts-help-launcher";

const mock = vi.hoisted(() => ({ loaded: vi.fn() }));

vi.mock("./keyboard-shortcuts-help", () => {
  mock.loaded();
  return {
    KeyboardShortcutsHelp: ({
      open,
      onOpenChange,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    }) =>
      open ? (
        <div role="dialog">
          {(() => {
            return (
              // ui-exempt: this mock exposes the dialog's close callback.
              <button type="button" onClick={() => onOpenChange(false)}>
                Close shortcuts
              </button>
            );
          })()}
        </div>
      ) : null,
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("KeyboardShortcutsHelpLauncher", () => {
  it("loads the dialog only for the global help key and preserves typing", async () => {
    render(<KeyboardShortcutsHelpLauncher />);
    expect(mock.loaded).not.toHaveBeenCalled();

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: "?" });
    expect(mock.loaded).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(document, { key: "?" });
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeVisible());
    expect(mock.loaded).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Close shortcuts" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    input.remove();
  });
});
