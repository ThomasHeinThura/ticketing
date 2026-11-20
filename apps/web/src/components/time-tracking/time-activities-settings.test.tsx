import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeActivitiesSettings } from "./time-activities-settings";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  create: vi.fn(),
  toastError: vi.fn(),
  canManage: true,
  workspaceId: "workspace-one",
  activities: [
    { id: "activity-one", name: "Support", archived: false },
    { id: "activity-two", name: "Review", archived: false },
  ],
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
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({ target }: { target: unknown }) => (
    <div data-testid="history" data-target={JSON.stringify(target)} />
  ),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("./time-settings", () => ({
  AvailableHoursSetting: () => null,
  BackdateLimitSetting: () => null,
}));
const defaultActivities = () => [
  { id: "activity-one", name: "Support", archived: false },
];
beforeEach(() => {
  mocks.workspaceId = "workspace-one";
  mocks.canManage = true;
  mocks.activities = defaultActivities();
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

const activityTarget = (id: string, workspaceId = "workspace-one") => ({
  kind: "entity",
  type: "time_activity",
  id,
  scope: { kind: "workspace", workspaceId },
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
  return { client, ...view };
}

const openHistory = (index: number) =>
  fireEvent.click(
    screen.getAllByRole("button", {
      name: /settings:history\.title/,
    })[index] as Element,
  );

const rename = (value: string) => {
  fireEvent.change(
    screen.getAllByLabelText("timeTracking:activities.nameLabel")[0] as Element,
    { target: { value } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "timeTracking:actions.save" }),
  );
};

/** The History targets the last confirmed write declared through its mutation meta. */
const declaredTargets = (client: QueryClient) => {
  const mutation = client.getMutationCache().getAll().at(-1);
  return mutation?.meta?.audits?.targets(
    mutation.state.variables as never,
    mutation.state.data as never,
  );
};

describe("time activity History", () => {
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

  it("opens that row's History for exactly its persisted id and workspace", async () => {
    renderScreen();
    openHistory(1);
    expect(
      JSON.parse((await screen.findByTestId("history")).dataset.target ?? ""),
    ).toEqual(activityTarget("activity-two"));
  });

  it("closes an open History when its row is no longer listed (workspace switch)", async () => {
    const { rerender, client } = renderScreen();
    openHistory(0);
    await screen.findByTestId("history");
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
  });

  it("does not reopen a closed History when the workspace returns (W1 -> W2 -> W1)", async () => {
    const { rerender, client } = renderScreen();
    const again = () =>
      rerender(
        <QueryClientProvider client={client}>
          <TimeActivitiesSettings />
        </QueryClientProvider>,
      );
    openHistory(0);
    await screen.findByTestId("history");
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
  });

  it("does not reopen a closed History when its row disappears and is restored", async () => {
    const { rerender, client } = renderScreen();
    const again = () =>
      rerender(
        <QueryClientProvider client={client}>
          <TimeActivitiesSettings />
        </QueryClientProvider>,
      );
    openHistory(0);
    await screen.findByTestId("history");
    const both = mocks.activities;
    mocks.activities = [both[1] as (typeof both)[number]];
    again();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    mocks.activities = both;
    again();
    await screen.findAllByRole("button", { name: /settings:history\.title/ });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("time activity writes declare the History they change", () => {
  beforeEach(() => {
    mocks.activities = [
      { id: "activity-one", name: "Support", archived: false },
      { id: "activity-two", name: "Review", archived: false },
    ];
  });

  it("rename: declares the saved row", async () => {
    mocks.update.mockResolvedValueOnce({
      id: "activity-one",
      name: "Support work",
      archived: false,
    });
    const { client } = renderScreen();
    rename("Support work");
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(declaredTargets(client)).toEqual([activityTarget("activity-one")]),
    );
  });

  it("archive: declares the archived row", async () => {
    mocks.update.mockResolvedValueOnce({
      id: "activity-two",
      name: "Review",
      archived: true,
    });
    const { client } = renderScreen();
    fireEvent.click(
      screen.getAllByRole("switch", {
        name: "timeTracking:activities.active",
      })[1] as Element,
    );
    await waitFor(() =>
      expect(declaredTargets(client)).toEqual([activityTarget("activity-two")]),
    );
    expect(mocks.update).toHaveBeenCalledWith("activity-two", "workspace-one", {
      archived: true,
    });
  });

  it("create: declares the persisted response id, never an invented one", async () => {
    mocks.create.mockResolvedValueOnce({
      id: "activity-new",
      name: "Planning",
      archived: false,
    });
    const { client } = renderScreen();
    fireEvent.change(
      screen.getByLabelText("timeTracking:activities.newLabel"),
      { target: { value: "Planning" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: /timeTracking:activities\.add/ }),
    );
    await waitFor(() =>
      expect(declaredTargets(client)).toEqual([activityTarget("activity-new")]),
    );
  });

  it("an unchanged name is not written", () => {
    renderScreen();
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
  });
});
