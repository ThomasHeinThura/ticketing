import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WorkspaceUser,
  WorkspaceUserInvitation,
} from "@/types/workspace-user";
import MembersTable from "./members-table";

const noticeState = vi.hoisted(() => ({
  hasSmtp: true as boolean | undefined,
  loading: false,
  admin: false,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({
    data:
      noticeState.hasSmtp === undefined
        ? undefined
        : { hasSmtp: noticeState.hasSmtp },
    isLoading: noticeState.loading,
  }),
}));
vi.mock("@/hooks/use-instance-admin-signal", () => ({
  useInstanceAdminSignal: () => noticeState.admin,
}));

const copyToClipboard = vi.fn();
const success = vi.fn();
const error = vi.fn();

vi.mock("@/lib/copy-to-clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: (msg: string) => success(msg),
    error: (msg: string) => error(msg),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/format", () => ({
  formatDateMedium: () => "Sep 1, 2026",
  formatDateTime: () => "Sep 1, 2026, 12:00 AM",
}));

const {
  cancelInvitation,
  openPendingAction,
  copyWorkspaceInvitationLink,
  inviteWorkspaceMember,
} = vi.hoisted(() => ({
  cancelInvitation: vi.fn(),
  openPendingAction: vi.fn(),
  copyWorkspaceInvitationLink: vi.fn(),
  inviteWorkspaceMember: vi.fn(),
}));

vi.mock("@/fetchers/workspace/copy-workspace-invitation-link", () => ({
  copyWorkspaceInvitationLink: (...args: unknown[]) =>
    copyWorkspaceInvitationLink(...args),
}));

vi.mock("@/fetchers/workspace/invite-workspace-member", () => ({
  default: (...args: unknown[]) => inviteWorkspaceMember(...args),
}));

vi.mock("@/hooks/mutations/workspace-user/use-cancel-invitation", () => ({
  default: () => ({ mutateAsync: cancelInvitation, isPending: false }),
}));

vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => openPendingAction,
}));

const { deleteWorkspaceUser } = vi.hoisted(() => ({
  deleteWorkspaceUser: vi.fn(),
}));

vi.mock("@/hooks/mutations/workspace-user/use-delete-workspace-user", () => ({
  default: () => ({ mutateAsync: deleteWorkspaceUser, isPending: false }),
}));

vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({
    default: () => ({ mutateAsync: vi.fn() }),
  }),
);

const workspaceRolesData = vi.fn<() => Array<{ role: string; name: string }>>(
  () => [],
);

vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: workspaceRolesData() }),
}));

const canInviteUsers = vi.fn(() => true);

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageTeam: () => true,
    canRemoveMembers: () => true,
    canInviteUsers: () => canInviteUsers(),
  }),
}));

vi.mock("../providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "current-user" } }),
}));

beforeEach(() => {
  canInviteUsers.mockReturnValue(true);
  workspaceRolesData.mockReturnValue([]);
  copyWorkspaceInvitationLink.mockResolvedValue({
    link: `${window.location.origin}/invitation/accept/invite-1`,
    expiresAt: "2026-12-03T00:00:00.000Z",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const pendingInvitation = {
  id: "invite-1",
  email: "invitee@example.com",
  role: "member",
  status: "pending",
  expiresAt: "2026-12-01T00:00:00.000Z",
} as unknown as WorkspaceUserInvitation;

// `id` is the USER's id on the native member shape, and it is deliberately
// nothing like the email here: a test whose fixture used `id: "member@..."`
// would pass against either parameter and prove nothing.
const member = {
  id: "user-42",
  name: "Removable Member",
  email: "removable@example.com",
  image: null,
  role: "member",
} as unknown as WorkspaceUser;

describe("MembersTable remove member", () => {
  it("passes the target's userId to the native route, not their email", async () => {
    deleteWorkspaceUser.mockResolvedValue({});

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[] as WorkspaceUserInvitation[]}
        users={[member]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaRemoveMember",
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.removeMember",
      }),
    );

    // The destructive confirm inside the dialog, not the menu item above.
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "team:membersTable.removeMember",
      }),
    );

    await waitFor(() => expect(deleteWorkspaceUser).toHaveBeenCalledTimes(1));

    // DELETE /api/workspace/{workspaceId}/members/{userId} takes a user id.
    // better-auth's removeMember() took `memberIdOrEmail`, so the pre-fix call
    // site passed `memberToDelete.email` and the native route could not resolve
    // it. This assertion fails if that regresses.
    expect(deleteWorkspaceUser).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      userId: "user-42",
    });

    const [call] = deleteWorkspaceUser.mock.calls;
    expect(call[0].userId).not.toBe(member.email);
    expect(call[0].userId).not.toContain("@");
  });
});

describe("MembersTable pending invitation row menu", () => {
  it("awaits the copy-link endpoint and copies the server-returned link when 'Copy link' is clicked", async () => {
    const serverLink =
      "https://agent.example.test/invitation/accept/invite-1?server=1";
    copyWorkspaceInvitationLink.mockResolvedValue({
      link: serverLink,
      expiresAt: "2026-12-03T00:00:00.000Z",
    });
    copyToClipboard.mockResolvedValue(true);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    );

    await waitFor(() =>
      expect(copyWorkspaceInvitationLink).toHaveBeenCalledWith(
        "workspace-1",
        "invite-1",
      ),
    );
    await waitFor(() =>
      expect(copyToClipboard).toHaveBeenCalledWith(serverLink),
    );
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith("team:invitations.linkCopied"),
    );
  });

  it("offers Resend and Cancel but hides 'Copy link' on expired invitation rows", async () => {
    const expiredInvitation = {
      ...pendingInvitation,
      id: "invite-expired",
      expiresAt: "2026-09-01T00:00:00.000Z",
    } as unknown as WorkspaceUserInvitation;

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[expiredInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    expect(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.resendInvitation",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("menuitem", {
        name: "team:invitations.copyLink",
      }),
    ).toBeNull();
  });

  it.each([
    [403, "team:invitations.copyErrorForbidden"],
    [409, "team:invitations.copyErrorInactive"],
    [429, "team:invitations.copyErrorRateLimited"],
    [500, "team:invitations.copyRequestFailed"],
  ])(
    "copies nothing and shows %s -> %s when row-menu copy fails on the server",
    async (status, expectedKey) => {
      copyWorkspaceInvitationLink.mockRejectedValue(
        Object.assign(new Error(`HTTP ${status}`), { status }),
      );

      render(
        <MembersTable
          workspaceId="workspace-1"
          invitations={[pendingInvitation]}
          users={[] as WorkspaceUser[]}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "team:membersTable.ariaInvitationActions",
        }),
      );

      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "team:invitations.copyLink",
        }),
      );

      await waitFor(() => expect(error).toHaveBeenCalledWith(expectedKey));
      expect(copyToClipboard).not.toHaveBeenCalled();
      expect(success).not.toHaveBeenCalled();
    },
  );

  it.each(["viewer", "lead", "manager", "admin", "triage-specialist"] as const)(
    "preserves the invitation's actual role (%s) on resend instead of mapping to member",
    async (role) => {
      workspaceRolesData.mockReturnValue([
        { role: "triage-specialist", name: "Triage Specialist" },
      ]);
      inviteWorkspaceMember.mockResolvedValue({
        id: "invite-role",
        email: "invitee@example.com",
        role,
        status: "pending",
        expiresAt: "2026-12-15T00:00:00.000Z",
        delivered: false,
      });

      render(
        <MembersTable
          workspaceId="workspace-1"
          invitations={[
            {
              ...pendingInvitation,
              id: "invite-role",
              role,
            } as unknown as WorkspaceUserInvitation,
          ]}
          users={[] as WorkspaceUser[]}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "team:membersTable.ariaInvitationActions",
        }),
      );

      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "team:membersTable.resendInvitation",
        }),
      );

      await waitFor(() =>
        expect(inviteWorkspaceMember).toHaveBeenCalledWith({
          workspaceId: "workspace-1",
          email: "invitee@example.com",
          role,
          resend: true,
        }),
      );
      expect(
        await screen.findByText("team:membersTable.resendDialogTitle"),
      ).toBeVisible();
      expect(
        screen.getByText("team:invitations.resultEmailNotSent"),
      ).toBeVisible();
    },
  );

  it.each([null, "", "owner", "customer", "deleted-custom-role"] as const)(
    "refuses resending an invitation with missing or invalid role (%s) and shows a translated error",
    async (badRole) => {
      workspaceRolesData.mockReturnValue([
        { role: "triage-specialist", name: "Triage Specialist" },
      ]);

      render(
        <MembersTable
          workspaceId="workspace-1"
          invitations={[
            {
              ...pendingInvitation,
              id: "invite-bad-role",
              role: badRole,
            } as unknown as WorkspaceUserInvitation,
          ]}
          users={[] as WorkspaceUser[]}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", {
          name: "team:membersTable.ariaInvitationActions",
        }),
      );

      fireEvent.click(
        await screen.findByRole("menuitem", {
          name: "team:membersTable.resendInvitation",
        }),
      );

      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          "team:membersTable.resendInvalidRole",
        ),
      );
      expect(inviteWorkspaceMember).not.toHaveBeenCalled();
    },
  );

  it("requests the cancellation directly and opens the in-place approval as the only confirmation", async () => {
    cancelInvitation.mockResolvedValue({ pendingActionId: "pa-invite" });
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    );

    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "team:membersTable.cancelInvitation",
      }),
    );

    await waitFor(() =>
      expect(cancelInvitation).toHaveBeenCalledWith({
        invitationId: "invite-1",
        workspaceId: "workspace-1",
      }),
    );
    await waitFor(() =>
      expect(openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa-invite",
      }),
    );
    expect(
      screen.queryByText("team:membersTable.cancelDialogTitle"),
    ).toBeNull();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it("hides the row menu entirely when the user lacks canInvite", () => {
    canInviteUsers.mockReturnValue(false);

    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[] as WorkspaceUser[]}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "team:membersTable.ariaInvitationActions",
      }),
    ).toBeNull();
  });
});

describe("MembersTable joined column", () => {
  it("shows each member's join date instead of a dash (UAT re-audit)", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[] as WorkspaceUserInvitation[]}
        users={[
          {
            ...member,
            joinedAt: "2026-09-01T10:00:00.000Z",
          } as unknown as WorkspaceUser,
        ]}
      />,
    );
    const row = screen.getByText("Removable Member").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Sep 1, 2026")).toBeVisible();
    expect(within(row as HTMLElement).queryByText("–")).toBeNull();
  });
});

describe("MembersTable narrow widths (finding #4)", () => {
  const longMember = {
    ...member,
    name: "A Very Long Member Name That Would Otherwise Widen The Column",
    email: "a.very.long.address.for.layout@subdomain.example.com",
    joinedAt: "2026-09-01T10:00:00.000Z",
  } as unknown as WorkspaceUser;

  it("lets the Name column absorb the free width and truncate, with full text in a title", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[longMember]}
      />,
    );

    const nameHeader = screen.getByRole("columnheader", {
      name: "team:membersTable.columns.name",
    });
    expect(nameHeader).toHaveClass("w-full");

    const name = screen.getByText(longMember.name as string);
    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute("title", longMember.name);
    expect(name.closest("td")).toHaveClass("max-w-0");

    const email = screen.getByText(longMember.email);
    expect(email).toHaveClass("truncate");
    expect(email).toHaveAttribute("title", longMember.email);

    const inviteEmail = screen.getByText(pendingInvitation.email);
    expect(inviteEmail).toHaveClass("truncate");
    expect(inviteEmail).toHaveAttribute("title", pendingInvitation.email);
    expect(inviteEmail.closest("td")).toHaveClass("max-w-0");
  });

  it("hides the Joined column below sm and repeats the date under the email", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[] as WorkspaceUserInvitation[]}
        users={[longMember]}
      />,
    );

    expect(
      screen.getByRole("columnheader", {
        name: "team:membersTable.columns.joined",
      }),
    ).toHaveClass("max-sm:hidden");
    expect(screen.getByText("Sep 1, 2026").closest("td")).toHaveClass(
      "max-sm:hidden",
    );
    expect(screen.getByText("team:membersTable.joinedOn")).toHaveClass(
      "sm:hidden",
    );
  });

  it("moves the role control under the name below sm and hides the Role column", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[longMember]}
      />,
    );

    expect(
      screen.getByRole("columnheader", {
        name: "team:membersTable.columns.role",
      }),
    ).toHaveClass("max-sm:hidden");

    const row = screen.getByText(longMember.name as string).closest("tr");
    const pickers = within(row as HTMLElement).getAllByRole("button", {
      name: "team:roles.member",
    });
    // One picker per breakpoint: the column copy from sm up, the copy under
    // the name below sm. Each is display:none on the other side.
    expect(pickers).toHaveLength(2);
    const [inName, inColumn] = pickers;
    expect(inName.closest("td")).toHaveClass("max-w-0");
    expect(inName.parentElement).toHaveClass("sm:hidden");
    expect(inColumn.closest("td")).toHaveClass("max-sm:hidden");
    inName.focus();
    expect(inName).toHaveFocus();

    const inviteRow = screen.getByText(pendingInvitation.email).closest("tr");
    const inviteRoles = within(inviteRow as HTMLElement).getAllByText(
      "team:roles.member",
    );
    expect(inviteRoles).toHaveLength(2);
    expect(inviteRoles[0].parentElement).toHaveClass("sm:hidden");
    expect(inviteRoles[1].closest("td")).toHaveClass("max-sm:hidden");
  });

  it("shows the invited role on pending invitation badges", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[{ ...pendingInvitation, role: "lead" }]}
        users={[]}
      />,
    );
    const row = screen.getByText(pendingInvitation.email).closest("tr");
    expect(
      within(row as HTMLElement).getAllByText("team:roles.lead"),
    ).toHaveLength(2);
  });

  it("opens the phone role picker with the role options", async () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[] as WorkspaceUserInvitation[]}
        users={[longMember]}
      />,
    );

    const [inName] = screen.getAllByRole("button", {
      name: "team:roles.member",
    });
    fireEvent.click(inName);
    expect(
      await screen.findByRole("button", { name: "team:roles.admin" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "team:roles.owner" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the remove action a named, focusable button in the row", () => {
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[] as WorkspaceUserInvitation[]}
        users={[longMember]}
      />,
    );

    const remove = screen.getByRole("button", {
      name: "team:membersTable.ariaRemoveMember",
    });
    expect(remove.closest("td")).not.toHaveClass("max-sm:hidden");
    remove.focus();
    expect(remove).toHaveFocus();
  });
});

describe("no email notice above staff resends", () => {
  it.each([
    [false, false, true],
    [true, false, false],
    [undefined, true, false],
  ])("handles provider %s and loading %s", (hasSmtp, loading, visible) => {
    noticeState.hasSmtp = hasSmtp;
    noticeState.loading = loading;
    noticeState.admin = false;
    render(
      <MembersTable
        workspaceId="workspace-1"
        invitations={[pendingInvitation]}
        users={[]}
      />,
    );
    expect(Boolean(screen.queryByText("team:invitations.noEmailNotice"))).toBe(
      visible,
    );
    expect(screen.queryByText("team:invitations.configureEmail")).toBeNull();
  });
});

it("offers email settings to an instance admin when email is missing", () => {
  noticeState.hasSmtp = false;
  noticeState.loading = false;
  noticeState.admin = true;
  render(
    <MembersTable
      workspaceId="workspace-1"
      invitations={[pendingInvitation]}
      users={[]}
    />,
  );
  expect(
    screen.getByRole("link", { name: "team:invitations.configureEmail" }),
  ).toHaveAttribute("href", "/god-mode/notifications");
});
