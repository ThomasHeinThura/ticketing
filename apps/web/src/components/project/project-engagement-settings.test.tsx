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
    canUpdate: true,
    checking: false,
    project: undefined as Record<string, unknown> | undefined,
    projectState: { isLoading: false, isError: false },
    calendars: undefined as
      | { data: { id: string; name: string }[] }
      | undefined,
    calendarState: { isLoading: false, isError: false },
    updateProject: vi.fn(),
    updateHealth: vi.fn(),
    invalidateQueries: vi.fn(),
    refetch: vi.fn(),
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
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({
    data: mocks.project,
    ...mocks.projectState,
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/hooks/queries/service-calendar/use-service-calendars", () => ({
  useServiceCalendars: () => ({
    data: mocks.calendars,
    ...mocks.calendarState,
    refetch: mocks.refetch,
  }),
}));
vi.mock("@/hooks/mutations/project/use-update-project", () => ({
  default: () => ({ mutateAsync: mocks.updateProject, isPending: false }),
}));
vi.mock("@/fetchers/project/update-health", () => ({
  default: mocks.updateHealth,
  updateProjectHealth: mocks.updateHealth,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

import ProjectEngagementSettings from "./project-engagement-settings";

const KEY = "settings:projectGeneral.engagement";
const kind = () => screen.getByLabelText(`${KEY}.kind`);
const health = () => screen.getByLabelText(`${KEY}.health`);
const support = () => screen.getByLabelText(`${KEY}.supportLevel`);
const calendar = () => screen.getByLabelText(`${KEY}.serviceCalendar`);
const save = () => screen.getByRole("button", { name: `${KEY}.save` });

describe("ProjectEngagementSettings", () => {
  beforeEach(() => {
    mocks.canUpdate = true;
    mocks.checking = false;
    mocks.projectState = { isLoading: false, isError: false };
    mocks.calendarState = { isLoading: false, isError: false };
    mocks.project = {
      id: "project-1",
      name: "Service desk",
      slug: "SD",
      description: null,
      icon: "Folder",
      kind: "project",
      health: null,
      supportLevel: null,
      serviceCalendarId: null,
    };
    mocks.calendars = { data: [{ id: "cal-1", name: "Support hours" }] };
    mocks.updateProject.mockReset().mockResolvedValue({});
    mocks.updateHealth.mockReset().mockResolvedValue({ health: "amber" });
    mocks.invalidateQueries.mockReset().mockResolvedValue(undefined);
    mocks.refetch.mockReset();
    mocks.toastSuccess.mockReset();
  });
  afterEach(() => cleanup());

  const render_ = () =>
    render(
      <ProjectEngagementSettings projectId="project-1" workspaceId="ws-1" />,
    );

  it("shows a loading state, then an error state with a retry", () => {
    mocks.projectState = { isLoading: true, isError: false };
    mocks.project = undefined;
    const { unmount } = render_();
    expect(
      screen.getByTestId("project-engagement-loading"),
    ).toBeInTheDocument();
    unmount();

    mocks.projectState = { isLoading: false, isError: true };
    render_();
    expect(screen.getByRole("alert")).toHaveTextContent(`${KEY}.loadError`);
    fireEvent.click(screen.getByRole("button", { name: `${KEY}.retry` }));
    expect(mocks.refetch).toHaveBeenCalled();
  });

  it("renders the saved values", () => {
    mocks.project = {
      ...mocks.project,
      kind: "managed_service",
      supportLevel: "L2",
      serviceCalendarId: "cal-1",
      health: "red",
    };
    render_();
    expect(kind()).toHaveValue("managed_service");
    expect(support()).toHaveValue("L2");
    expect(calendar()).toHaveValue("cal-1");
    expect(health()).toHaveValue("red");
    expect(save()).toBeDisabled();
  });

  it("PR-9: refuses a managed service without support level or calendar and sends nothing", () => {
    render_();
    fireEvent.change(kind(), { target: { value: "managed_service" } });
    fireEvent.click(save());

    expect(screen.getByText(`${KEY}.supportLevelRequired`)).toBeInTheDocument();
    expect(screen.getByText(`${KEY}.calendarRequired`)).toBeInTheDocument();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("PR-9: names only the field still missing", () => {
    render_();
    fireEvent.change(kind(), { target: { value: "managed_service" } });
    fireEvent.change(support(), { target: { value: "L1" } });
    fireEvent.click(save());

    expect(screen.queryByText(`${KEY}.supportLevelRequired`)).toBeNull();
    expect(screen.getByText(`${KEY}.calendarRequired`)).toBeInTheDocument();
    expect(mocks.updateProject).not.toHaveBeenCalled();
  });

  it("saves a complete managed service with the project's own fields and refreshes caches", async () => {
    render_();
    fireEvent.change(kind(), { target: { value: "managed_service" } });
    fireEvent.change(support(), { target: { value: "L2" } });
    fireEvent.change(calendar(), { target: { value: "cal-1" } });
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledWith({
        id: "project-1",
        name: "Service desk",
        slug: "SD",
        description: "",
        icon: "Folder",
        kind: "managed_service",
        supportLevel: "L2",
        serviceCalendarId: "cal-1",
      }),
    );
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["projects"],
    });
  });

  it("clears a field with an explicit null", async () => {
    mocks.project = {
      ...mocks.project,
      supportLevel: "L1",
      serviceCalendarId: "cal-1",
    };
    render_();
    fireEvent.change(support(), { target: { value: "none" } });
    fireEvent.change(calendar(), { target: { value: "none" } });
    fireEvent.click(save());

    await waitFor(() =>
      expect(mocks.updateProject).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "project",
          supportLevel: null,
          serviceCalendarId: null,
        }),
      ),
    );
  });

  it("shows the server's PR-9 422 as a translated message", async () => {
    mocks.updateProject.mockRejectedValue(
      new HttpError(422, "PR-9: managed services require a support level"),
    );
    mocks.project = {
      ...mocks.project,
      kind: "managed_service",
      supportLevel: "L1",
      serviceCalendarId: "cal-1",
    };
    render_();
    fireEvent.change(support(), { target: { value: "L3" } });
    fireEvent.click(save());

    expect(
      await screen.findByText(`${KEY}.failure.managedServiceIncomplete`),
    ).toBeInTheDocument();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("sets health through the health route and clears it with null", async () => {
    render_();
    fireEvent.change(health(), { target: { value: "amber" } });
    await waitFor(() =>
      expect(mocks.updateHealth).toHaveBeenCalledWith("project-1", "amber"),
    );

    mocks.project = { ...mocks.project, health: "amber" };
    cleanup();
    render_();
    fireEvent.change(health(), { target: { value: "none" } });
    await waitFor(() =>
      expect(mocks.updateHealth).toHaveBeenLastCalledWith("project-1", null),
    );
  });

  it("handles a 403 on health: message shown, value reverts, capabilities refreshed", async () => {
    mocks.updateHealth.mockRejectedValue(
      new HttpError(403, "Insufficient permissions"),
    );
    render_();
    fireEvent.change(health(), { target: { value: "red" } });

    expect(
      await screen.findByTestId("project-engagement-health-error"),
    ).toHaveTextContent(`${KEY}.failure.forbidden`);
    expect(health()).toHaveValue("none");
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["workspace-capabilities", "ws-1"],
    });
  });

  it("without project:update every control is disabled, save is absent and a notice explains", () => {
    mocks.canUpdate = false;
    render_();
    expect(kind()).toBeDisabled();
    expect(health()).toBeDisabled();
    expect(support()).toBeDisabled();
    expect(calendar()).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: `${KEY}.save` }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("project-engagement-readonly"),
    ).toBeInTheDocument();
    expect(mocks.updateHealth).not.toHaveBeenCalled();
  });

  it("keeps a saved calendar that is missing from the loaded list", () => {
    mocks.project = { ...mocks.project, serviceCalendarId: "cal-gone" };
    render_();
    expect(calendar()).toHaveValue("cal-gone");
  });

  it("offers a retry when calendars fail to load", () => {
    mocks.calendars = undefined;
    mocks.calendarState = { isLoading: false, isError: true };
    render_();
    expect(screen.getByText(`${KEY}.calendarsError`)).toBeInTheDocument();
  });

  it("never renders or sends the customer organisation binding", async () => {
    mocks.project = { ...mocks.project, organisationId: "org-9" };
    render_();
    fireEvent.change(kind(), { target: { value: "managed_service" } });
    fireEvent.change(support(), { target: { value: "L1" } });
    fireEvent.change(calendar(), { target: { value: "cal-1" } });
    fireEvent.click(save());
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalled());
    expect(mocks.updateProject.mock.calls[0]?.[0]).not.toHaveProperty(
      "organisationId",
    );
  });
});
