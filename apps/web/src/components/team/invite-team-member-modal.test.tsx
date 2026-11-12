import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import InviteTeamMemberModal from "./invite-team-member-modal";

const { invite } = vi.hoisted(() => ({
  invite: vi.fn().mockResolvedValue({}),
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
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
});
