import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exerciseCallerRace } from "./project-write-race.test-helper";

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () => ({
      data: { session: { id: "session-1" } },
      error: null,
    }),
  },
}));
vi.mock("@/fetchers/project/get-project", async () => ({
  default: async () => ({
    ...(await import("./project-write-race.test-helper")).race.server,
  }),
}));
vi.mock("@taskdesk/libs", async () => ({
  client: {
    project: {
      ":id": {
        $put: (...args: unknown[]) =>
          import("./project-write-race.test-helper").then(({ race }) =>
            race.writes(...args),
          ),
      },
    },
  },
}));

const { mocks } = vi.hoisted(() => ({
  mocks: {
    caps: { manageProjectSettings: true, manageProjects: true },
    project: undefined as Record<string, unknown> | undefined,
    updateProject: vi.fn(),
    invalidateQueries: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  },
}));

vi.mock("@taskdesk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return {
    ...actual,
    Select: ({
      value,
      onValueChange,
      disabled,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      disabled?: boolean;
      children: ReactNode;
    }) => (
      // ui-exempt: test double for the shared Select value/change contract.
      <select
        aria-label="default visibility"
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
      >
        {children}
      </select>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: ReactNode;
    }) => <option value={value}>{children}</option>,
    SelectTrigger: () => null,
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
    canManageProjectSettings: () => mocks.caps.manageProjectSettings,
    canUpdateProjects: () => mocks.caps.manageProjects,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: mocks.project }),
}));
vi.mock("@/hooks/mutations/project/use-update-project", () => ({
  default: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import DefaultCommentVisibilitySetting from "./default-comment-visibility-setting";

function renderSetting() {
  return render(
    <DefaultCommentVisibilitySetting
      projectId="project-1"
      workspaceId="workspace-1"
    />,
  );
}

describe("DefaultCommentVisibilitySetting (CA-2)", () => {
  beforeEach(() => {
    mocks.caps = { manageProjectSettings: true, manageProjects: true };
    mocks.project = {
      id: "project-1",
      name: "Service desk",
      slug: "SD",
      description: null,
      icon: "Folder",
      defaultCommentVisibility: "internal",
    };
    mocks.updateProject.mockReset().mockResolvedValue({});
    mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });
  afterEach(() => cleanup());

  it("is hidden without the strict manageProjectSettings capability, even with the legacy project update flag", () => {
    mocks.caps = { manageProjectSettings: false, manageProjects: true };
    renderSetting();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "settings:projectGeneral.defaultCommentVisibilityLabel",
      ),
    ).not.toBeInTheDocument();
  });

  it("hides the control when the required project update gate is absent", () => {
    mocks.caps = { manageProjectSettings: true, manageProjects: false };
    renderSetting();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("is shown with the capability and reflects the project's current default", () => {
    mocks.project = { ...mocks.project, defaultCommentVisibility: "public" };
    renderSetting();

    expect(
      screen.getByText("settings:projectGeneral.defaultCommentVisibilityLabel"),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("public");
  });

  it("saves the new default with the project's current fields and refreshes caches", async () => {
    renderSetting();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "public" },
    });

    await waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledWith({
        id: "project-1",
        defaultCommentVisibility: "public",
      }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects"],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["work-items"],
    });
  });

  it("does not save when the selection is unchanged", () => {
    renderSetting();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "internal" },
    });

    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("surfaces a server refusal and does not report success", async () => {
    mocks.updateProject.mockRejectedValue(
      new Error("Insufficient permissions"),
    );
    renderSetting();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "public" },
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Insufficient permissions"),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("is disabled while the project has not loaded", () => {
    mocks.project = undefined;
    renderSetting();

    expect(screen.getByRole("combobox")).toBeDisabled();
  });
  it.each(["sibling first", "rename first"])(
    "preserves the key when visibility saves %s",
    async (order) => {
      renderSetting();
      await exerciseCallerRace(
        order,
        "project-1",
        () =>
          fireEvent.change(screen.getByRole("combobox"), {
            target: { value: "public" },
          }),
        mocks.updateProject,
        { defaultCommentVisibility: "public" },
      );
    },
  );
});
