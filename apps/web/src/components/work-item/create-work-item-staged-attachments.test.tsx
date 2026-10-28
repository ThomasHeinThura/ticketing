import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import CreateWorkItemStagedAttachments from "./create-work-item-staged-attachments";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it("uses original card styles, allows removing only local files and shows precise persisted failures", () => {
  const remove = vi.fn();
  render(
    <CreateWorkItemStagedAttachments
      disabled={false}
      onRemove={remove}
      rows={[
        { id: 1, file: new File(["a"], "local.txt"), state: "staged" },
        { id: 2, file: new File(["b"], "saved.txt"), state: "ready" },
        {
          id: 3,
          file: new File(["c"], "bad.exe"),
          state: "failed",
          error: new HttpError(400, "Executable files are blocked"),
        },
      ]}
    />,
  );
  expect(
    screen.getByText("local.txt").closest(".taskdesk-attachment-card"),
  ).not.toBeNull();
  // Staged and failed files can be removed; an attached one cannot.
  expect(screen.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button")[0] as HTMLElement);
  expect(remove).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getAllByRole("button")[1] as HTMLElement);
  expect(remove).toHaveBeenCalledWith(3);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Executable files are blocked",
  );
});
