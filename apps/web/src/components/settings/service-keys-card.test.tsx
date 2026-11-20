import {
  onlineManager,
  QueryCache,
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
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  history: vi.fn(),
  refresh: vi.fn(),
  guard: vi.fn(),
  workspaceId: "ws-1",
  session: { user: { id: "u1" }, session: { id: "s1" } },
  revoke: vi.fn(),
  reattest: vi.fn(),
  requestDeletion: vi.fn(),
  navigate: vi.fn(),
  stepRun: vi.fn(),
  canManageApiKeys: vi.fn(() => true),
  isCheckingPermissions: { value: false },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session }) },
}));
vi.mock("@/fetchers/settings/personal-history", () => ({
  assertNotificationHistorySession: (...args: unknown[]) =>
    mocks.guard(...args),
}));
vi.mock("@/components/settings/refresh-settings-history", () => ({
  refreshSettingsHistory: mocks.refresh,
}));
vi.mock("@/fetchers/settings/settings-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/settings/settings-history")
  >()),
  getSettingsHistory: (...args: unknown[]) => mocks.history(...args),
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
  }) => (
    <div
      data-testid="key-history"
      data-type={type}
      data-id={id}
      data-user={userId}
    />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: mocks.workspaceId } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageApiKeys: () => mocks.canManageApiKeys(),
    isCheckingPermissions: mocks.isCheckingPermissions.value,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/fetchers/service-keys", () => ({
  listServiceKeys: (...args: unknown[]) => mocks.list(...args),
  revokeServiceKey: (...args: unknown[]) => mocks.revoke(...args),
  reattestServiceKey: (...args: unknown[]) => mocks.reattest(...args),
  requestServiceKeyDeletion: (...args: unknown[]) =>
    mocks.requestDeletion(...args),
}));
vi.mock("@/hooks/use-step-up-action", () => ({
  useStepUpAction: () => ({
    run: (...args: unknown[]) => mocks.stepRun(...args),
    clearFailure: vi.fn(),
    busy: false,
    canRun: true,
    failure: null,
    method: "password",
    setMethod: vi.fn(),
    secret: "verification secret",
    setSecret: vi.fn(),
    availableMethods: ["password"],
  }),
}));
vi.mock("@/components/settings/create-service-key-dialog", () => ({
  CreateServiceKeyDialog: () => null,
  serviceKeysKey: (id: string) => ["service-keys", id],
}));

import { ServiceKeysCard } from "./service-keys-card";

const key = (over: Record<string, unknown> = {}) => ({
  id: "k1",
  name: "Pipeline",
  kind: "service",
  prefix: "tdk_",
  start: "tdk_abcdefgh",
  enabled: true,
  isMcp: false,
  capabilities: ["workspace:read"],
  writesEnabled: false,
  ipAllowlist: null,
  rateLimitPerMinute: null,
  expiresAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  lastUsedAt: null,
  lastUsedIp: null,
  disabledAt: null,
  disabledReason: null,
  workspaceId: "ws-1",
  createdByFormerMember: false,
  ownedByWorkspaceAdmins: false,
  requiresReattestation: false,
  accountabilityVersion: 1,
  ...over,
});

function renderCard(
  onQueryError?: (error: unknown) => void,
  existingClient?: QueryClient,
) {
  const client =
    existingClient ??
    new QueryClient({
      queryCache: new QueryCache({ onError: onQueryError }),
      defaultOptions: { queries: { retry: false } },
    });
  const view = render(
    <QueryClientProvider client={client}>
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
  mocks.workspaceId = "ws-1";
  mocks.session = { user: { id: "u1" }, session: { id: "s1" } };
  mocks.guard.mockReset().mockResolvedValue(undefined);
  mocks.refresh.mockReset();
  mocks.history
    .mockReset()
    .mockImplementation(async (_type: string, id: string) => ({
      entityType: "service_api_key",
      entityId: id,
      lastChanged: null,
      rows: [],
    }));
  mocks.list.mockReset();
  mocks.revoke.mockReset().mockResolvedValue(key({ enabled: false }));
  mocks.reattest.mockReset().mockResolvedValue(
    key({
      ownedByWorkspaceAdmins: true,
      requiresReattestation: false,
      accountabilityVersion: 2,
    }),
  );
  mocks.stepRun
    .mockReset()
    .mockImplementation(
      async (
        _binding: unknown,
        execute: (token: string) => Promise<unknown>,
      ) => ({ ok: true, value: await execute("step-up-token") }),
    );
  mocks.requestDeletion
    .mockReset()
    .mockResolvedValue({ pendingActionId: "pa-1" });
  mocks.navigate.mockReset();
  mocks.canManageApiKeys.mockReset().mockReturnValue(true);
  mocks.isCheckingPermissions.value = false;
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

const sourceListKey = ["service-keys", "ws-1"];
const scopedListKey = [
  "service-key-history-list",
  "ws-1",
  "localhost:3000",
  "u1",
  "s1",
];
const admissionKey = [
  "service-key-history-admission",
  "localhost:3000",
  "u1",
  "s1",
  "ws-1",
  "k1",
];
const privateHistoryKey = [
  "settings-history",
  "service_api_key",
  "k1",
  "agent",
  "u1",
  "s1",
];

async function prepareCachedDenial(status: number) {
  mocks.list.mockResolvedValue([key()]);
  const view = renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await screen.findByTestId("key-history");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  mocks.history.mockRejectedValueOnce(new HttpError(status, "denied"));
  fireEvent.click(
    screen.getByRole("button", { name: "History for Pipeline (1)" }),
  );
  await waitFor(() =>
    expect(view.client.getQueryState(admissionKey)?.status).toBe("error"),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(view.client.getQueryData(admissionKey)).toBeTruthy();
  expect(view.client.getQueryData(privateHistoryKey)).toBeNull();
  return view;
}

it.each([
  [403, false],
  [404, true],
] as const)(
  "keeps cached %i denial open during a new %s offline read until fresh allow",
  async (status, offline) => {
    const { client } = await prepareCachedDenial(status);
    client.setQueryData(privateHistoryKey, {
      rows: [{ actor: "cached-private" }],
    });
    let allow!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    mocks.history.mockImplementationOnce(
      (_type: string, _id: string, requestSignal: AbortSignal) => {
        signal = requestSignal;
        return new Promise((resolve) => {
          allow = resolve;
        });
      },
    );
    if (offline) act(() => onlineManager.setOnline(false));
    fireEvent.click(
      screen.getByRole("button", { name: "History for Pipeline (1)" }),
    );
    let allowLists!: (value: unknown[]) => void;
    if (offline) {
      await waitFor(() =>
        expect(client.getQueryState(admissionKey)?.fetchStatus).toBe("paused"),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByTestId("key-history")).toBeNull();
      mocks.list.mockReturnValue(
        new Promise((resolve) => {
          allowLists = resolve;
        }),
      );
      act(() => onlineManager.setOnline(true));
    }
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("key-history")).toBeNull();
    expect(screen.queryByText(/cached-private/)).toBeNull();
    await act(async () =>
      allow({ entityType: "service_api_key", entityId: "k1", rows: [] }),
    );
    if (offline) {
      expect(screen.queryByTestId("key-history")).toBeNull();
      await act(async () => allowLists([key()]));
    }
    expect(await screen.findByTestId("key-history")).toBeInTheDocument();
    expect(signal?.aborted).toBe(false);
  },
);

it("aborts a reopened admission on session change without revealing its result", async () => {
  const view = await prepareCachedDenial(403);
  let allow!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  mocks.history.mockImplementationOnce(
    (_type: string, _id: string, requestSignal: AbortSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => {
        allow = resolve;
      });
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "History for Pipeline (1)" }),
  );
  await waitFor(() => expect(signal).toBeDefined());
  mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () =>
    allow({ entityType: "service_api_key", entityId: "k1", rows: [] }),
  );
  expect(screen.queryByTestId("key-history")).toBeNull();
  expect(view.client.getQueryData(privateHistoryKey)).toBeNull();
});

it.each([403, 404])(
  "closes and clears only after the current reopened request returns %i",
  async (status) => {
    const { client } = await prepareCachedDenial(status);
    client.setQueryData(privateHistoryKey, {
      rows: [{ actor: "cached-private" }],
    });
    let reject!: (error: Error) => void;
    let signal: AbortSignal | undefined;
    mocks.history.mockImplementationOnce(
      (_type: string, _id: string, requestSignal: AbortSignal) => {
        signal = requestSignal;
        return new Promise((_resolve, fail) => {
          reject = fail;
        });
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "History for Pipeline (1)" }),
    );
    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("key-history")).toBeNull();
    await act(async () => reject(new HttpError(status, "current denial")));
    await waitFor(() =>
      expect(client.getQueryData(privateHistoryKey)).toBeNull(),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
);

it.each([403, 404])(
  "does not admit a cached session list while offline, then stays hidden on %i",
  async (status) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(sourceListKey, [key()]);
    client.setQueryData(scopedListKey, [key()]);
    client.setQueryData(admissionKey, { rows: [{ actor: "cached-private" }] });
    client.setQueryData(privateHistoryKey, {
      rows: [{ actor: "cached-private" }],
    });
    mocks.list.mockRejectedValue(new HttpError(status, "denied"));
    onlineManager.setOnline(false);
    const observer = new QueryObserver(client, {
      queryKey: scopedListKey,
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    renderCard(undefined, client);
    await waitFor(() =>
      expect(observer.getCurrentResult().isPaused).toBe(true),
    );
    expect(
      screen.queryByRole("button", { name: "History for Pipeline (1)" }),
    ).toBeNull();
    expect(screen.queryByTestId("key-history")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "History for Pipeline (1)" }),
      ).toBeNull(),
    );
    unsubscribe();
  },
);

it("waits for a fresh online session list despite cached source and admission", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(sourceListKey, [key()]);
  client.setQueryData(scopedListKey, [key()]);
  client.setQueryData(admissionKey, { rows: [{ actor: "cached-private" }] });
  client.setQueryData(privateHistoryKey, {
    rows: [{ actor: "cached-private" }],
  });
  let allow!: (value: unknown[]) => void;
  mocks.list.mockReturnValue(
    new Promise((resolve) => {
      allow = resolve;
    }),
  );
  renderCard(undefined, client);
  await waitFor(() => expect(mocks.list).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeNull();
  await act(async () => allow([key()]));
  expect(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeInTheDocument();
});

it("requires a new admission after closing and reopening the same key offline", async () => {
  mocks.list.mockResolvedValue([key()]);
  const { client } = renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await screen.findByTestId("key-history");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  await waitFor(() => expect(screen.queryByTestId("key-history")).toBeNull());
  mocks.history.mockClear().mockRejectedValue(new HttpError(403, "denied"));
  act(() => onlineManager.setOnline(false));
  fireEvent.click(
    screen.getByRole("button", { name: "History for Pipeline (1)" }),
  );
  await waitFor(() =>
    expect(client.getQueryState(admissionKey)?.fetchStatus).toBe("paused"),
  );
  expect(screen.queryByTestId("key-history")).toBeNull();
  act(() => onlineManager.setOnline(true));
  await waitFor(() =>
    expect(client.getQueryData(privateHistoryKey)).toBeNull(),
  );
  expect(screen.queryByTestId("key-history")).toBeNull();
});

it("hides an open dialog when its session-list refresh pauses offline", async () => {
  mocks.list.mockResolvedValue([key()]);
  const { client } = renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await screen.findByTestId("key-history");
  act(() => {
    onlineManager.setOnline(false);
    void client.invalidateQueries({ queryKey: scopedListKey });
  });
  await waitFor(() =>
    expect(client.getQueryState(scopedListKey)?.fetchStatus).toBe("paused"),
  );
  await waitFor(() => expect(screen.queryByTestId("key-history")).toBeNull());
  mocks.list.mockRejectedValue(new HttpError(403, "denied"));
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("does not let an aborted older denial clear the newly selected key", async () => {
  mocks.list.mockResolvedValue([key(), key({ id: "k2", name: "Other" })]);
  let deny!: (error: Error) => void;
  mocks.history.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      deny = reject;
    }),
  );
  const { client } = renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "History for Other (2)" }),
  );
  expect(await screen.findByTestId("key-history")).toHaveAttribute(
    "data-id",
    "k2",
  );
  await act(async () => deny(new HttpError(403, "old denial")));
  expect(screen.getByTestId("key-history")).toHaveAttribute("data-id", "k2");
  expect(
    client.getQueryData([
      "settings-history",
      "service_api_key",
      "k2",
      "agent",
      "u1",
      "s1",
    ]),
  ).toBeTruthy();
});

it.each([403, 404])(
  "keeps cached per-key History hidden while offline and clears it after %i",
  async (status) => {
    mocks.list.mockResolvedValue([key({ enabled: false })]);
    const { client } = renderCard();
    const button = await screen.findByRole("button", {
      name: "History for Pipeline (1)",
    });
    client.setQueryData(admissionKey, { rows: [{ actor: "cached-private" }] });
    client.setQueryData(privateHistoryKey, {
      rows: [{ actor: "cached-private" }],
    });
    mocks.history.mockRejectedValue(new HttpError(status, "denied"));
    act(() => onlineManager.setOnline(false));
    const observer = new QueryObserver(client, {
      queryKey: admissionKey,
      enabled: false,
    });
    const unsubscribe = observer.subscribe(() => {});
    fireEvent.click(button);
    await waitFor(() =>
      expect(observer.getCurrentResult().isPaused).toBe(true),
    );
    expect(screen.queryByTestId("key-history")).toBeNull();
    expect(screen.queryByText(/cached-private/)).toBeNull();
    expect(mocks.history).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(mocks.history).toHaveBeenCalled());
    await waitFor(() =>
      expect(client.getQueryData(privateHistoryKey)).toBeNull(),
    );
    expect(screen.queryByTestId("key-history")).toBeNull();
    unsubscribe();
  },
);

it("waits for a current online read before showing previously cached History", async () => {
  mocks.list.mockResolvedValue([key()]);
  const { client } = renderCard();
  const button = await screen.findByRole("button", {
    name: "History for Pipeline (1)",
  });
  client.setQueryData(admissionKey, { rows: [{ actor: "cached-private" }] });
  client.setQueryData(privateHistoryKey, {
    rows: [{ actor: "cached-private" }],
  });
  let allow!: (value: unknown) => void;
  mocks.history.mockReturnValue(
    new Promise((resolve) => {
      allow = resolve;
    }),
  );
  fireEvent.click(button);
  await waitFor(() => expect(mocks.history).toHaveBeenCalled());
  expect(screen.queryByTestId("key-history")).toBeNull();
  await act(async () =>
    allow({ entityType: "service_api_key", entityId: "k1", rows: [] }),
  );
  expect(await screen.findByTestId("key-history")).toBeInTheDocument();
});

describe("ServiceKeysCard", () => {
  it("does not request or render service keys when the caller lacks api_key:manage", async () => {
    mocks.canManageApiKeys.mockReturnValue(false);
    const { container } = renderCard();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("waits until permissions finish loading before requesting service keys", async () => {
    mocks.isCheckingPermissions.value = true;
    const { container } = renderCard();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a caller without api_key:manage without triggering QueryCache errors (the list answers 403)", async () => {
    const onQueryError = vi.fn();
    mocks.list.mockRejectedValue(new HttpError(403, "forbidden"));
    const { container } = renderCard(onQueryError);
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(onQueryError).not.toHaveBeenCalled();
  });

  it("shows an error alert with retry and disables creation when loading fails with a non-403 error", async () => {
    const onQueryError = vi.fn();
    mocks.list
      .mockRejectedValueOnce(new HttpError(500, "internal error"))
      .mockResolvedValue([key()]);
    renderCard(onQueryError);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      translate("settings:instanceApiKeys.loadError"),
    );
    expect(onQueryError).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByText(translate("settings:serviceKeys.empty")),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: translate("settings:serviceKeys.create.open"),
      }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: translate("common:actions.retry") }),
    );
    expect(await screen.findByText("Pipeline")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: translate("settings:serviceKeys.create.open"),
      }),
    ).toBeEnabled();
  });

  it("flags a key created by a former member as owned by the workspace administrators", async () => {
    mocks.list.mockResolvedValue([
      key({
        createdByFormerMember: true,
        ownedByWorkspaceAdmins: true,
        requiresReattestation: true,
      }),
    ]);
    renderCard();
    expect(
      await screen.findByText("Created by a former member"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Owned by workspace administrators"),
    ).toBeInTheDocument();
    expect(screen.getByText("Re-attestation required")).toBeInTheDocument();
  });

  it("re-attests with a fresh proof bound to the key and accountability version", async () => {
    mocks.list.mockResolvedValue([
      key({
        createdByFormerMember: true,
        ownedByWorkspaceAdmins: true,
        requiresReattestation: true,
        accountabilityVersion: 4,
      }),
    ]);
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Re-attest" }));
    expect(
      await screen.findByText(
        "Confirm that workspace administrators accept responsibility for this service key. Its secret and capability subset will not change.",
      ),
    ).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Re-attest" }));
    await waitFor(() =>
      expect(mocks.stepRun).toHaveBeenCalledWith(
        {
          operation: "service_key_reattest",
          workspaceId: "ws-1",
          keyId: "k1",
          expectedVersion: 4,
        },
        expect.any(Function),
      ),
    );
    await waitFor(() =>
      expect(mocks.reattest).toHaveBeenCalledWith(
        "ws-1",
        "k1",
        4,
        "step-up-token",
      ),
    );
  });

  it("revokes only after confirmation", async () => {
    mocks.list.mockResolvedValue([key()]);
    renderCard();
    fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
    expect(mocks.revoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(mocks.revoke).toHaveBeenCalledWith("ws-1", "k1"),
    );
  });

  it("deleting opens a pending action instead of deleting", async () => {
    mocks.list.mockResolvedValue([key()]);
    renderCard();
    fireEvent.click(
      await screen.findByLabelText("Request deletion of Pipeline"),
    );
    await waitFor(() =>
      expect(mocks.requestDeletion).toHaveBeenCalledWith("ws-1", "k1"),
    );
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  });

  it("shows the translated revoke error instead of a raw response", async () => {
    mocks.list.mockResolvedValue([key()]);
    mocks.revoke.mockRejectedValue(new Error("raw server refusal"));
    renderCard();
    fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        translate("settings:serviceKeys.toastRevokeError"),
        { error: expect.any(Error) },
      ),
    );
  });

  it("shows the translated deletion error and does not open a pending action", async () => {
    mocks.list.mockResolvedValue([key()]);
    mocks.requestDeletion.mockRejectedValue(new Error("raw server refusal"));
    renderCard();
    fireEvent.click(
      await screen.findByLabelText("Request deletion of Pipeline"),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        translate("settings:serviceKeys.deleteFailed"),
        { error: expect.any(Error) },
      ),
    );
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

it("opens authorized per-key History for the actual retained service key", async () => {
  mocks.list.mockResolvedValue([
    key({ enabled: false, createdByFormerMember: true }),
  ]);
  renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  const history = await screen.findByTestId("key-history");
  expect(history).toHaveAttribute("data-type", "service_api_key");
  expect(history).toHaveAttribute("data-id", "k1");
  expect(mocks.history).toHaveBeenCalledWith(
    "service_api_key",
    "k1",
    expect.any(AbortSignal),
  );
});

it("refreshes the captured service key after confirmed revocation", async () => {
  mocks.list.mockResolvedValue([key()]);
  renderCard();
  fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "service_api_key", "k1", "agent", "u1", "s1"],
      expect.any(Function),
    ),
  );
});

it("gives same-name keys distinct accessible History controls", async () => {
  mocks.list.mockResolvedValue([key(), key({ id: "k2" })]);
  renderCard();
  expect(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "History for Pipeline (2)" }),
  ).toBeInTheDocument();
});

it("hides History when the fresh session-scoped list is denied", async () => {
  mocks.list
    .mockResolvedValueOnce([key()])
    .mockRejectedValueOnce(new HttpError(403, "denied"));
  renderCard();
  await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeNull();
  expect(screen.getByText("Pipeline")).toBeInTheDocument();
});

it("clears only the selected key's cache after exact History denial", async () => {
  mocks.list.mockResolvedValue([key()]);
  mocks.history.mockRejectedValueOnce(new HttpError(403, "denied"));
  const { client } = renderCard();
  const target = [
    "settings-history",
    "service_api_key",
    "k1",
    "agent",
    "u1",
    "s1",
  ];
  const other = [
    "settings-history",
    "service_api_key",
    "k2",
    "agent",
    "u1",
    "s1",
  ];
  client.setQueryData(target, { private: "old" });
  client.setQueryData(other, { private: "other" });
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await waitFor(() => expect(client.getQueryData(target)).toBeNull());
  expect(client.getQueryData(other)).toEqual({ private: "other" });
  expect(screen.queryByTestId("key-history")).toBeNull();
});

it("closes an open History dialog when the source list reloads and the row is deleted", async () => {
  mocks.list.mockResolvedValue([key()]);
  const { client } = renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await screen.findByTestId("key-history");
  let finish!: (value: unknown[]) => void;
  mocks.list.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  void client.invalidateQueries({ queryKey: ["service-keys", "ws-1"] });
  await waitFor(() => expect(screen.queryByTestId("key-history")).toBeNull());
  finish([]);
  await screen.findByText(translate("settings:serviceKeys.empty"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes History when the session or workspace changes", async () => {
  mocks.list.mockResolvedValue([key()]);
  const view = renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await screen.findByTestId("key-history");
  mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
  expect(screen.queryByTestId("key-history")).toBeNull();
  mocks.workspaceId = "ws-2";
  view.rerender(
    <QueryClientProvider client={view.client}>
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
  expect(screen.queryByTestId("key-history")).toBeNull();
});

it("refreshes after a successful re-attestation and never waits for History", async () => {
  mocks.list.mockResolvedValue([key({ requiresReattestation: true })]);
  mocks.refresh.mockImplementation(() => new Promise(() => {}));
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Re-attest" }));
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Re-attest",
    }),
  );
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "service_api_key", "k1", "agent", "u1", "s1"],
      expect.any(Function),
    ),
  );
  expect(toast.success).toHaveBeenCalledWith(
    translate("settings:serviceKeys.reattest.success"),
  );
});

it("does not refresh History for a deletion request or failed revocation", async () => {
  mocks.list.mockResolvedValue([key()]);
  mocks.revoke.mockRejectedValue(new Error("refused"));
  renderCard();
  fireEvent.click(await screen.findByLabelText("Request deletion of Pipeline"));
  await waitFor(() => expect(mocks.requestDeletion).toHaveBeenCalled());
  fireEvent.click(screen.getByLabelText("Revoke Pipeline"));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalled());
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("preserves revoke feedback during impersonation while hiding History", async () => {
  Object.assign(mocks.session.session, { impersonatedBy: "admin" });
  mocks.list.mockResolvedValue([key()]);
  renderCard();
  fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Service key revoked"),
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeNull();
});

it("keeps pending audit admission hidden and clears stale rows on 403", async () => {
  mocks.list.mockResolvedValue([key()]);
  let deny!: (error: Error) => void;
  mocks.history.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      deny = reject;
    }),
  );
  const { client } = renderCard();
  const cacheKey = [
    "settings-history",
    "service_api_key",
    "k1",
    "agent",
    "u1",
    "s1",
  ];
  client.setQueryData(cacheKey, { rows: [{ actor: "cached-private" }] });
  fireEvent.click(
    await screen.findByRole("button", { name: "History for Pipeline (1)" }),
  );
  await waitFor(() => expect(mocks.history).toHaveBeenCalled());
  expect(screen.queryByTestId("key-history")).toBeNull();
  expect(screen.queryByText(/cached-private/)).toBeNull();
  deny(new HttpError(403, "denied"));
  await waitFor(() => expect(client.getQueryData(cacheKey)).toBeNull());
  expect(screen.queryByTestId("key-history")).toBeNull();
});

it("refreshes only the captured key when revocation completes after a session change", async () => {
  mocks.list.mockResolvedValue([key()]);
  let finish!: (value: ReturnType<typeof key>) => void;
  mocks.revoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderCard();
  fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalled());
  mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
  finish(key({ enabled: false }));
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "service_api_key", "k1", "agent", "u1", "s1"],
      expect.any(Function),
    ),
  );
  expect(toast.success).not.toHaveBeenCalled();
  await mocks.refresh.mock.calls[0][2]();
  expect(mocks.guard).toHaveBeenCalledWith(
    "staff",
    "u1",
    "s1",
    window.location.host,
  );
});

it("captures the re-attestation target and session before a pending write", async () => {
  mocks.list.mockResolvedValue([key({ requiresReattestation: true })]);
  let finish!: (value: ReturnType<typeof key>) => void;
  mocks.reattest.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Re-attest" }));
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Re-attest",
    }),
  );
  await waitFor(() => expect(mocks.reattest).toHaveBeenCalled());
  mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <ServiceKeysCard />
    </QueryClientProvider>,
  );
  finish(key({ requiresReattestation: false }));
  await waitFor(() =>
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.anything(),
      ["settings-history", "service_api_key", "k1", "agent", "u1", "s1"],
      expect.any(Function),
    ),
  );
  expect(toast.success).not.toHaveBeenCalled();
});

it("does not refresh History after a refused re-attestation proof", async () => {
  mocks.list.mockResolvedValue([key({ requiresReattestation: true })]);
  mocks.stepRun.mockResolvedValueOnce({ ok: false });
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Re-attest" }));
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Re-attest",
    }),
  );
  await waitFor(() => expect(mocks.stepRun).toHaveBeenCalled());
  expect(mocks.reattest).not.toHaveBeenCalled();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("hides History for a portal session even when a stale list is present", async () => {
  Object.assign(mocks.session.session, { portal: "customer" });
  mocks.list.mockResolvedValue([key()]);
  renderCard();
  expect(await screen.findByText("Pipeline")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeNull();
  expect(mocks.history).not.toHaveBeenCalled();
});

it("does not refresh History when a pending deletion request fails", async () => {
  mocks.list.mockResolvedValue([key()]);
  mocks.requestDeletion.mockRejectedValue(new Error("refused"));
  renderCard();
  fireEvent.click(await screen.findByLabelText("Request deletion of Pipeline"));
  await waitFor(() => expect(mocks.requestDeletion).toHaveBeenCalled());
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.navigate).not.toHaveBeenCalled();
});
