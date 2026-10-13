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
  useTranslation: () => ({ t: (key: string) => key }),
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
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:detail.approvals.withdraw",
      }),
    );
    expect(mocks.withdraw).toHaveBeenCalledWith({
      id: "approval-1",
      asInstanceAdmin: false,
    });
  });

  it("AP-6 hides Withdraw when the server denies the current viewer", () => {
    readyWith([makeApproval({ canWithdraw: false })]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(
      screen.queryByRole("button", {
        name: "workItems:detail.approvals.withdraw",
      }),
    ).toBeNull();
  });

  it("hides Withdraw once the approval is no longer pending", () => {
    readyWith([makeApproval({ state: "withdrawn", canWithdraw: true })]);
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    expect(
      screen.getByText("workItems:detail.approvals.state.withdrawn"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "workItems:detail.approvals.withdraw",
      }),
    ).toBeNull();
  });

  it("AP-7 routes an instance-admin session to the admin withdraw route", () => {
    mocks.user = { id: "admin-1", role: "admin" };
    render(<WorkItemApprovals workItemKey="PROJ-123" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:detail.approvals.withdraw",
      }),
    );
    expect(mocks.withdraw).toHaveBeenCalledWith({
      id: "approval-1",
      asInstanceAdmin: true,
    });
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
});
