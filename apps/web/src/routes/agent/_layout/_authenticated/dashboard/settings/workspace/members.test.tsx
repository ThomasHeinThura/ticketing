import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * L-03: /dashboard/settings/workspace/members is the canonical members page. It renders Kaneo's
 * members table inside the settings frame instead of hopping on to /dashboard/workspace/{id}.
 */
const mocks = vi.hoisted(() => ({
  activeWorkspace: { id: "ws-1" } as { id: string } | undefined,
  activeLoading: false,
  canInvite: true,
  membersTable: vi.fn(),
  inviteModal: vi.fn(),
  search: {} as { q?: string },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    fullPath: "/dashboard/settings/workspace/members",
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
  Navigate: (props: { to: string }) => (
    <div data-testid="navigate" data-to={props.to} />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({
    data: mocks.activeWorkspace,
    isLoading: mocks.activeLoading,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-get-full-workspace", () => ({
  default: ({ workspaceId }: { workspaceId: string }) => ({
    data: {
      id: workspaceId,
      members: [
        {
          id: "u-1",
          name: "Ada Lovelace",
          email: "ada@example.com",
          role: "admin",
        },
        {
          id: "u-2",
          name: "Bob Stone",
          email: "bob@example.com",
          role: "member",
        },
      ],
      pendingInvitations: [
        {
          id: "inv-1",
          email: "carol@example.com",
          role: "member",
          status: "pending",
        },
        {
          id: "inv-2",
          email: "old@example.com",
          role: "member",
          status: "canceled",
        },
      ],
    },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canInviteUsers: () => mocks.canInvite }),
}));
vi.mock("@/hooks/queries/workspace/use-workspace-roles", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/components/team/members-table", () => ({
  default: (props: Record<string, unknown>) => {
    mocks.membersTable(props);
    return <div data-testid="members-table" />;
  },
}));
vi.mock("@/components/team/invite-team-member-modal", () => ({
  default: (props: { open: boolean }) => {
    mocks.inviteModal(props);
    return props.open ? <div data-testid="invite-modal" /> : null;
  },
}));

import { Route } from "./members";

const Page = (Route as unknown as { component: ComponentType }).component;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.search = {};
  mocks.activeWorkspace = { id: "ws-1" };
  mocks.activeLoading = false;
  mocks.canInvite = true;
});

describe("workspace settings members (L-03)", () => {
  it("renders the active workspace's members in place, without redirecting", () => {
    render(<Page />);
    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "team:members.pageTitle" }),
    ).toBeTruthy();
    expect(screen.getByTestId("members-table")).toBeTruthy();
    expect(mocks.membersTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        users: [
          expect.objectContaining({ id: "u-1" }),
          expect.objectContaining({ id: "u-2" }),
        ],
        invitations: [],
      }),
    );
  });

  it("offers the invite action to people who can invite and opens the invite dialog", () => {
    render(<Page />);
    fireEvent.click(
      screen.getByRole("button", { name: "team:members.inviteMember" }),
    );
    expect(screen.getByTestId("invite-modal")).toBeTruthy();
  });

  it("hides the invite action from people who cannot invite", () => {
    mocks.canInvite = false;
    render(<Page />);
    expect(
      screen.queryByRole("button", { name: "team:members.inviteMember" }),
    ).toBeNull();
    expect(screen.getByTestId("members-table")).toBeTruthy();
  });

  it("shows a loading state until the active workspace is known", () => {
    mocks.activeWorkspace = undefined;
    mocks.activeLoading = true;
    render(<Page />);
    expect(
      screen.getByRole("status", { name: "common:empty.loading" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("members-table")).toBeNull();
  });

  it("keeps the person search `q` in the URL", () => {
    const validateSearch = (
      Route as unknown as { validateSearch: (raw: unknown) => unknown }
    ).validateSearch;
    expect(validateSearch({ q: "ada" })).toEqual({ q: "ada" });
  });

  it("shows member and pending invitation counts as tabs and lists invitations on their tab", () => {
    render(<Page />);
    expect(
      screen.getByRole("tab", { name: "team:members.tabMembers:2" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("tab", { name: "team:members.tabInvitations:1" }),
    );
    expect(mocks.membersTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        users: [],
        invitations: [expect.objectContaining({ id: "inv-1" })],
      }),
    );
  });

  it("filters members by the `q` search and writes typing back to the URL", () => {
    mocks.search = { q: "ada" };
    render(<Page />);
    expect(mocks.membersTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        users: [expect.objectContaining({ id: "u-1" })],
      }),
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "team:members.search" }),
      { target: { value: "bob" } },
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      search: { q: "bob" },
      replace: true,
    });
  });

  it("filters members by role", async () => {
    render(<Page />);
    fireEvent.click(
      screen.getByRole("button", { name: "team:members.roleFilter" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "team:roles.member" }),
    );
    expect(mocks.membersTable).toHaveBeenLastCalledWith(
      expect.objectContaining({
        users: [expect.objectContaining({ id: "u-2" })],
      }),
    );
  });
});
