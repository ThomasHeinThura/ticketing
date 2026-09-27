import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";

afterEach(() => {
  cleanup();
});

describe("AlertDialog", () => {
  it("does not render the popup content when closed", () => {
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogPopup>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
        </AlertDialogPopup>
      </AlertDialog>,
    );

    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Are you sure?")).not.toBeInTheDocument();
  });

  it("opens on trigger click and calls onClick on the confirm action", () => {
    const onConfirm = vi.fn();
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogPopup>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <button onClick={onConfirm} type="button">
              Confirm
            </button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByText("Delete"));
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(
      screen.getByText("This action cannot be undone."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("has no accessibility violations when open", async () => {
    const { baseElement } = render(
      <AlertDialog defaultOpen>
        <AlertDialogPopup>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <button type="button">Cancel</button>
            <button type="button">Confirm</button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>,
    );

    await expectNoA11yViolations(baseElement);
  });
});
