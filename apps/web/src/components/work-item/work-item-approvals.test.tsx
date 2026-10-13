import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import WorkItemApprovals from "./work-item-approvals";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1", role: "user" } as { id: string; role?: string | null },
  query: {} as Record<string, unknown>,
  mutation: {} as Record<string, unknown>,
  withdraw: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options).join(",")}`
        : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/hooks/queries/approval/use-get-work-item-approvals", () => ({
  default: () => mocks.query,
}));

vi.mock("@/hooks/mutations/approval/use-withdraw-approval", () => ({
  default: () => mocks.mutation,
}));

const WITHDRAW_NAME = /^workItems:detail\.approvals\.withdrawFor/;

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    workItemId: "wi_1",
    workItemKey: "PROJ-123",
    workItemTitle: "Fix the thing",
    transitionId: "transition-1",
    kind: "customer",
    state: "pending",
    requester: { id: "person-requester", displayName: "Riley" },
    approver: { id: "person-approver", displayName: "Casey" },
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
    decidedAt: null,
    decisionNote: null,
    approverReachLost: false,
    canWithdraw: true,
    ...overrides,
  };
}

function readyWith(approvals: unknown[]) {
  mocks.query = {
    data: { approvals },
    isError: false,
    isLoading: false,
    refetch: mocks.refetch,
  };
}

beforeEach(() => {
  mocks.user = { id: "user-1", role: "user" };
  mocks.mutation = {
    mutate: mocks.withdraw,
    isPending: false,
    isError: false,
    error: null,
    variables: undefined,
  };
  readyWith([makeApproval()]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkItemApprovals", () => {
  it("AP-20 lists an existing approval with its state and approver", () => {
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(screen.getByTestId("work-item-approvals")).toBeInTheDocument();
    expect(
      screen.getByText("workItems:detail.approvals.kind.customer"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:detail.approvals.state.pending"),
    ).toBeInTheDocument();
    expect(screen.getByText("Casey")).toBeInTheDocument();
  });

  it("AP-20 keeps the section visible with an empty state when none exist", () => {
    readyWith([]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(screen.getByTestId("work-item-approvals")).toBeInTheDocument();
    expect(screen.getByTestId("work-item-approvals-empty")).toBeInTheDocument();
  });

  it("renders the loading state", () => {
    mocks.query = { data: undefined, isError: false, isLoading: true };
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(
      screen.getByTestId("work-item-approvals-loading"),
    ).toBeInTheDocument();
  });

  it("renders a retryable error state", () => {
    mocks.query = {
      data: undefined,
      isError: true,
      isLoading: false,
      refetch: mocks.refetch,
    };
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(screen.getByTestId("work-item-approvals-error")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:detail.approvals.retry" }),
    );
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("AP-6 offers Withdraw on a pending approval the server allows", () => {
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    fireEvent.click(screen.getByRole("button", { name: WITHDRAW_NAME }));
    expect(mocks.withdraw).toHaveBeenCalledWith(
      {
        id: "approval-1",
        asInstanceAdmin: false,
      },
      expect.any(Object),
    );
  });

  it("AP-6 hides Withdraw when the server denies the current viewer", () => {
    readyWith([makeApproval({ canWithdraw: false })]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(screen.queryByRole("button", { name: WITHDRAW_NAME })).toBeNull();
  });

  it("hides Withdraw once the approval is no longer pending", () => {
    readyWith([makeApproval({ state: "withdrawn", canWithdraw: true })]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(
      screen.getByText("workItems:detail.approvals.state.withdrawn"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: WITHDRAW_NAME })).toBeNull();
  });

  it("AP-7 routes an instance-admin session to the admin withdraw route", () => {
    mocks.user = { id: "admin-1", role: "admin" };
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    fireEvent.click(screen.getByRole("button", { name: WITHDRAW_NAME }));
    expect(mocks.withdraw).toHaveBeenCalledWith(
      {
        id: "approval-1",
        asInstanceAdmin: true,
      },
      expect.any(Object),
    );
  });

  it("flags a pending approval whose approver lost reach", () => {
    readyWith([makeApproval({ approverReachLost: true })]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(
      screen.getByText("workItems:detail.approvals.reachLost"),
    ).toBeInTheDocument();
  });

  it("disables Withdraw while a withdrawal is in flight", () => {
    mocks.mutation = {
      ...mocks.mutation,
      isPending: true,
      variables: { id: "approval-1", asInstanceAdmin: false },
    };
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(
      screen.getByRole("button", {
        name: "workItems:detail.approvals.withdrawing",
      }),
    ).toBeDisabled();
  });

  it.each([
    [409, "workItems:detail.approvals.withdrawConflict"],
    [403, "workItems:detail.approvals.withdrawForbidden"],
    [404, "workItems:detail.approvals.withdrawForbidden"],
    [500, "workItems:detail.approvals.withdrawFailed"],
  ])("shows a clear message for a %i withdrawal failure", (status, key) => {
    mocks.mutation = {
      ...mocks.mutation,
      isError: true,
      error: new HttpError(status, "failed"),
    };
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(screen.getByRole("alert")).toHaveTextContent(key);
  });

  it("N3 names each Withdraw button with its row, keeping the visible text", () => {
    readyWith([
      makeApproval(),
      makeApproval({
        id: "approval-2",
        kind: "cab",
        approver: { id: "p2", displayName: "Morgan" },
      }),
    ]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    const buttons = screen.getAllByRole("button", { name: WITHDRAW_NAME });
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Casey");
    expect(names[1]).toContain("Morgan");
    // WCAG 2.5.3: the visible label is the start of the accessible name.
    expect(buttons[0]).toHaveTextContent("workItems:detail.approvals.withdraw");
    expect(names[0]).toContain("workItems:detail.approvals.withdrawFor");
  });

  it.each([
    [
      "success",
      (opts: { onSuccess: () => void; onSettled: () => void }) => {
        opts.onSuccess();
        opts.onSettled();
      },
    ],
    [
      "failure",
      (opts: { onSuccess: () => void; onSettled: () => void }) => {
        opts.onSettled();
      },
    ],
  ])("N1 moves focus to the section heading after a %s", (_name, settle) => {
    mocks.withdraw.mockImplementation((_vars, opts) => settle(opts));
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    const button = screen.getByRole("button", { name: WITHDRAW_NAME });
    button.focus();
    fireEvent.click(button);
    expect(
      screen.getByRole("heading", {
        name: "workItems:detail.approvals.heading",
      }),
    ).toHaveFocus();
  });

  it("N2 announces a successful withdrawal in a polite status region", () => {
    mocks.withdraw.mockImplementation((_vars, opts) => opts.onSuccess());
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole("button", { name: WITHDRAW_NAME }));
    expect(status).toHaveTextContent("workItems:detail.approvals.withdrawn");
  });

  it("N2 does not announce success when the withdrawal fails", () => {
    mocks.withdraw.mockImplementation((_vars, opts) => opts.onSettled());
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    fireEvent.click(screen.getByRole("button", { name: WITHDRAW_NAME }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
