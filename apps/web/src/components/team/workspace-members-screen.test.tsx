import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { WorkspaceUser } from "@/types/workspace-user";
import MembersTable from "./members-table";

const getHistory = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/settings/settings-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/settings/settings-history")
  >()),
  getSettingsHistory: getHistory,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "reader" }, session: { id: "session" } },
    }),
  },
}));
vi.mock("@/lib/profile-session-guard", () => ({
  profileSessionGuard: () => async () => undefined,
}));
vi.mock("../providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "reader" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({ data: { role: "member" } }),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));
vi.mock(
  "@/hooks/mutations/workspace-user/use-update-workspace-user-role",
  () => ({ default: () => ({ mutateAsync: vi.fn() }) }),
);
vi.mock("@/hooks/mutations/workspace-user/use-delete-workspace-user", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/workspace-user/use-cancel-invitation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => vi.fn(),
}));
vi.mock("@/hooks/use-copy-invitation-link", () => ({
  useCopyInvitationLink: () => ({ copy: vi.fn(), copied: false }),
}));
vi.mock("@/lib/format", () => ({
  formatDateMedium: () => "date",
  formatDateTime: () => "date",
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("uses real capability and History query behavior independently of role editing", async () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  client.setQueryData(["workspace-capabilities", "w1", "member"], {
    manageTeam: false,
    removeMembers: false,
    inviteUsers: false,
  });
  getHistory.mockResolvedValue({
    entityType: "workspace_member",
    entityId: "membership-row",
    workspaceId: "w1",
    projectId: null,
    lastChanged: null,
    rows: [],
  });
  const member = {
    id: "target-user",
    workspaceMemberId: "membership-row",
    email: "member@example.com",
    name: "Member",
    role: "member",
    image: null,
  } as WorkspaceUser;
  render(
    <QueryClientProvider client={client}>
      <MembersTable workspaceId="w1" invitations={[]} users={[member]} />
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("button", {
      name: "team:membersTable.ariaRemoveMember",
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "settings:history.memberHistory" }),
  );
  await waitFor(() =>
    expect(getHistory).toHaveBeenCalledWith(
      "workspace_member",
      "membership-row",
      expect.any(AbortSignal),
    ),
  );
  expect(await screen.findByText("settings:history.empty")).toBeTruthy();
});
