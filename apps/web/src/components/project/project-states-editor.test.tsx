import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    canManage: true,
    states: [] as Array<Record<string, unknown>>,
    inheritance: {
      projectId: "p1",
      workspaceId: "w1",
      projectVersion: 3,
      workspaceVersion: 4,
      slaPolicy: {
        mode: "inherit",
        overrideId: null,
        effectiveId: null,
        effectiveName: null,
        source: "none",
      },
      serviceCalendar: {
        mode: "inherit",
        overrideId: null,
        effectiveId: null,
        effectiveName: null,
        source: "none",
      },
      states: {
        mode: "override",
        activeTemplateIds: ["a"],
        workspaceTemplateIds: ["a", "b"],
      },
    },
    updateState: vi.fn(),
    invalidate: vi.fn(),
    setQueryData: vi.fn(),
    inheritStateSet: vi.fn(),
    onDragEnd: undefined as ((event: unknown) => void) | undefined,
    sensors: undefined as unknown,
  },
}));

// The per-state limit field has its own tests and its own queries.
vi.mock("./state-wip-limit-field", () => ({ default: () => null }));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      mocks.onDragEnd = props.onDragEnd as typeof mocks.onDragEnd;
      mocks.sensors = props.accessibility;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidate,
    setQueryData: mocks.setQueryData,
  }),
  useQuery: () => ({
    data: mocks.inheritance,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageProjectSettings: () => mocks.canManage,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: () => ({
    data: mocks.states,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project-state-templates", () => ({
  default: () => ({ data: [] }),
}));
vi.mock("@/hooks/mutations/project/use-create-project-state", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/mutations/project/use-update-project-state", () => ({
  default: () => ({ mutateAsync: mocks.updateState }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/fetchers/project-settings-inheritance", () => ({
  getProjectSettingsInheritance: vi.fn(async () => mocks.inheritance),
  inheritProjectStateSet: mocks.inheritStateSet,
  WorkspaceSettingsError: class extends Error {
    status: number;
    constructor(status: number) {
      super();
      this.status = status;
    }
  },
}));

import ProjectStatesEditor from "./project-states-editor";

const state = (id: string, name: string, isDefault = false) => ({
  id,
  name,
  group: "started",
  isDefault,
});

beforeEach(() => {
  mocks.canManage = true;
  mocks.states = [
    state("a", "Open", true),
    state("b", "Doing"),
    state("c", "Done"),
  ];
  mocks.updateState.mockReset().mockResolvedValue({});
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.inheritStateSet.mockReset().mockResolvedValue(mocks.inheritance);
  mocks.setQueryData.mockReset();
});
afterEach(cleanup);

describe("project states editor reorder (PR-17)", () => {
  it("is a dnd-kit sortable list with a labelled, focusable handle per state, not HTML5 draggable", () => {
    render(<ProjectStatesEditor projectId="p1" workspaceId="w1" />);
    const items = document.querySelectorAll("[data-state-id]");
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.getAttribute("draggable")).toBeNull();
    const handle = screen.getByRole("button", {
      name: "settings:projectStates.reorder:Doing",
    });
    expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    expect(handle.tabIndex).toBe(0);
  });

  it("persists the dropped position of the moved state", async () => {
    render(<ProjectStatesEditor projectId="p1" workspaceId="w1" />);
    mocks.onDragEnd?.({ active: { id: "c" }, over: { id: "a" } });
    await waitFor(() =>
      expect(mocks.updateState).toHaveBeenCalledWith({
        projectId: "p1",
        stateId: "c",
        position: 0,
      }),
    );
  });

  it("ignores a drop on itself and gives anyone without manage_settings no handle", () => {
    render(<ProjectStatesEditor projectId="p1" workspaceId="w1" />);
    mocks.onDragEnd?.({ active: { id: "b" }, over: { id: "b" } });
    expect(mocks.updateState).not.toHaveBeenCalled();
    cleanup();
    mocks.canManage = false;
    render(<ProjectStatesEditor projectId="p1" workspaceId="w1" />);
    for (const handle of screen.getAllByRole("button", {
      name: /settings:projectStates.reorder/,
    }))
      expect(handle).toBeDisabled();
    mocks.onDragEnd?.({ active: { id: "c" }, over: { id: "a" } });
    expect(mocks.updateState).not.toHaveBeenCalled();
  });

  it("passes localised announcements and keyboard instructions to the drag context", () => {
    render(<ProjectStatesEditor projectId="p1" workspaceId="w1" />);
    expect(mocks.sensors).toMatchObject({
      screenReaderInstructions: {
        draggable: "common:a11y.dnd.instructions",
      },
    });
  });

  it("syncs the concrete state membership to the workspace set with both CAS versions", async () => {
    render(<ProjectStatesEditor projectId="p1" workspaceId="w1" />);
    await waitFor(() =>
      expect(screen.getByTestId("project-state-inheritance")).toHaveTextContent(
        "settings:projectInheritance.workspaceSet",
      ),
    );
    const useButton = screen.getByRole("button", {
      name: "settings:projectInheritance.useWorkspace",
    });
    fireEvent.click(useButton);
    await waitFor(() =>
      expect(mocks.inheritStateSet).toHaveBeenCalledWith({
        projectId: "p1",
        expectedProjectVersion: 3,
        expectedWorkspaceVersion: 4,
      }),
    );
  });
});
