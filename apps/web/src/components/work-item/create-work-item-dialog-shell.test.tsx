import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateWorkItemDialog from "./create-work-item-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("./create-work-item-dialog-form", () => ({
  default: () => <div data-testid="create-work-item-form">Form</div>,
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("CreateWorkItemDialog shared shell", () => {
  it("opens the native dialog immediately and restores focus when closed", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open create dialog
          </button>
          <CreateWorkItemDialog
            open={open}
            onClose={() => setOpen(false)}
            projectId="project-1"
            workspaceId="workspace-1"
          />
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open create dialog" });
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(await screen.findByTestId("create-work-item-form")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.close" }),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
