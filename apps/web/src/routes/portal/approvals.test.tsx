import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { PortalApprovalsPage } from "./approvals";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  query: {
    data: {
      approvals: [
        {
          id: "approval-customer-1",
          workItemKey: "HELP-19",
          workItemTitle: "Confirm the proposed resolution",
          kind: "customer",
          state: "pending",
          requester: { id: "staff-1", displayName: "Alex" },
          approver: { id: "customer-1", displayName: "Sam" },
          createdAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-10-08T00:00:00.000Z",
          decidedAt: null,
          decisionNote: null,
          approverReachLost: false,
        },
      ],
    },
    error: null as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/hooks/queries/approval/use-get-portal-approvals", () => ({
  default: () => mocks.query,
}));

vi.mock("@/hooks/mutations/approval/use-decide-portal-approval", () => ({
  default: () => ({ mutate: mocks.mutate, isPending: false, isError: false }),
}));

afterEach(() => {
  cleanup();
  mocks.mutate.mockClear();
  mocks.query.error = null;
  mocks.query.isError = false;
});

describe("PortalApprovalsPage", () => {
  it("shows only the approval context in the portal flow and records a decision", () => {
    render(<PortalApprovalsPage />);
    expect(
      screen.getByText("Confirm the proposed resolution"),
    ).toBeInTheDocument();
    expect(screen.getByText("Requested by Alex")).toBeInTheDocument();
    expect(screen.queryByText(/@/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mocks.mutate).toHaveBeenCalledWith({
      id: "approval-customer-1",
      action: "approve",
    });
  });

  it("offers sign-in guidance without redirecting to the agent login when session is absent", () => {
    mocks.query.error = new HttpError(401, "unauthorized");
    mocks.query.isError = true;
    render(<PortalApprovalsPage />);
    expect(
      screen.getByText("Customer portal sign-in required"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
