import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createContext, type ReactNode, useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    canManage: true,
    canUpdate: true,
    project: undefined as Record<string, unknown> | undefined,
    projects: [] as Array<Record<string, unknown>>,
    people: [] as Array<{ personId: string; name: string | null }>,
    updateProject: vi.fn(),
    updateOwnership: vi.fn(),
    invalidateQueries: vi.fn(),
    toastSuccess: vi.fn(),
  },
}));

type Item = { value: string; label: string };
const SelectContext = createContext<{
  items: Item[];
  value: string;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
}>({ items: [], value: "" });

vi.mock("@taskdesk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return {
    ...actual,
    Select: ({
      items,
      value,
      disabled,
      onValueChange,
      children,
    }: {
      items: Item[];
      value: string;
      disabled?: boolean;
      onValueChange?: (value: string) => void;
      children: ReactNode;
    }) => (
      <SelectContext.Provider value={{ items, value, disabled, onValueChange }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ id }: { id?: string }) => {
      const ctx = useContext(SelectContext);
      return (
        // ui-exempt: test double for the shared Select value/change contract.
        <select
          id={id}
          value={ctx.value}
          disabled={ctx.disabled}
          onChange={(event) => ctx.onValueChange?.(event.currentTarget.value)}
        >
          {ctx.items.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      );
    },
    SelectContent: () => null,
    SelectItem: () => null,
    SelectValue: () => null,
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateProjects: () => mocks.canUpdate,
    canManageProjectSettings: () => mocks.canManage,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({
    data: mocks.project,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: mocks.projects }),
}));
vi.mock("@/hooks/queries/work-item/use-get-assignable-people", () => ({
  default: () => ({ data: mocks.people, isLoading: false }),
}));
vi.mock("@/hooks/mutations/project/use-update-project", () => ({
  default: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
}));
vi.mock("@/hooks/mutations/project/use-update-project-ownership", () => ({
  default: () => ({ mutateAsync: mocks.updateOwnership, isPending: false }),
}));
// The preview dialog has its own tests; here it is a stand-in that shows whether a move is
// pending and lets the test confirm it.
vi.mock("./members/reparent-preview-dialog", () => ({
  default: ({
    parentId,
    onConfirm,
  }: {
    parentId: string | null | undefined;
    onConfirm: () => void;
  }) =>
    parentId === undefined ? null : (
      <Button data-testid="confirm-move" onClick={onConfirm}>
        confirm move to {String(parentId)}
      </Button>
    ),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    select: (state: { weekStartsOn: number }) => number,
  ) => select({ weekStartsOn: 1 }),
}));
vi.mock("@/lib/format", () => ({
  formatDateMedium: (value: Date) => value.toDateString(),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

import ProjectPlanningSettings from "./project-planning-settings";

function renderIt() {
  return render(<ProjectPlanningSettings projectId="p1" workspaceId="w1" />);
}

beforeEach(() => {
  mocks.canManage = true;
  mocks.canUpdate = true;
  mocks.project = {
    id: "p1",
    name: "Alpha",
    slug: "ALPHA",
    icon: "Layout",
    description: null,
    parentId: null,
    managerId: null,
    defaultAssigneeId: null,
    startDate: null,
    endDate: null,
    compositionWarnings: ["PR-6", "PR-10"],
  };
  mocks.projects = [
    { id: "p1", name: "Alpha", parentId: null },
    { id: "p2", name: "Programme", parentId: null },
  ];
  mocks.people = [
    { personId: "u1", name: "Jane Smith" },
    { personId: "u2", name: "John Doe" },
  ];
  mocks.updateProject.mockReset().mockResolvedValue({});
  mocks.updateOwnership.mockReset().mockResolvedValue({});
  mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ProjectPlanningSettings", () => {
  it("shows the warning-only composition rules the project violates", () => {
    renderIt();
    expect(screen.getByTestId("project-composition-warnings")).toBeTruthy();
    expect(
      screen.getByText("settings:projectGeneral.planning.warnings.PR-6"),
    ).toBeTruthy();
    expect(
      screen.getByText("settings:projectGeneral.planning.warnings.PR-10"),
    ).toBeTruthy();
    expect(
      screen.queryByText("settings:projectGeneral.planning.warnings.PR-7"),
    ).toBeNull();
  });

  it("autosaves only the changed field through the project update, with no Save button", async () => {
    renderIt();
    const manager = document.getElementById(
      "project-planning-manager",
    ) as HTMLSelectElement;
    fireEvent.change(manager, { target: { value: "u1" } });
    expect(
      screen.queryByRole("button", {
        name: "settings:projectGeneral.engagement.save",
      }),
    ).toBeNull();
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledTimes(1));
    expect(mocks.updateProject).toHaveBeenCalledWith({
      id: "p1",
      name: "Alpha",
      slug: "ALPHA",
      description: "",
      icon: "Layout",
      managerId: "u1",
    });
  });

  it("autosaves the default assignee in the same way", async () => {
    renderIt();
    fireEvent.change(
      document.getElementById(
        "project-planning-default-assignee",
      ) as HTMLSelectElement,
      { target: { value: "u2" } },
    );
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledTimes(1));
    expect(mocks.updateProject).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAssigneeId: "u2" }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "settings:projectGeneral.planning.saved",
    );
  });

  it("shows a refused autosave and keeps showing what is saved", async () => {
    mocks.updateProject.mockRejectedValue(new HttpError(403, "Forbidden"));
    renderIt();
    const manager = document.getElementById(
      "project-planning-manager",
    ) as HTMLSelectElement;
    fireEvent.change(manager, { target: { value: "u1" } });
    await screen.findByText(
      "settings:projectGeneral.planning.failure.forbidden",
    );
    expect(
      (document.getElementById("project-planning-manager") as HTMLSelectElement)
        .value,
    ).toBe("none");
  });

  it("labels every control with the library Label, not a native label", () => {
    renderIt();
    for (const id of [
      "project-planning-parent",
      "project-planning-manager",
      "project-planning-start",
      "project-planning-end",
      "project-planning-default-assignee",
    ]) {
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label, id).not.toBeNull();
      expect(label?.getAttribute("data-slot")).toBe("label");
    }
  });

  it("sets the parent through the ownership route, not the general update", async () => {
    renderIt();
    const parent = document.getElementById(
      "project-planning-parent",
    ) as HTMLSelectElement;
    fireEvent.change(parent, { target: { value: "p2" } });
    // Nothing is written until the previewed move is confirmed.
    expect(mocks.updateOwnership).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("confirm-move"));
    await waitFor(() => expect(mocks.updateOwnership).toHaveBeenCalledTimes(1));
    expect(mocks.updateOwnership).toHaveBeenCalledWith({
      projectId: "p1",
      parentId: "p2",
    });
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("explains a refused re-parent", async () => {
    mocks.updateOwnership.mockRejectedValue(
      new HttpError(422, "PR-1: the hierarchy is capped at 4 levels"),
    );
    renderIt();
    fireEvent.change(
      document.getElementById("project-planning-parent") as HTMLSelectElement,
      { target: { value: "p2" } },
    );
    fireEvent.click(await screen.findByTestId("confirm-move"));
    await screen.findByText(
      "settings:projectGeneral.planning.ownershipFailure.depth",
    );
  });

  it("does not offer the project itself or its descendants as a parent", () => {
    mocks.projects = [
      { id: "p1", name: "Alpha", parentId: null },
      { id: "c1", name: "Child", parentId: "p1" },
      { id: "p2", name: "Programme", parentId: null },
    ];
    renderIt();
    const parent = document.getElementById(
      "project-planning-parent",
    ) as HTMLSelectElement;
    const labels = Array.from(parent.options).map((option) => option.text);
    expect(labels).toContain("Programme");
    expect(labels).not.toContain("Alpha");
    expect(labels).not.toContain("Child");
  });

  it("is read-only without project:manage_settings", () => {
    mocks.canManage = false;
    renderIt();
    expect(screen.getByTestId("project-planning-readonly")).toBeTruthy();
    expect(
      (document.getElementById("project-planning-manager") as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", {
        name: "settings:projectGeneral.engagement.save",
      }),
    ).toBeNull();
  });
});
