import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
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
  refresh: vi.fn(),
  assertSession: vi.fn(),
  workspaceId: "w1",
  session: { user: { id: "user-1" }, session: { id: "session-1" } },
  workspaceAllowed: true,
  projectAllowed: true,
  capabilities: vi.fn(),
  audit: vi.fn(),
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
        if (key === "audit") return { $get: mocks.audit };
        return Reflect.get(target, key);
      },
    }),
  };
});
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session }) },
}));
vi.mock("@/components/settings/refresh-settings-history", () => ({
  refreshSettingsHistory: mocks.refresh,
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({
    type,
    id,
    userId,
  }: {
    type: string;
    id: string;
    userId: string;
  }) => {
    const client = useQueryClient();
    const cached = client.getQueryData([
      "settings-history",
      type,
      id,
      "agent",
      userId,
      mocks.session.session.id,
    ]);
    return (
      <div
        data-testid="settings-history"
        data-type={type}
        data-id={id}
        data-user={userId}
      >
        {JSON.stringify(cached)}
      </div>
    );
  },
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

function auditResponse(type: string, id: string) {
  return new Response(
    JSON.stringify({
      entityType: type,
      entityId: id,
      lastChanged: null,
      rows: [],
    }),
    { status: 200 },
  );
}

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
  mocks.audit
    .mockReset()
    .mockImplementation(
      async ({
        query,
      }: {
        query: { entity_type: string; entity_id: string };
      }) =>
        (
          query.entity_type === "project"
            ? mocks.projectAllowed
            : mocks.workspaceAllowed
        )
          ? auditResponse(query.entity_type, query.entity_id)
          : new Response("", { status: 403 }),
    );
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

it("gates workspace and project History independently from time-setting write admission", async () => {
  mocks.workspaceAllowed = true;
  mocks.projectAllowed = false;
  const view = wrap(
    <>
      <BackdateLimitSetting />
      <ProjectBillableSetting projectId="p1" />
    </>,
  );
  await screen.findByRole("switch");
  await waitFor(() =>
    expect(screen.getAllByTestId("settings-history")).toHaveLength(1),
  );
  expect(screen.getByTestId("settings-history")).toHaveAttribute(
    "data-type",
    "workspace",
  );
  mocks.workspaceAllowed = false;
  mocks.projectAllowed = true;
  view.unmount();
  wrap(
    <>
      <BackdateLimitSetting />
      <ProjectBillableSetting projectId="p1" />
    </>,
  );
  await waitFor(() =>
    expect(screen.getByTestId("settings-history")).toHaveAttribute(
      "data-type",
      "project",
    ),
  );
  expect(screen.getByTestId("settings-history")).toHaveAttribute(
    "data-id",
    "p1",
  );
  expect(mocks.audit).toHaveBeenCalledWith(
    { query: { entity_type: "workspace", entity_id: "w1" } },
    expect.anything(),
  );
  expect(mocks.audit).toHaveBeenCalledWith(
    { query: { entity_type: "project", entity_id: "p1" } },
    expect.anything(),
  );
});

it("waits for the exact audit admission and hides History after refusal", async () => {
  let finish!: (value: Response) => void;
  mocks.audit.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("timeTracking:settings.backdateLimit");
  await waitFor(() => expect(mocks.audit).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-history")).toBeNull();
  finish(auditResponse("workspace", "w1"));
  await screen.findByTestId("settings-history");
  mocks.audit.mockResolvedValueOnce(new Response("", { status: 403 }));
  await client.invalidateQueries({
    queryKey: ["time-settings-history-admission"],
  });
  await waitFor(() =>
    expect(screen.queryByTestId("settings-history")).toBeNull(),
  );
});

it("never uses workspace write permission as project History permission", async () => {
  mocks.projectAllowed = false;
  mocks.getTimeSettings.mockResolvedValue({
    backdateLimitDays: 30,
    canManage: true,
    project: { id: "p1", defaultBillable: true },
  });
  wrap(<ProjectBillableSetting projectId="p1" />);
  expect(await screen.findByRole("switch")).toBeEnabled();
  await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("allows independently authorized project History on a read-only time setting", async () => {
  mocks.getTimeSettings.mockResolvedValue({
    backdateLimitDays: 30,
    canManage: false,
    project: { id: "p1", defaultBillable: true },
  });
  wrap(<ProjectBillableSetting projectId="p1" />);
  expect(
    await screen.findByText("timeTracking:settings.defaultBillable"),
  ).toBeTruthy();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(await screen.findByTestId("settings-history")).toHaveAttribute(
    "data-type",
    "project",
  );
});

it("hides History when the time-settings source is refused", async () => {
  mocks.getTimeSettings.mockRejectedValue(new Error("denied"));
  wrap(<BackdateLimitSetting />);
  await waitFor(() => expect(mocks.getTimeSettings).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("refreshes the exact workspace History after a save without waiting for it", async () => {
  mocks.refresh.mockImplementation(() => new Promise(() => {}));
  wrap(<BackdateLimitSetting />);
  const input = await screen.findByLabelText(
    "timeTracking:settings.backdateLimit",
  );
  fireEvent.change(input, { target: { value: "7" } });
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "workspace", "w1", "agent", "user-1", "session-1"],
      expect.any(Function),
    ),
  );
  expect(mocks.success).toHaveBeenCalledWith("timeTracking:settings.saved");
  await mocks.refresh.mock.calls[0][2]();
  expect(mocks.assertSession).toHaveBeenCalledWith("user-1", "session-1");
});

it("never refreshes History after a refused project write", async () => {
  mocks.updateTimeSettings.mockRejectedValue(new Error("refused"));
  wrap(<ProjectBillableSetting projectId="p1" />);
  fireEvent.click(await screen.findByRole("switch"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("invalidates only the captured project key after scope and session switch", async () => {
  let finish!: (value: unknown) => void;
  mocks.updateTimeSettings.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("switch"));
  await waitFor(() => expect(mocks.updateTimeSettings).toHaveBeenCalled());
  mocks.workspaceId = "w2";
  mocks.session = { user: { id: "user-2" }, session: { id: "session-2" } };
  mocks.getTimeSettings.mockResolvedValue({
    backdateLimitDays: 9,
    canManage: true,
    project: { id: "p2", defaultBillable: true },
  });
  view.rerender(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p2" />
    </QueryClientProvider>,
  );
  finish({});
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "project", "p1", "agent", "user-1", "session-1"],
      expect.any(Function),
    ),
  );
  expect(mocks.success).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
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
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "workspace", "w1", "agent", "user-1", "session-1"],
      expect.any(Function),
    ),
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

it("refreshes only the captured project History on a successful save", async () => {
  mocks.refresh.mockImplementation(() => new Promise(() => {}));
  wrap(<ProjectBillableSetting projectId="p1" />);
  fireEvent.click(await screen.findByRole("switch"));
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "project", "p1", "agent", "user-1", "session-1"],
      expect.any(Function),
    ),
  );
  expect(mocks.success).toHaveBeenCalledWith("timeTracking:settings.saved");
});

it("does not show History in an impersonated or portal session", async () => {
  Object.assign(mocks.session.session, { impersonatedBy: "administrator" });
  const view = wrap(<BackdateLimitSetting />);
  await screen.findByText("timeTracking:settings.backdateLimit: 30");
  expect(screen.queryByTestId("settings-history")).toBeNull();
  mocks.session = {
    user: { id: "customer" },
    session: { id: "customer-session" },
  };
  Object.assign(mocks.session.session, { portal: "customer" });
  view.rerender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <BackdateLimitSetting />
    </QueryClientProvider>,
  );
  await screen.findByLabelText("timeTracking:settings.backdateLimit");
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("does not let a previous session's delayed audit allow authorize the new session", async () => {
  let finishOld!: (response: Response) => void;
  mocks.audit
    .mockReset()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    )
    .mockResolvedValue(new Response("", { status: 403 }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));
  mocks.session = { user: { id: "user-2" }, session: { id: "session-2" } };
  view.rerender(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(2));
  finishOld(auditResponse("project", "p1"));
  await waitFor(() =>
    expect(mocks.assertSession).toHaveBeenCalledWith("user-2", "session-2"),
  );
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("keeps controls usable and hides History when exact audit read is refused", async () => {
  mocks.audit.mockResolvedValue(new Response("", { status: 403 }));
  wrap(<ProjectBillableSetting projectId="p1" />);
  expect(await screen.findByRole("switch")).toBeEnabled();
  await waitFor(() => expect(mocks.audit).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("shows History when the new session is allowed despite an old pending audit denial", async () => {
  let denyOld!: (value: Response) => void;
  mocks.audit
    .mockReset()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        denyOld = resolve;
      }),
    )
    .mockResolvedValue(auditResponse("project", "p1"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));
  expect(screen.queryByTestId("settings-history")).toBeNull();
  mocks.session = { user: { id: "user-2" }, session: { id: "session-2" } };
  view.rerender(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId("settings-history")).toHaveAttribute(
    "data-user",
    "user-2",
  );
  denyOld(new Response("", { status: 403 }));
  await waitFor(() =>
    expect(screen.getByTestId("settings-history")).toHaveAttribute(
      "data-user",
      "user-2",
    ),
  );
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
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
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

it("clears only the refused target's cached History on a current admission denial", async () => {
  mocks.audit.mockResolvedValue(new Response("", { status: 403 }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const target = [
    "settings-history",
    "project",
    "p1",
    "agent",
    "user-1",
    "session-1",
  ];
  const other = [
    "settings-history",
    "project",
    "other",
    "agent",
    "user-1",
    "session-1",
  ];
  client.setQueryData(target, { private: "target" });
  client.setQueryData(other, { private: "other" });
  render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.getQueryData(target)).toBeNull());
  expect(client.getQueryData(other)).toEqual({ private: "other" });
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("does not clear newer History when a cancelled exact audit read later denies", async () => {
  let denyOld!: (response: Response) => void;
  mocks.audit
    .mockReset()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        denyOld = resolve;
      }),
    )
    .mockResolvedValue(auditResponse("project", "p1"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = [
    "settings-history",
    "project",
    "p1",
    "agent",
    "user-1",
    "session-1",
  ];
  render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));
  await client.cancelQueries({ queryKey: ["time-settings-history-admission"] });
  await client.invalidateQueries({
    queryKey: ["time-settings-history-admission"],
  });
  await screen.findByTestId("settings-history");
  client.setQueryData(key, { latest: true });
  denyOld(new Response("", { status: 403 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.getQueryData(key)).toEqual({ latest: true });
});

it.each(["direct", "inherited"])(
  "allows %s project access when the exact audit GET allows it despite a false workspace flag",
  async (_grant) => {
    mocks.projectAllowed = false;
    mocks.audit.mockImplementation(async () => auditResponse("project", "p1"));
    wrap(<ProjectBillableSetting projectId="p1" />);
    expect(await screen.findByTestId("settings-history")).toHaveAttribute(
      "data-id",
      "p1",
    );
    expect(mocks.capabilities).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      { query: { entity_type: "project", entity_id: "p1" } },
      expect.anything(),
    );
  },
);

it("hides and clears cached project rows on remount while a fresh exact audit read is pending then denied", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = [
    "settings-history",
    "project",
    "p1",
    "agent",
    "user-1",
    "session-1",
  ];
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await screen.findByTestId("settings-history");
  expect(client.getQueryData(key)).toMatchObject({
    entityType: "project",
    entityId: "p1",
  });
  view.unmount();
  client.setQueryData(key, {
    lastChanged: { actor: { name: "cached-private" } },
    rows: [],
  });
  let deny!: (response: Response) => void;
  mocks.audit.mockReturnValueOnce(
    new Promise((resolve) => {
      deny = resolve;
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("settings-history")).toBeNull();
  expect(screen.queryByText(/cached-private/)).toBeNull();
  deny(new Response("", { status: 403 }));
  await waitFor(() => expect(client.getQueryData(key)).toBeNull());
  expect(screen.queryByTestId("settings-history")).toBeNull();
});

it("uses exact project denial even if the workspace capability flag is true", async () => {
  mocks.projectAllowed = true;
  mocks.audit.mockResolvedValue(new Response("", { status: 403 }));
  wrap(<ProjectBillableSetting projectId="p1" />);
  await waitFor(() => expect(mocks.audit).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-history")).toBeNull();
  expect(mocks.capabilities).not.toHaveBeenCalled();
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
  await waitFor(() => expect(mocks.audit).toHaveBeenCalled());
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

it("does not replace a newer audit result when an aborted old allow arrives", async () => {
  let allowOld!: (response: Response) => void;
  const response = (name: string) =>
    new Response(
      JSON.stringify({
        entityType: "project",
        entityId: "p1",
        lastChanged: null,
        rows: [{ actor: { name } }],
      }),
      { status: 200 },
    );
  mocks.audit
    .mockReset()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        allowOld = resolve;
      }),
    )
    .mockResolvedValue(response("fresh"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const key = [
    "settings-history",
    "project",
    "p1",
    "agent",
    "user-1",
    "session-1",
  ];
  render(
    <QueryClientProvider client={client}>
      <ProjectBillableSetting projectId="p1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.audit).toHaveBeenCalledTimes(1));
  await client.cancelQueries({ queryKey: ["time-settings-history-admission"] });
  await client.invalidateQueries({
    queryKey: ["time-settings-history-admission"],
  });
  await screen.findByTestId("settings-history");
  allowOld(response("stale"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(JSON.stringify(client.getQueryData(key))).toContain("fresh");
  expect(JSON.stringify(client.getQueryData(key))).not.toContain("stale");
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

it("keeps History hidden when the current source GET denies despite audit access", async () => {
  mocks.getTimeSettings
    .mockResolvedValueOnce({
      backdateLimitDays: 30,
      canManage: true,
      project: { id: "p1", defaultBillable: true },
    })
    .mockRejectedValue(
      Object.assign(new Error("source denied"), { status: 403 }),
    );
  wrap(<ProjectBillableSetting projectId="p1" />);
  expect(await screen.findByRole("switch")).toBeEnabled();
  await waitFor(() => expect(mocks.audit).toHaveBeenCalled());
  expect(screen.queryByTestId("settings-history")).toBeNull();
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
  expect(screen.queryByTestId("settings-history")).toBeNull();
  expect(mocks.audit).not.toHaveBeenCalled();
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
  expect(screen.queryByTestId("settings-history")).toBeNull();
  expect(mocks.audit).not.toHaveBeenCalled();
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
