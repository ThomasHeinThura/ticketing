import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InviteTeamMemberModal from "./invite-team-member-modal";

const { invite, toastSuccess, toastError } = vi.hoisted(() => ({
  invite: vi.fn().mockResolvedValue({}),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    refetchQueries: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
  useQuery: () => ({
    data: [
      { id: "member", name: "Member", rank: 30 },
      { id: "lead", name: "Lead", rank: 40 },
    ],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/mutations/workspace-user/use-invite-workspace-user", () => ({
  default: () => ({ mutateAsync: invite }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canInviteUsers: () => true }),
}));
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) =>
        options?.defaultValue ?? key,
    }),
  };
});
vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  invite.mockResolvedValue({});
});

describe("staff invitation role", () => {
  it("defaults to member and submits it", async () => {
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("team:inviteModal.emailLabel"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "team:inviteModal.sendInvitation" }),
    );
    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({
        workspaceId: "ws",
        email: "person@example.com",
        role: "member",
      }),
    );
  });
  it("offers only returned roles and submits the selected role", async () => {
    render(<InviteTeamMemberModal open onClose={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "team:inviteModal.roleLabel" }),
    );
    expect(screen.queryByText("Owner")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
    fireEvent.click(screen.getByText("Lead"));
    fireEvent.change(screen.getByLabelText("team:inviteModal.emailLabel"), {
      target: { value: "person@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "team:inviteModal.sendInvitation" }),
    );
    await waitFor(() =>
      expect(invite).toHaveBeenCalledWith({
        workspaceId: "ws",
        email: "person@example.com",
        role: "lead",
      }),
    );
  });
  it.each([
    [true, "team:invitations.resultEmailSent"],
    [false, "team:invitations.resultEmailNotSent"],
  ] as const)(
    "renders the invitation result card after inviting with a selected role (delivered=%s)",
    async (delivered, expectedBannerKey) => {
      invite.mockResolvedValueOnce({
        id: "inv-lead-1",
        email: "lead@example.com",
        expiresAt: "2026-12-01T00:00:00.000Z",
        delivered,
      });
      render(<InviteTeamMemberModal open onClose={vi.fn()} />);
      fireEvent.click(
        screen.getByRole("button", { name: "team:inviteModal.roleLabel" }),
      );
      fireEvent.click(screen.getByText("Lead"));
      fireEvent.change(screen.getByLabelText("team:inviteModal.emailLabel"), {
        target: { value: "lead@example.com" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "team:inviteModal.sendInvitation" }),
      );
      expect(await screen.findByText(expectedBannerKey)).toBeVisible();
      if (delivered) {
        expect(toastSuccess).toHaveBeenCalledWith("team:inviteModal.success");
      } else {
        expect(toastSuccess).not.toHaveBeenCalled();
      }
    },
  );
});
