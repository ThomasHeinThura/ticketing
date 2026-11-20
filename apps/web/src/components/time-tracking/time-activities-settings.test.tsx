import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settingsHistoryQueryKey } from "@/fetchers/settings/settings-history";
import { TimeActivitiesSettings } from "./time-activities-settings";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  getHistory: vi.fn(),
  getSession: vi.fn(),
  toastError: vi.fn(),
  canManage: true,
  workspaceId: "workspace-one",
  activities: [
    { id: "activity-one", name: "Support", archived: false },
    { id: "activity-two", name: "Review", archived: false },
  ],
  session: {
    user: { id: "user-one" },
    session: { id: "session-one" } as {
      id: string;
      impersonatedBy?: string | null;
      portal?: string | null;
    },
  } as {
    user: { id: string };
    session: {
      id: string;
      impersonatedBy?: string | null;
      portal?: string | null;
    };
  } | null,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: mocks.workspaceId }, isLoading: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canLogTime: () => true,
    canManageWorkspaceSettings: () => mocks.canManage,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/time-tracking/use-time-tracking", () => ({
  useTimeActivities: () => ({
    data: mocks.activities,
    isLoading: false,
    isError: false,
  }),
  timeKeys: { all: ["time"] },
}));
vi.mock("@/fetchers/time-tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/fetchers/time-tracking")>()),
  updateTimeActivity: mocks.update,
  createTimeActivity: mocks.create,
}));
vi.mock("@/fetchers/settings/settings-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/settings/settings-history")
  >()),
  getSettingsHistory: mocks.getHistory,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: mocks.session }),
    getSession: (...args: unknown[]) => mocks.getSession(...args),
  },
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("./time-settings", () => ({
  AvailableHoursSetting: () => null,
  BackdateLimitSetting: () => null,
}));
const defaultSession = () => ({
  user: { id: "user-one" },
  session: { id: "session-one" },
});
const defaultActivities = () => [
  { id: "activity-one", name: "Support", archived: false },
];
beforeEach(() => {
  mocks.session = defaultSession();
  mocks.workspaceId = "workspace-one";
  mocks.canManage = true;
  mocks.activities = defaultActivities();
  mocks.getSession.mockImplementation(async () => ({
    data: mocks.session,
    error: null,
  }));
  mocks.getHistory.mockImplementation(async (type: string, id: string) => ({
    entityType: type,
    entityId: id,
    lastChanged: null,
    rows: [],
  }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("time activity saves", () => {
  it("withdraws the done state when the name is edited again", async () => {
    mocks.update.mockResolvedValueOnce({});
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimeActivitiesSettings />
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText("timeTracking:activities.nameLabel");
    fireEvent.change(input, { target: { value: "Support work" } });
    fireEvent.click(
      screen.getByRole("button", { name: "timeTracking:actions.save" }),
    );
    await screen.findByText("common:actions.saved", {
      selector: '[role="status"]',
    });
    fireEvent.change(input, { target: { value: "Support work again" } });
    await waitFor(() =>
      expect(
        screen.queryByText("common:actions.saved", {
          selector: '[role="status"]',
        }),
      ).toBeNull(),
    );
  });
  it("locks rename while archiving and allows it afterward without a double submit", async () => {
    let resolveArchive: (value: unknown) => void = () => {};
    let resolveRename: (value: unknown) => void = () => {};
    mocks.update
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveArchive = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRename = resolve;
          }),
      );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TimeActivitiesSettings />
      </QueryClientProvider>,
    );
    fireEvent.change(
      screen.getByLabelText("timeTracking:activities.nameLabel"),
      { target: { value: "Support work" } },
    );
    const rename = screen.getByRole("button", {
      name: "timeTracking:actions.save",
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "timeTracking:activities.active" }),
    );
    await waitFor(() => expect(rename).toBeDisabled());
    fireEvent.click(rename);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenNthCalledWith(
      1,
      "activity-one",
      "workspace-one",
      { archived: true },
    );
    await act(async () => resolveArchive({}));
    await waitFor(() => expect(rename).toBeEnabled());
    fireEvent.click(rename);
    await waitFor(() => expect(rename).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(rename);
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenNthCalledWith(
      2,
      "activity-one",
      "workspace-one",
      { name: "Support work" },
    );
    await act(async () => resolveRename({}));
  });
});

const historyKey = (id: string, user = "user-one", session = "session-one") =>
  settingsHistoryQueryKey("time_activity", id, user, session);
const emptyHistory = (id: string) => ({
  entityType: "time_activity",
  entityId: id,
  lastChanged: null,
  rows: [],
});

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <TimeActivitiesSettings />
    </QueryClientProvider>,
  );
  const seed = () => {
    for (const key of [
      historyKey("activity-one"),
      historyKey("activity-two"),
      historyKey("activity-one", "user-one", "session-old"),
      historyKey("activity-one", "user-other", "session-one"),
    ])
      client.setQueryData(key, emptyHistory("seed"));
  };
  const invalidated = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated === true;
  return { client, seed, invalidated, ...view };
}

/** An active reader of one row's History key, as an open History view would be. */
async function observeHistory(client: QueryClient, id: string) {
  const observer = new QueryObserver(client, {
    queryKey: historyKey(id),
    queryFn: () => mocks.getHistory("time_activity", id),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const stop = observer.subscribe(() => {});
  await waitFor(() => expect(mocks.getHistory).toHaveBeenCalledOnce());
  return stop;
}

const rename = (value: string) => {
  fireEvent.change(
    screen.getAllByLabelText("timeTracking:activities.nameLabel")[0] as Element,
    { target: { value } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
};

describe("time activity History (HIST-FULL P1)", () => {
  beforeEach(() => {
    mocks.activities = [
      { id: "activity-one", name: "Support", archived: false },
      { id: "activity-two", name: "Review", archived: false },
    ];
  });

  it("offers a History affordance on every persisted row, also to a viewer who cannot manage", () => {
    mocks.canManage = false;
    renderScreen();
    expect(
      screen.getAllByRole("button", { name: /settings:history\.title/ }),
    ).toHaveLength(2);
  });

  it("opens that row's History and reads exactly its persisted id", async () => {
    renderScreen();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[1] as Element,
    );
    await screen.findByText("settings:history.empty");
    expect(mocks.getHistory).toHaveBeenCalledOnce();
    expect(mocks.getHistory).toHaveBeenCalledWith(
      "time_activity",
      "activity-two",
      expect.any(AbortSignal),
    );
  });

  it.each([
    ["no session", () => null],
    [
      "an impersonated session",
      () => ({
        user: { id: "user-one" },
        session: { id: "session-one", impersonatedBy: "admin-1" },
      }),
    ],
    [
      "a portal session",
      () => ({
        user: { id: "user-one" },
        session: { id: "session-one", portal: "customer" },
      }),
    ],
  ])(
    "shows no History affordance and sends no read for %s",
    (_name, session) => {
      mocks.session = session();
      renderScreen();
      expect(
        screen.queryByRole("button", { name: /settings:history\.title/ }),
      ).toBeNull();
      expect(mocks.getHistory).not.toHaveBeenCalled();
    },
  );

  it("shows an alert and a working Retry when the History read is denied", async () => {
    const { HttpError } = await import("@/lib/http-error");
    mocks.getHistory.mockRejectedValueOnce(new HttpError(403, "denied"));
    renderScreen();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[0] as Element,
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "settings:history.retry" }),
    );
    await screen.findByText("settings:history.empty");
    expect(mocks.getHistory).toHaveBeenCalledTimes(2);
  });

  it("closes the History of a row once the session rotates or the workspace changes", async () => {
    const { rerender, client } = renderScreen();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[0] as Element,
    );
    await screen.findByText("settings:history.empty");
    mocks.session = {
      user: { id: "user-one" },
      session: { id: "session-two" },
    };
    rerender(
      <QueryClientProvider client={client}>
        <TimeActivitiesSettings />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.getHistory).toHaveBeenCalledOnce();
  });

  it("closes an open History when its row is no longer listed (workspace switch)", async () => {
    const { rerender, client } = renderScreen();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[0] as Element,
    );
    await screen.findByText("settings:history.empty");
    mocks.workspaceId = "workspace-two";
    mocks.activities = [
      { id: "activity-other", name: "Other", archived: false },
    ];
    rerender(
      <QueryClientProvider client={client}>
        <TimeActivitiesSettings />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.getHistory).toHaveBeenCalledOnce();
  });

  it("does not reopen a closed History when the workspace returns (W1 -> W2 -> W1)", async () => {
    const { rerender, client } = renderScreen();
    const again = () =>
      rerender(
        <QueryClientProvider client={client}>
          <TimeActivitiesSettings />
        </QueryClientProvider>,
      );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[0] as Element,
    );
    await screen.findByText("settings:history.empty");
    const first = mocks.activities;
    mocks.workspaceId = "workspace-two";
    mocks.activities = [
      { id: "activity-other", name: "Other", archived: false },
    ];
    again();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    mocks.workspaceId = "workspace-one";
    mocks.activities = first;
    again();
    await screen.findAllByRole("button", { name: /settings:history\.title/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.getHistory).toHaveBeenCalledOnce();
  });

  it("does not reopen a closed History when its row disappears and is restored", async () => {
    const { rerender, client } = renderScreen();
    const again = () =>
      rerender(
        <QueryClientProvider client={client}>
          <TimeActivitiesSettings />
        </QueryClientProvider>,
      );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[0] as Element,
    );
    await screen.findByText("settings:history.empty");
    const both = mocks.activities;
    mocks.activities = [both[1] as (typeof both)[number]];
    again();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    mocks.activities = both;
    again();
    await screen.findAllByRole("button", { name: /settings:history\.title/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.getHistory).toHaveBeenCalledOnce();
  });

  it("does not reopen a closed History after a session round trip (s1 -> s2 -> s1)", async () => {
    const { rerender, client } = renderScreen();
    const again = () =>
      rerender(
        <QueryClientProvider client={client}>
          <TimeActivitiesSettings />
        </QueryClientProvider>,
      );
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /settings:history\.title/,
      })[0] as Element,
    );
    await screen.findByText("settings:history.empty");
    mocks.session = {
      user: { id: "user-one" },
      session: { id: "session-two" },
    };
    again();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    mocks.session = defaultSession();
    again();
    await screen.findAllByRole("button", { name: /settings:history\.title/ });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.getHistory).toHaveBeenCalledOnce();
  });
});

describe("time activity writes refresh only their own captured History key", () => {
  beforeEach(() => {
    mocks.activities = [
      { id: "activity-one", name: "Support", archived: false },
      { id: "activity-two", name: "Review", archived: false },
    ];
  });

  it("rename: marks exactly the saved row's key for this user and session", async () => {
    mocks.update.mockResolvedValueOnce({
      id: "activity-one",
      name: "Support work",
      archived: false,
    });
    const { seed, invalidated } = renderScreen();
    seed();
    rename("Support work");
    await waitFor(() =>
      expect(invalidated(historyKey("activity-one"))).toBe(true),
    );
    expect(invalidated(historyKey("activity-two"))).toBe(false);
    expect(
      invalidated(historyKey("activity-one", "user-one", "session-old")),
    ).toBe(false);
    expect(
      invalidated(historyKey("activity-one", "user-other", "session-one")),
    ).toBe(false);
  });

  it("archive: marks exactly the archived row's key", async () => {
    mocks.update.mockResolvedValueOnce({
      id: "activity-two",
      name: "Review",
      archived: true,
    });
    const { seed, invalidated } = renderScreen();
    seed();
    fireEvent.click(
      screen.getAllByRole("switch", {
        name: "timeTracking:activities.active",
      })[1] as Element,
    );
    await waitFor(() =>
      expect(invalidated(historyKey("activity-two"))).toBe(true),
    );
    expect(invalidated(historyKey("activity-one"))).toBe(false);
    expect(mocks.update).toHaveBeenCalledWith("activity-two", "workspace-one", {
      archived: true,
    });
  });

  it("create: refreshes the key of the persisted response id, never an invented one", async () => {
    mocks.create.mockResolvedValueOnce({
      id: "activity-new",
      name: "Planning",
      archived: false,
    });
    const { client, seed, invalidated } = renderScreen();
    seed();
    client.setQueryData(historyKey("activity-new"), emptyHistory("seed"));
    fireEvent.change(
      screen.getByLabelText("timeTracking:activities.newLabel"),
      {
        target: { value: "Planning" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /timeTracking:activities\.add/ }),
    );
    await waitFor(() =>
      expect(invalidated(historyKey("activity-new"))).toBe(true),
    );
    expect(invalidated(historyKey("activity-one"))).toBe(false);
    expect(invalidated(historyKey("activity-two"))).toBe(false);
  });

  it("a failed write changes no History key and reports the error", async () => {
    mocks.update.mockRejectedValueOnce(new Error("save refused"));
    const { seed, invalidated } = renderScreen();
    seed();
    rename("Support work");
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(invalidated(historyKey("activity-one"))).toBe(false);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("an unchanged name is neither written nor refreshed", () => {
    const { seed, invalidated } = renderScreen();
    seed();
    fireEvent.change(
      screen.getAllByLabelText(
        "timeTracking:activities.nameLabel",
      )[0] as Element,
      { target: { value: "  Support  " } },
    );
    expect(
      screen.queryByRole("button", { name: "timeTracking:actions.save" }),
    ).toBeNull();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(invalidated(historyKey("activity-one"))).toBe(false);
  });

  it("does not hold the saved feedback for a slow session check, and refetches only after it passes", async () => {
    let finishCheck: (value: unknown) => void = () => {};
    mocks.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    mocks.update.mockResolvedValueOnce({
      id: "activity-one",
      name: "Support work",
      archived: false,
    });
    const { client } = renderScreen();
    const stop = await observeHistory(client, "activity-one");
    rename("Support work");
    await screen.findByText("common:actions.saved", {
      selector: '[role="status"]',
    });
    expect(mocks.getHistory).toHaveBeenCalledOnce();
    await act(async () => finishCheck({ data: mocks.session, error: null }));
    await waitFor(() => expect(mocks.getHistory).toHaveBeenCalledTimes(2));
    stop();
  });

  it("does not refetch History when the session rotated between the write and its refresh", async () => {
    mocks.getSession.mockImplementation(async () => ({
      data: { user: { id: "user-one" }, session: { id: "session-rotated" } },
      error: null,
    }));
    mocks.update.mockResolvedValueOnce({
      id: "activity-one",
      name: "Support work",
      archived: false,
    });
    const { client, invalidated } = renderScreen();
    const stop = await observeHistory(client, "activity-one");
    rename("Support work");
    await waitFor(() =>
      expect(invalidated(historyKey("activity-one"))).toBe(true),
    );
    await waitFor(() => expect(mocks.getSession).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.getHistory).toHaveBeenCalledOnce();
    stop();
  });

  it("refreshes the user and session captured when the write started, not the current ones", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { client, seed, invalidated } = renderScreen();
    seed();
    client.setQueryData(
      historyKey("activity-one", "user-one", "session-two"),
      emptyHistory("seed"),
    );
    rename("Support work");
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    mocks.session = {
      user: { id: "user-one" },
      session: { id: "session-two" },
    };
    await act(async () =>
      finish({ id: "activity-one", name: "Support work", archived: false }),
    );
    await waitFor(() =>
      expect(invalidated(historyKey("activity-one"))).toBe(true),
    );
    expect(
      invalidated(historyKey("activity-one", "user-one", "session-two")),
    ).toBe(false);
  });
});
