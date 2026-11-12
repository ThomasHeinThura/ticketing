import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDateTime } from "@/lib/format";
import { translate } from "@/test/en-translation";
import {
  type StaffSubmissionQueueRow,
  SubmissionQueueTable,
} from "./submission-queue-table";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(`intake:${key}`, options),
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => (
    <a href="/work-item" {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/common/action-tooltip", () => ({
  ActionTooltip: ({ children }: { children: ReactNode }) => children,
}));

afterEach(cleanup);

const createdAt = "2026-10-31T19:32:37Z";
const row: StaffSubmissionQueueRow = {
  ref: "SUB-3",
  summary: "VPN drops every hour",
  submission: { state: "new", createdAt, claimedBy: null },
  requestType: { id: "rt-1", name: "Access request" },
  requester: { displayName: "Ada Lovelace" },
  organisation: { name: "Northstar Logistics International" },
  suggestedDuplicates: [{ id: "w1", key: "HELP-4", title: "VPN flaps" }],
};

function renderTable(onOpenSubmission = vi.fn()) {
  render(
    <SubmissionQueueTable
      rows={[row]}
      onOpenSubmission={onOpenSubmission}
      now={Date.parse("2026-11-01T19:32:37Z")}
    />,
  );
  return onOpenSubmission;
}

describe("SubmissionQueueTable", () => {
  it("opens the submission from a click anywhere on its row", () => {
    const open = renderTable();
    fireEvent.click(screen.getByText("VPN drops every hour"));
    expect(open).toHaveBeenCalledWith("SUB-3");
    const triageRow = screen.getByTestId("triage-row-SUB-3");
    expect(triageRow).toHaveClass(
      "cursor-pointer",
      "press-feedback",
      "[--press-scale:0.99]",
    );
    expect(triageRow).toHaveAttribute("data-interactive", "");
    const headerRow = screen.getAllByRole("row")[0];
    expect(headerRow).not.toHaveClass("press-feedback");
    expect(headerRow).not.toHaveAttribute("data-interactive");
  });

  it("opens once from the reference and leaves a duplicate link to itself", () => {
    const open = renderTable();
    fireEvent.click(screen.getByRole("button", { name: "SUB-3" }));
    expect(open).toHaveBeenCalledTimes(1);
    open.mockClear();
    fireEvent.click(screen.getByRole("link", { name: "HELP-4" }));
    expect(open).not.toHaveBeenCalled();
  });

  it("does not open when the click ends a text selection", () => {
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "VPN" } as Selection);
    const open = renderTable();
    fireEvent.click(screen.getByText("VPN drops every hour"));
    expect(open).not.toHaveBeenCalled();
    selection.mockRestore();
  });

  it("shows Submitted in the app's date format, without seconds", () => {
    renderTable();
    const submitted = screen.getByTestId("triage-row-submitted");
    expect(submitted).toHaveTextContent(formatDateTime(createdAt));
    expect(submitted).not.toHaveTextContent(
      new Date(createdAt).toLocaleString(),
    );
  });

  it("keeps long customer and organisation names on one line with the full name as a title", () => {
    renderTable();
    const organisation = screen.getByText("Northstar Logistics International");
    expect(organisation).toHaveClass("truncate");
    expect(organisation).toHaveAttribute(
      "title",
      "Northstar Logistics International",
    );
    expect(screen.getByText("Ada Lovelace")).toHaveClass("truncate");
  });
});
