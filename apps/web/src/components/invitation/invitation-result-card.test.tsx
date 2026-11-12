import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitationResultCard } from "./invitation-result-card";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  copyCustomerLink: vi.fn(),
  copyStaffLink: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => mocks.copyToClipboard(text),
}));

vi.mock("@/fetchers/customer-invitation", () => ({
  copyCustomerInvitationLink: (...args: unknown[]) =>
    mocks.copyCustomerLink(...args),
}));

vi.mock("@/fetchers/workspace/copy-workspace-invitation-link", () => ({
  copyWorkspaceInvitationLink: (...args: unknown[]) =>
    mocks.copyStaffLink(...args),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => mocks.toastSuccess(msg),
    error: (msg: string) => mocks.toastError(msg),
  },
}));

vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => `fmt(${value})`,
  formatDateMedium: (value: string) => `med(${value})`,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts?.date
        ? `${key}:${opts.date}`
        : opts?.email
          ? `${key}:${opts.email}`
          : key,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InvitationResultCard", () => {
  it("shows 'Email sent', valid-until date, and audits staff link copies", async () => {
    mocks.copyToClipboard.mockResolvedValue(true);
    mocks.copyStaffLink.mockResolvedValue({
      link: `${window.location.origin}/invitation/accept/inv-staff-1`,
      expiresAt: "2026-11-14T10:00:00.000Z",
    });

    render(
      <InvitationResultCard
        kind="staff"
        invitationId="inv-staff-1"
        workspaceId="ws-1"
        email="staff@example.test"
        delivered={true}
        expiresAt="2026-11-14T10:00:00.000Z"
      />,
    );

    expect(screen.getByText("team:invitations.resultEmailSent")).toBeVisible();
    expect(
      screen.getByText(
        "team:invitations.validUntil:fmt(2026-11-14T10:00:00.000Z)",
      ),
    ).toBeVisible();
    expect(screen.getByRole("textbox")).toHaveValue(
      `${window.location.origin}/invitation/accept/inv-staff-1`,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(mocks.copyStaffLink).toHaveBeenCalledWith("ws-1", "inv-staff-1");
    expect(mocks.copyToClipboard).toHaveBeenCalledWith(
      `${window.location.origin}/invitation/accept/inv-staff-1`,
    );
    await waitFor(() =>
      expect(screen.getByRole("button")).toHaveTextContent(
        "team:invitations.linkCopied",
      ),
    );
  });

  it("shows 'Email not sent — copy the link and send it yourself' for customer invitations and fetches/copies on demand", async () => {
    mocks.copyCustomerLink.mockResolvedValue({
      link: "https://portal.example.test/invite/inv-cust-1#t=derived_secret_token",
      expiresAt: "2026-11-14T10:00:00.000Z",
    });
    mocks.copyToClipboard.mockResolvedValue(true);

    render(
      <InvitationResultCard
        kind="customer"
        invitationId="inv-cust-1"
        workspaceId="ws-1"
        organisationId="org-1"
        email="customer@example.test"
        delivered={false}
        expiresAt="2026-11-14T10:00:00.000Z"
      />,
    );

    expect(
      screen.getByText("customerInvitations:resultCard.emailNotSent"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "customerInvitations:resultCard.validUntil:fmt(2026-11-14T10:00:00.000Z)",
      ),
    ).toBeVisible();
    // Customer copy endpoint is NOT called until the inviter presses Copy link.
    expect(mocks.copyCustomerLink).not.toHaveBeenCalled();

    const button = screen.getByRole("button");
    fireEvent.click(button);

    await waitFor(() =>
      expect(mocks.copyCustomerLink).toHaveBeenCalledWith(
        "ws-1",
        "org-1",
        "inv-cust-1",
      ),
    );
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        "https://portal.example.test/invite/inv-cust-1#t=derived_secret_token",
      ),
    );
    expect(screen.getByRole("textbox")).toHaveValue(
      "https://portal.example.test/invite/inv-cust-1#t=derived_secret_token",
    );
    const liveSpan = button.querySelector("[aria-live='polite']");
    expect(liveSpan).not.toBeNull();
    await waitFor(() =>
      expect(liveSpan).toHaveTextContent("customerInvitations:actions.copied"),
    );
  });

  it("selects the revealed customer link in the input if clipboard access fails", async () => {
    const link =
      "https://portal.example.test/invite/inv-cust-2#t=manual_copy_token";
    mocks.copyCustomerLink.mockResolvedValue({
      link,
      expiresAt: "2026-11-14T10:00:00.000Z",
    });
    mocks.copyToClipboard.mockResolvedValue(false);

    render(
      <InvitationResultCard
        kind="customer"
        invitationId="inv-cust-2"
        workspaceId="ws-1"
        organisationId="org-1"
        email="customer@example.test"
        delivered={false}
        expiresAt="2026-11-14T10:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole("button"));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "customerInvitations:toasts.copyFailed",
      ),
    );
    expect(input).toHaveValue(link);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(link.length);
  });
});
