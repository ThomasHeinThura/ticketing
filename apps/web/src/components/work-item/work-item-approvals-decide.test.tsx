import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkItemApprovals from "./work-item-approvals";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  my: [] as { id: string }[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { role: "user" } }),
}));
vi.mock("@/hooks/queries/approval/use-get-work-item-approvals", () => ({
  default: () => ({
    isLoading: false,
    isError: false,
    data: {
      approvals: [
        {
          id: "approval-1",
          kind: "customer",
          state: "pending",
          requester: { id: "r", displayName: "Riley" },
          approver: { id: "a", displayName: "Casey" },
          createdAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-10-08T00:00:00.000Z",
          decidedAt: null,
          decisionNote: null,
          approverReachLost: false,
          canWithdraw: false,
        },
      ],
    },
  }),
}));
vi.mock("@/hooks/queries/approval/use-get-my-approvals", () => ({
  default: () => ({ data: { approvals: mocks.my } }),
}));
vi.mock("@/hooks/mutations/approval/use-decide-approval", () => ({
  default: () => ({ mutate: mocks.decide, isPending: false, isError: false }),
}));
vi.mock("@/hooks/mutations/approval/use-withdraw-approval", () => ({
  default: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("./request-approval", () => ({ default: () => null }));

describe("WorkItemApprovals decisions", () => {
  beforeEach(() => {
    mocks.decide.mockReset();
  });

  it("offers no decision on an approval addressed to someone else", () => {
    mocks.my = [];
    render(<WorkItemApprovals workItemKey="HELP-7" />);
    expect(
      screen.queryByRole("button", {
        name: "workItems:detail.approvals.approve",
      }),
    ).toBeNull();
  });

  it("approves an approval addressed to the viewer", () => {
    mocks.my = [{ id: "approval-1" }];
    render(<WorkItemApprovals workItemKey="HELP-7" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:detail.approvals.approve",
      }),
    );
    expect(mocks.decide).toHaveBeenCalledWith({
      id: "approval-1",
      action: "approve",
    });
  });

  it("requires a note before rejecting", () => {
    mocks.my = [{ id: "approval-1" }];
    render(<WorkItemApprovals workItemKey="HELP-7" />);
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:detail.approvals.reject" }),
    );
    const confirm = screen.getByRole("button", {
      name: "workItems:detail.approvals.confirmReject",
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(
      screen.getByLabelText("workItems:detail.approvals.rejectNote"),
      { target: { value: "Out of policy" } },
    );
    fireEvent.click(confirm);
    expect(mocks.decide).toHaveBeenCalledWith(
      { id: "approval-1", action: "reject", note: "Out of policy" },
      expect.anything(),
    );
  });
});
