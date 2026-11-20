import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTimeSettings: vi.fn(),
  assertSession: vi.fn(),
  workspaceId: "w1",
  session: { user: { id: "user-1" }, session: { id: "session-1" } },
  workspaceAllowed: true,
  projectAllowed: true,
  capabilities: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  updateTimeSettings: vi.fn(),
  getAvailableHours: vi.fn(),
  createAvailableHours: vi.fn(),
}));

vi.mock("@taskdesk/libs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@taskdesk/libs")>();
  return {
    ...original,
    client: new Proxy(original.client, {
      get(target, key) {
        if (key === "capabilities") return { $get: mocks.capabilities };
        return Reflect.get(target, key);
      },
    }),
  };
});
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session }) },
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({ target }: { target: unknown }) => (
    <div data-testid="settings-history">{JSON.stringify(target)}</div>
  ),
}));
vi.mock("@/lib/profile-session-guard", () => ({
  profileSessionGuard:
    (...args: unknown[]) =>
    () =>
      mocks.assertSession(...args),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/format", () => ({
  formatDate: (value: unknown) => String(value),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: mocks.workspaceId }, isLoading: false }),
}));
vi.mock("@/fetchers/time-tracking", () => ({
  TimeRuleError: class extends Error {},
  TimeTrackingDisabledError: class extends Error {},
  getTimeSettings: (...args: unknown[]) => mocks.getTimeSettings(...args),
  updateTimeSettings: (...args: unknown[]) => mocks.updateTimeSettings(...args),
  getAvailableHours: (...args: unknown[]) => mocks.getAvailableHours(...args),
  createAvailableHours: (...args: unknown[]) =>
    mocks.createAvailableHours(...args),
  getTimer: vi.fn(),
  getTimeActivities: vi.fn(),
  getTimeEntries: vi.fn(),
  getHourlyRates: vi.fn(),
  getProjectBudget: vi.fn(),
  stopTimer: vi.fn(),
}));

import {
  AvailableHoursSetting,
  BackdateLimitSetting,
  ProjectBillableSetting,
} from "./time-settings";

/** The targets the global MutationCache would withdraw for the last save. */
const auditedTargets = (client: QueryClient) => {
  const mutation = client.getMutationCache().getAll().at(-1);
  return mutation?.options.meta?.audits?.targets(
    mutation.state.variables as never,
    mutation.state.data as never,
  );
};

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, retryDelay: 0 } },
        })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.workspaceId = "w1";
  mocks.session = { user: { id: "user-1" }, session: { id: "session-1" } };
  mocks.workspaceAllowed = true;
  mocks.projectAllowed = true;
  mocks.assertSession.mockResolvedValue(undefined);
  mocks.capabilities.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      manageWorkspaceSettings: mocks.workspaceAllowed,
      manageProjectSettings: mocks.projectAllowed,
    }),
  }));
  mocks.getTimeSettings.mockResolvedValue({
    backdateLimitDays: 30,
    canManage: true,
    project: { id: "p1", defaultBillable: true },
  });
  mocks.updateTimeSettings.mockImplementation(
    async (input: {
      backdateLimitDays?: number;
      project?: { id: string; defaultBillable: boolean };
    }) => ({
      backdateLimitDays: input.backdateLimitDays ?? 30,
      canManage: true,
      project: input.project ?? null,
    }),
  );
  mocks.getAvailableHours.mockResolvedValue({
    data: [
      {
        id: "h1",
        personId: "me",
        personName: "Me",
        minutesPerWeek: 2400,
        effectiveFrom: "2026-01-01",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    canManage: true,
    people: [
      { personId: "me", name: "Me" },
      { personId: "ann", name: "Ann" },
    ],
    callerPersonId: "me",
  });
  mocks.createAvailableHours.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BackdateLimitSetting", () => {
  it("saves a whole number of days", async () => {
    wrap(<BackdateLimitSetting />);
    const input = (await screen.findByLabelText(
      "timeTracking:settings.backdateLimit",
    )) as HTMLInputElement;
    expect(input.value).toBe("30");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    );
    await waitFor(() =>
      expect(mocks.updateTimeSettings).toHaveBeenCalledWith({
        workspaceId: "w1",
        backdateLimitDays: 7,
      }),
    );
  });

  it("will not save a value that is not whole days", async () => {
    wrap(<BackdateLimitSetting />);
    const input = await screen.findByLabelText(
      "timeTracking:settings.backdateLimit",
    );
    fireEvent.change(input, { target: { value: "1.5" } });
    const save = screen.getByRole("button", {
      name: "timeTracking:actions.save",
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "4000" } });
    expect(save.disabled).toBe(true);
  });

  it("is read-only without workspace:manage_settings", async () => {
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: false,
      project: null,
    });
    wrap(<BackdateLimitSetting />);
    expect(
      await screen.findByText("timeTracking:settings.backdateLimit: 30"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "timeTracking:actions.save" }),
    ).toBeNull();
  });
});

describe("ProjectBillableSetting", () => {
  it("changes the project's billable default", async () => {
    wrap(<ProjectBillableSetting projectId="p1" />);
    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mocks.updateTimeSettings).toHaveBeenCalledWith({
        workspaceId: "w1",
        project: { id: "p1", defaultBillable: false },
      }),
    );
  });

  it("renders nothing when the project cannot be read", async () => {
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: true,
      project: null,
    });
    const view = wrap(<ProjectBillableSetting projectId="p1" />);
    await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
    expect(view.container.querySelector("[role=switch]")).toBeNull();
  });
});

describe("AvailableHoursSetting", () => {
  it("lists the history and posts hours per week as integer minutes", async () => {
    wrap(<AvailableHoursSetting />);
    expect(await screen.findAllByTestId("available-hours-row")).toHaveLength(1);
    expect(screen.getByText("40:00")).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText("timeTracking:availableHours.hoursPerWeek", {
        selector: "input",
      }),
      { target: { value: "37.5" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:availableHours.add" }),
    );
    await waitFor(() =>
      expect(mocks.createAvailableHours).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createAvailableHours).toHaveBeenCalledWith({
      workspaceId: "w1",
      personId: "me",
      minutesPerWeek: 2250,
      effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    });
  });

  it("will not post text that is not hours", async () => {
    wrap(<AvailableHoursSetting />);
    const input = await screen.findByLabelText(
      "timeTracking:availableHours.hoursPerWeek",
      { selector: "input" },
    );
    fireEvent.change(input, { target: { value: "lots" } });
    const add = screen.getByRole("button", {
      name: "timeTracking:availableHours.add",
    }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "169" } });
    expect(add.disabled).toBe(true);
  });

  it("is hidden from people without workspace:manage_settings", async () => {
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: false,
      project: null,
    });
    const view = wrap(<AvailableHoursSetting />);
    await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
    expect(
      view.container.querySelector("[data-testid=available-hours]"),
    ).toBeNull();
    expect(mocks.getAvailableHours).not.toHaveBeenCalled();
  });
});

it("declares the saved workspace's time settings as the History target", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("timeTracking:settings.saved"),
  );
  expect(auditedTargets(client)).toEqual([
    { kind: "time-settings", scope: { kind: "workspace", workspaceId: "w1" } },
    {
      kind: "entity",
      type: "workspace",
      id: "w1",
      scope: { kind: "workspace", workspaceId: "w1" },
    },
  ]);
});

it("ignores an old workspace save completion after switching session and target", async () => {
  let finish!: (value: unknown) => void;
  mocks.updateTimeSettings.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const setCache = vi.spyOn(client, "setQueryData");
  const view = render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  fireEvent.change(
    await screen.findByLabelText("timeTracking:settings.backdateLimit"),
    { target: { value: "7" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await waitFor(() => expect(mocks.updateTimeSettings).toHaveBeenCalled());
  mocks.workspaceId = "w2";
  mocks.session = { user: { id: "user-2" }, session: { id: "session-2" } };
  mocks.getTimeSettings.mockResolvedValue({
    backdateLimitDays: 42,
    canManage: true,
    project: null,
  });
  view.rerender(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  fireEvent.change(input, { target: { value: "15" } });
  finish({});
  await waitFor(() =>
    expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success"),
  );
  expect(input).toHaveValue("15");
  expect(mocks.success).not.toHaveBeenCalled();
  expect(
    setCache.mock.calls.some(
      ([key]) =>
        JSON.stringify(key) ===
        JSON.stringify(["time-tracking", "settings", "w1", ""]),
    ),
  ).toBe(false);
});

it("declares the saved project's time settings as the History target", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("switch"));
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("timeTracking:settings.saved"),
  );
  expect(auditedTargets(client)).toEqual([
    {
      kind: "time-settings",
      scope: { kind: "project", workspaceId: "w1", projectId: "p1" },
    },
    {
      kind: "entity",
      type: "project",
      id: "p1",
      scope: { kind: "project", workspaceId: "w1", projectId: "p1" },
    },
  ]);
});

it("clears the Saved feedback when a new backdate draft is edited", async () => {
  wrap(<BackdateLimitSetting />);
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await screen.findByRole("button", { name: "common:actions.saved" });
  fireEvent.change(input, { target: { value: "8" } });
  expect(input).toHaveValue("8");
  expect(
    screen.queryByRole("button", { name: "common:actions.saved" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  ).toBeEnabled();
});

it("does not clear a newer backdate draft when an older pending save completes", async () => {
  let finish!: (value: unknown) => void;
  mocks.updateTimeSettings.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  wrap(<BackdateLimitSetting />);
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await waitFor(() => expect(mocks.updateTimeSettings).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: "8" } });
  finish({ backdateLimitDays: 7, canManage: true, project: null });
  await waitFor(() => expect(mocks.assertSession).toHaveBeenCalled());
  expect(input).toHaveValue("8");
  expect(
    screen.queryByRole("button", { name: "common:actions.saved" }),
  ).toBeNull();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    ).toBeEnabled(),
  );
  expect(mocks.success).not.toHaveBeenCalled();
});

it("retains the confirmed backdate value and other response fields when the follow-up read fails", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  await screen.findByTestId("settings-history");
  mocks.getTimeSettings.mockRejectedValue(
    Object.assign(new Error("read failed"), { status: 403 }),
  );
  mocks.updateTimeSettings.mockResolvedValue({
    backdateLimitDays: 7,
    canManage: true,
    project: null,
  });
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await screen.findByRole("button", { name: "common:actions.saved" });
  expect(input).toHaveValue("7");
  expect(client.getQueryData(["time-tracking", "settings", "w1", ""])).toEqual({
    backdateLimitDays: 7,
    canManage: true,
    project: null,
  });
});

it("does not seed a confirmed source value if the fresh session guard refuses", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  await screen.findByTestId("settings-history");
  mocks.assertSession.mockRejectedValueOnce(new Error("session changed"));
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await waitFor(() => expect(mocks.updateTimeSettings).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    ).toBeEnabled(),
  );
  expect(
    client.getQueryData(["time-tracking", "settings", "w1", ""]),
  ).toMatchObject({ backdateLimitDays: 30 });
  expect(input).toHaveValue("7");
  expect(
    screen.queryByRole("button", { name: "common:actions.saved" }),
  ).toBeNull();
  expect(mocks.success).not.toHaveBeenCalled();
});

it("does not let an in-flight old source GET overwrite the confirmed save", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  await screen.findByTestId("settings-history");
  let finishOld!: (value: {
    backdateLimitDays: number;
    canManage: boolean;
    project: null;
  }) => void;
  mocks.getTimeSettings
    .mockReset()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockRejectedValue(
      Object.assign(new Error("read failed"), { status: 403 }),
    );
  const oldRead = client.invalidateQueries({
    queryKey: ["time-tracking", "settings", "w1", ""],
    exact: true,
  });
  await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
  mocks.updateTimeSettings.mockResolvedValue({
    backdateLimitDays: 7,
    canManage: true,
    project: null,
  });
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await screen.findByRole("button", { name: "common:actions.saved" });
  finishOld({ backdateLimitDays: 30, canManage: true, project: null });
  await oldRead;
  expect(input).toHaveValue("7");
  expect(client.getQueryData(["time-tracking", "settings", "w1", ""])).toEqual({
    backdateLimitDays: 7,
    canManage: true,
    project: null,
  });
});

it("shows backdate settings read-only and never submits while impersonating", async () => {
  Object.assign(mocks.session.session, { impersonatedBy: "administrator" });
  const { container } = wrap(<BackdateLimitSetting />);
  expect(
    await screen.findByText("timeTracking:settings.backdateLimit: 30"),
  ).toBeVisible();
  expect(
    screen.queryByLabelText("timeTracking:settings.backdateLimit"),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "timeTracking:actions.save" }),
  ).toBeNull();
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  if (!form) throw new Error("Expected settings form");
  fireEvent.submit(form);
  expect(mocks.updateTimeSettings).not.toHaveBeenCalled();
});

it("shows project billable default read-only and never submits while impersonating", async () => {
  Object.assign(mocks.session.session, { impersonatedBy: "administrator" });
  wrap(<ProjectBillableSetting projectId="p1" />);
  const value = await screen.findByText("featureFlags:stateOn");
  expect(value).toBeVisible();
  fireEvent.click(value);
  fireEvent.keyDown(value, { key: "Enter" });
  expect(screen.queryByRole("switch")).toBeNull();
  expect(mocks.updateTimeSettings).not.toHaveBeenCalled();
});

it("keeps available-hours rows readable without an add form while impersonating", async () => {
  Object.assign(mocks.session.session, { impersonatedBy: "administrator" });
  wrap(<AvailableHoursSetting />);
  const row = await screen.findByTestId("available-hours-row");
  expect(row).toBeVisible();
  fireEvent.click(row);
  fireEvent.keyDown(row, { key: "Enter" });
  expect(
    screen.queryByLabelText("timeTracking:availableHours.hoursPerWeek"),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "timeTracking:availableHours.add" }),
  ).toBeNull();
  expect(
    screen.getByTestId("available-hours").querySelector("form"),
  ).toBeNull();
  expect(mocks.createAvailableHours).not.toHaveBeenCalled();
});

it("clears a staff draft when entering impersonation and restores controls on exit", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  fireEvent.change(input, { target: { value: "7" } });
  Object.assign(mocks.session.session, { impersonatedBy: "administrator" });
  view.rerender(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("timeTracking:settings.backdateLimit: 30"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "timeTracking:actions.save" }),
  ).toBeNull();
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Expected settings form");
  fireEvent.submit(form);
  expect(mocks.updateTimeSettings).not.toHaveBeenCalled();
  mocks.session = { user: { id: "user-1" }, session: { id: "session-1" } };
  view.rerender(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByLabelText("timeTracking:settings.backdateLimit"),
  ).toHaveValue("30");
  expect(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  ).toBeDisabled();
});

it("does not reconcile a staff save after switching into impersonation", async () => {
  let finish!: (value: unknown) => void;
  mocks.updateTimeSettings.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const setCache = vi.spyOn(client, "setQueryData");
  const view = render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  fireEvent.change(
    await screen.findByLabelText("timeTracking:settings.backdateLimit"),
    { target: { value: "7" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await waitFor(() =>
    expect(mocks.updateTimeSettings).toHaveBeenCalledTimes(1),
  );
  mocks.session = { user: { id: "user-2" }, session: { id: "session-2" } };
  Object.assign(mocks.session.session, { impersonatedBy: "administrator" });
  view.rerender(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("timeTracking:settings.backdateLimit: 30"),
  ).toBeVisible();
  finish({ backdateLimitDays: 7, canManage: true, project: null });
  await waitFor(() =>
    expect(client.getMutationCache().getAll()[0]?.state.status).toBe("success"),
  );
  expect(
    setCache.mock.calls.some(
      ([key]) =>
        JSON.stringify(key) ===
        JSON.stringify(["time-tracking", "settings", "w1", ""]),
    ),
  ).toBe(false);
  expect(
    screen.queryByRole("button", { name: "common:actions.saved" }),
  ).toBeNull();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.updateTimeSettings).toHaveBeenCalledTimes(1);
});

it.each(["workspace", "project"])(
  "keeps %s History and a retry when settings fail",
  async (scope) => {
    mocks.getTimeSettings.mockRejectedValue(new Error("network down"));
    wrap(
      scope === "workspace" ? (
        <BackdateLimitSetting />
      ) : (
        <ProjectBillableSetting projectId="p1" />
      ),
    );
    expect(await screen.findByTestId("settings-history")).toBeTruthy();
    const retry = await screen.findByRole("button", {
      name: "common:actions.retry",
    });
    mocks.getTimeSettings.mockResolvedValue({
      backdateLimitDays: 30,
      canManage: true,
      project: { id: "p1", defaultBillable: true },
    });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "common:actions.retry" }),
      ).toBeNull(),
    );
  },
);

it("shows the disabled state without History or Retry for project settings", async () => {
  const { TimeTrackingDisabledError } = await import(
    "@/fetchers/time-tracking"
  );
  mocks.getTimeSettings.mockRejectedValue(new TimeTrackingDisabledError());
  wrap(<ProjectBillableSetting projectId="p1" />);
  expect(
    await screen.findByText("timeTracking:timesheet.disabledTitle"),
  ).toBeVisible();
  expect(screen.queryByTestId("settings-history")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "common:actions.retry" }),
  ).toBeNull();
});
