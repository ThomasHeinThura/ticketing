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

const mocks = vi.hoisted(() => ({
  canUpdate: true,
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
vi.mock("@/hooks/queries/project-member/use-get-project-members", () => ({
  default: () => ({
    data: {
      members: mocks.members,
      roles: [
        {
          roleKey: "project-viewer",
          roleName: "Project viewer",
          roleRank: 20,
          roleId: null,
        },
        {
          roleKey: "project-member",
          roleName: "Project member",
          roleRank: 40,
          roleId: null,
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
});
