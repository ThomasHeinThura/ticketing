import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectMembersSettings from "./project-members-settings";

vi.mock("./customer-project-access", () => ({
  CustomerProjectAccess: () => <div data-testid="customer-project-access" />,
}));

const mocks = vi.hoisted(() => ({
  canUpdate: true,
  callerRank: undefined as number | undefined,
  canManageMembers: undefined as boolean | undefined,
  members: [] as unknown[],
  navigate: vi.fn(),
  removeMember: vi.fn(),
  updateRole: vi.fn(),
  addMember: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateProjects: () => mocks.canUpdate }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/queries/project-member/use-get-project-members", () => ({
  default: () => ({
    data: {
      callerRank: mocks.callerRank,
      canManageMembers: mocks.canManageMembers,
      members: mocks.members,
      roles: [
        {
          roleKey: "project-viewer",
          roleName: "Project viewer",
          roleRank: 20,
          roleId: null,
          isSystem: true,
          roleDescription: "Read-only access.",
        },
        {
          roleKey: "project-member",
          roleName: "Project member",
          roleRank: 40,
          roleId: null,
          isSystem: true,
          roleDescription: "Creates work.",
        },
        {
          roleKey: "project-lead",
          roleName: "Project lead",
          roleRank: 50,
          roleId: null,
          isSystem: true,
          roleDescription: "Runs the project.",
        },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock(
  "@/hooks/queries/project-member/use-get-project-member-candidates",
  () => ({
    default: () => ({ data: [], isLoading: false, isError: false }),
  }),
);
vi.mock(
  "@/hooks/mutations/project-member/use-project-member-mutations",
  () => ({
    useAddProjectMember: () => ({
      mutateAsync: mocks.addMember,
      isPending: false,
    }),
    useUpdateProjectMemberRole: () => ({
      mutateAsync: mocks.updateRole,
      isPending: false,
    }),
    useRemoveProjectMember: () => ({
      mutateAsync: mocks.removeMember,
      isPending: false,
    }),
  }),
);
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: toastError },
}));

const direct = {
  personId: "p-direct",
  displayName: "Dana Direct",
  active: true,
  jobTitle: null,
  roleKey: "project-member",
  roleName: "Project member",
  source: "direct",
  inheritedFrom: null,
  overridesInherited: null,
  managedExternally: false,
  removable: true,
};
const inherited = {
  ...direct,
  personId: "p-inherited",
  displayName: "Ines Inherited",
  source: "inherited",
  inheritedFrom: { projectId: "parent-1", projectName: "Programme" },
  removable: false,
};

beforeEach(() => {
  mocks.canUpdate = true;
  mocks.callerRank = undefined;
  mocks.canManageMembers = undefined;
  mocks.members = [direct, inherited];
  mocks.removeMember.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("ProjectMembersSettings", () => {
  it("shows inherited rows with the ancestor named and direct rows as direct", () => {
    render(<ProjectMembersSettings projectId="p1" />);
    expect(screen.getByText("Dana Direct")).toBeTruthy();
    expect(screen.getByText("Ines Inherited")).toBeTruthy();
    expect(
      screen.getByText(
        'settings:projectMembers.inheritedFrom {"project":"Programme"}',
      ),
    ).toBeTruthy();
    expect(screen.getByText("settings:projectMembers.direct")).toBeTruthy();
  });

  it("offers no add or row controls without the capability", () => {
    mocks.canUpdate = false;
    render(<ProjectMembersSettings projectId="p1" />);
    expect(screen.queryByTestId("customer-project-access")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:projectMembers.addMember",
      }),
    ).toBeNull();
    expect(
      screen.queryAllByRole("button", { name: /actionsFor/ }),
    ).toHaveLength(0);
  });

  it("explains an inherited membership is removed at the parent and never calls the API", async () => {
    render(<ProjectMembersSettings projectId="p1" />);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:projectMembers.actionsFor/,
      })[1] as HTMLElement,
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "settings:projectMembers.removeMember",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        /settings:projectMembers.inheritedDialogDescription/,
      ),
    ).toBeTruthy();
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it("removes a direct member after confirmation", async () => {
    render(<ProjectMembersSettings projectId="p1" />);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:projectMembers.actionsFor/,
      })[0] as HTMLElement,
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "settings:projectMembers.removeMember",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "settings:projectMembers.removeMember",
      }),
    );
    await waitFor(() =>
      expect(mocks.removeMember).toHaveBeenCalledWith({
        workspaceId: "w1",
        projectId: "p1",
        personId: "p-direct",
      }),
    );
  });

  it("shows a translated message, never server text or a project id, when removal fails", async () => {
    mocks.members = [direct];
    toastError.mockReset();
    mocks.removeMember.mockRejectedValue(
      new Error("inherited_membership: inherited from project abc-uuid"),
    );
    render(<ProjectMembersSettings projectId="p1" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /settings:projectMembers.actionsFor/,
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /settings:projectMembers.removeMember/,
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: /settings:projectMembers.removeMember/,
      }),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(
      "settings:projectMembers.errors.inheritedMembership",
    );
  });

  it("warns when the project has no members", () => {
    mocks.members = [];
    render(<ProjectMembersSettings projectId="p1" />);
    expect(screen.getByTestId("project-members-empty-warning")).toBeTruthy();
  });

  it("shows add and customer-access controls to a promoted project-lead member", () => {
    mocks.canUpdate = false;
    mocks.callerRank = 50;
    mocks.canManageMembers = true;
    render(<ProjectMembersSettings projectId="p1" />);
    expect(screen.getByTestId("customer-project-access")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings:projectMembers.addMember",
      }),
    ).toBeTruthy();
  });

  it("shows add and customer-access controls for an RL-3 custom role at rank 30 holding project:manage_members", () => {
    mocks.canUpdate = false;
    mocks.callerRank = 30;
    mocks.canManageMembers = true;
    render(<ProjectMembersSettings projectId="p1" />);
    expect(screen.getByTestId("customer-project-access")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "settings:projectMembers.addMember",
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /actionsFor/ }).length,
    ).toBeGreaterThan(0);
  });

  it("hides add, row, and customer-access controls when canManageMembers is false even at high rank", () => {
    mocks.canUpdate = true;
    mocks.callerRank = 60;
    mocks.canManageMembers = false;
    render(<ProjectMembersSettings projectId="p1" />);
    expect(screen.queryByTestId("customer-project-access")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "settings:projectMembers.addMember",
      }),
    ).toBeNull();
    expect(
      screen.queryAllByRole("button", { name: /actionsFor/ }),
    ).toHaveLength(0);
  });
});

vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({
    target,
  }: {
    target: { type: string; id: string; scope: Record<string, string> };
  }) => (
    <div data-testid="history-target">
      {target.type}:{target.id}:{target.scope.workspaceId}:
      {target.scope.projectId}
    </div>
  ),
}));

it("offers history only for a backed direct membership", async () => {
  mocks.canManageMembers = false;
  mocks.members = [
    { ...direct, membershipId: "project-row" },
    { ...inherited, membershipId: null },
    {
      ...direct,
      personId: "scim",
      managedExternally: true,
      membershipId: null,
    },
  ];
  render(<ProjectMembersSettings projectId="p1" />);
  const buttons = screen.getAllByRole("button", {
    name: /settings:history.memberHistory/,
  });
  expect(buttons).toHaveLength(1);
  fireEvent.click(buttons[0] as HTMLElement);
  expect(await screen.findByTestId("history-target")).toHaveTextContent(
    "project_membership:project-row:w1:p1",
  );
});

it("closes a direct membership history when its row is no longer a backed direct row", async () => {
  mocks.members = [{ ...direct, membershipId: "project-row" }];
  const view = render(<ProjectMembersSettings projectId="p1" />);
  fireEvent.click(
    screen.getByRole("button", { name: /settings:history.memberHistory/ }),
  );
  expect(await screen.findByTestId("history-target")).toBeTruthy();
  mocks.members = [{ ...direct, membershipId: null }];
  view.rerender(<ProjectMembersSettings projectId="p1" />);
  expect(screen.queryByTestId("history-target")).toBeNull();
  mocks.members = [{ ...direct, membershipId: "project-row" }];
  view.rerender(<ProjectMembersSettings projectId="p1" />);
  expect(screen.queryByTestId("history-target")).toBeNull();
});

it("hides history for invalid row IDs", () => {
  mocks.members = [
    { ...direct, membershipId: "\0bad" },
    { ...direct, personId: "other", membershipId: "x".repeat(201) },
  ];
  render(<ProjectMembersSettings projectId="p1" />);
  expect(
    screen.queryByRole("button", { name: /settings:history.memberHistory/ }),
  ).toBeNull();
});

it("does not submit an unchanged role", async () => {
  mocks.members = [{ ...direct, membershipId: "project-row" }];
  mocks.updateRole.mockReset();
  render(<ProjectMembersSettings projectId="p1" />);
  fireEvent.click(
    screen.getByRole("combobox", {
      name: /settings:projectMembers.changeRoleFor/,
    }),
  );
  const option = await screen.findByRole("option", { name: /Project member/ });
  expect(
    screen.getByText("settings:projectMembers.roleGroupBuiltIn"),
  ).toBeTruthy();
  // Built-in descriptions come from i18n by role key, not the API's English text.
  expect(
    screen.getByText("settings:projectMembers.roleDescriptionMember"),
  ).toBeTruthy();
  expect(screen.queryByText("Creates work.")).toBeNull();
  fireEvent.click(option);
  expect(mocks.updateRole).not.toHaveBeenCalled();
});
