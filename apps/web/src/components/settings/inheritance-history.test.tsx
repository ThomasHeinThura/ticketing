import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createContext, type ReactNode, useContext } from "react";
import { expect, it, vi } from "vitest";
import ProjectEngagementSettings from "@/components/project/project-engagement-settings";
import { SettingsHistory } from "./settings-history";
import { WorkspaceProjectDefaultsPanel } from "./workspace-project-defaults-panel";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  patchWorkspace: vi.fn(),
  patchProject: vi.fn(),
  updateHealth: vi.fn(),
}));
vi.mock("@/fetchers/project/update-health", () => ({
  default: mocks.updateHealth,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u1" }, session: { id: "s1" } } }),
    getSession: async () => ({
      data: { user: { id: "u1" }, session: { id: "s1" } },
    }),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: { defaultValue?: string; actor?: string; at?: string },
    ) =>
      (options?.defaultValue ?? key)
        .replace("{{actor}}", options?.actor ?? "")
        .replace("{{at}}", options?.at ?? ""),
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/fetchers/settings/settings-history", async (original) => ({
  ...(await original<typeof import("@/fetchers/settings/settings-history")>()),
  getSettingsHistory: mocks.history,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => true,
    canManageProjectSettings: () => true,
    canUpdateProjects: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/feature-flag/use-workspace-features", () => ({
  default: () => ({ isOn: () => true, isLoading: false }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({
    data: { id: "p1", kind: "project", health: null, supportLevel: null },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/mutations/project/use-update-project", () => ({
  default: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
const inheritance = {
  projectId: "p1",
  workspaceId: "w1",
  projectVersion: 1,
  workspaceVersion: 1,
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
  states: { mode: "inherit", activeTemplateIds: [], workspaceTemplateIds: [] },
};
const defaults = {
  workspaceId: "w1",
  version: 1,
  defaultSlaPolicyId: null,
  defaultServiceCalendarId: null,
  enabledStateTemplateIds: [],
};
vi.mock("@/fetchers/project-settings-inheritance", () => ({
  getProjectSettingsInheritance: async () => inheritance,
  patchProjectSettingsInheritance: mocks.patchProject,
  getWorkspaceProjectSettings: async () => defaults,
  patchWorkspaceProjectSettings: mocks.patchWorkspace,
  WorkspaceSettingsError: class extends Error {},
}));
vi.mock("@/fetchers/service-calendar", () => ({
  getServiceCalendars: async () => ({
    data: [{ id: "cal", name: "Calendar" }],
    page: { nextCursor: null },
  }),
}));
vi.mock("@/fetchers/sla-policy", () => ({
  getSlaPolicies: async () => ({ data: [], page: { nextCursor: null } }),
}));
type SelectState = {
  items: { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
};
const SelectContext = createContext<SelectState>({
  items: [],
  value: "",
  onValueChange: () => {},
});
vi.mock("@taskdesk/ui", async (original) => ({
  ...(await original<typeof import("@taskdesk/ui")>()),
  Select: ({ children, ...props }: SelectState & { children: ReactNode }) => (
    <SelectContext.Provider value={props}>{children}</SelectContext.Provider>
  ),
  SelectTrigger: ({ id }: { id: string }) => {
    const ctx = useContext(SelectContext);
    return (
      // ui-exempt: test double for the shared Select value/change contract.
      <select
        id={id}
        value={ctx.value}
        onChange={(event) => ctx.onValueChange(event.target.value)}
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
}));

it.each(["workspace", "project"] as const)(
  "refreshes open %s History after saving inheritance",
  async (type) => {
    const id = type === "workspace" ? "w1" : "p1";
    mocks.history.mockReset();
    let name = "Before";
    mocks.history.mockImplementation(async () => ({
      entityType: type,
      entityId: id,
      lastChanged: { actor: { kind: "person", name }, at: "2026-01-01" },
      rows: [],
    }));
    mocks.patchWorkspace.mockImplementation(async () => {
      name = "After";
      return { ...defaults, version: 2, defaultServiceCalendarId: "cal" };
    });
    mocks.patchProject.mockImplementation(async () => {
      name = "After";
      return {
        ...inheritance,
        projectVersion: 2,
        serviceCalendar: {
          ...inheritance.serviceCalendar,
          mode: "override",
          overrideId: "cal",
        },
      };
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SettingsHistory type={type} id={id} userId="u1" />
        {type === "workspace" ? (
          <WorkspaceProjectDefaultsPanel workspaceId="w1" />
        ) : (
          <ProjectEngagementSettings workspaceId="w1" projectId="p1" />
        )}
      </QueryClientProvider>,
    );
    await screen.findByText(/Last changed by Before/);
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
    await screen.findByText(/Last changed by Before/);
    const label =
      type === "workspace"
        ? "settings:workspaceProjectDefaults.defaultServiceCalendar"
        : "settings:projectInheritance.serviceCalendar";
    fireEvent.change(await screen.findByLabelText(label), {
      target: { value: "cal" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name:
          type === "workspace"
            ? "settings:workspaceProjectDefaults.save"
            : "settings:projectInheritance.save",
      }),
    );
    await screen.findByText(/Last changed by After/);
  },
);

it("refreshes open project History after changing health", async () => {
  mocks.history.mockReset();
  let name = "Before";
  mocks.history.mockImplementation(async () => ({
    entityType: "project",
    entityId: "p1",
    lastChanged: { actor: { kind: "person", name }, at: "2026-01-01" },
    rows: [],
  }));
  mocks.updateHealth.mockImplementation(async () => {
    name = "After";
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SettingsHistory type="project" id="p1" userId="u1" />
      <ProjectEngagementSettings workspaceId="w1" projectId="p1" />
    </QueryClientProvider>,
  );
  await screen.findByText(/Last changed by Before/);
  fireEvent.click(screen.getByRole("button", { name: /History/ }));
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(2));
  fireEvent.change(
    screen.getByLabelText("settings:projectGeneral.engagement.health"),
    {
      target: { value: "amber" },
    },
  );
  await screen.findByText(/Last changed by After/);
  expect(mocks.updateHealth).toHaveBeenCalledWith("p1", "amber");
});
