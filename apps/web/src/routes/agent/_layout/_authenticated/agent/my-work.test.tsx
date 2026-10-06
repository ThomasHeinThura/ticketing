import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyApprovalsRoute } from "./my-work";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  query: {
    data: {
      approvals: [
        {
          id: "approval-1",
          workItemKey: "OPS-12",
          workItemTitle: "Review firewall change",
          kind: "cab",
          state: "pending",
          requester: { id: "person-requester", displayName: "Riley" },
          approver: { id: "person-approver", displayName: "Casey" },
          createdAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-10-08T00:00:00.000Z",
          decidedAt: null,
          decisionNote: null,
          approverReachLost: false,
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children }: React.PropsWithChildren) => (
    <a href="/test">{children}</a>
  ),
}));

vi.mock("@/hooks/queries/approval/use-get-my-approvals", () => ({
  default: () => mocks.query,
}));

vi.mock("@/hooks/mutations/approval/use-decide-approval", () => ({
  default: () => ({ mutate: mocks.mutate, isPending: false, isError: false }),
}));

afterEach(() => {
  cleanup();
  mocks.mutate.mockClear();
});

describe("MyApprovalsRoute", () => {
  it("shows the pending request and sends an approval decision", () => {
    render(<MyApprovalsRoute />);
    expect(screen.getByText("Review firewall change")).toBeInTheDocument();
    expect(screen.getByText(/OPS-12 · Requested by Riley/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "approval-1",
      action: "approve",
    });
  });

  it("requires a non-empty note before submitting a rejection", () => {
    render(<MyApprovalsRoute />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const submit = screen.getByRole("button", { name: "Submit rejection" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Rejection note" }), {
      target: { value: "  Needs a rollback plan  " },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "approval-1",
      action: "reject",
      note: "Needs a rollback plan",
    });
  });
});
