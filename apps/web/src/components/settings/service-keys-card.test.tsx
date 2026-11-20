import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
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
  audited: vi.fn(),
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
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({
    target,
  }: {
    target: { type: string; id: string; scope: { workspaceId: string } };
  }) => (
    <div
      data-testid="key-history"
      data-type={target.type}
      data-id={target.id}
      data-workspace={target.scope.workspaceId}
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
      mutationCache: new MutationCache({
        onSuccess: (data, variables, _context, mutation) =>
          mocks.audited(
            mutation.meta?.audits?.targets(variables as never, data as never),
          ),
      }),
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
  mocks.audited.mockReset();
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
afterEach(cleanup);

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

const keyTarget = [
  {
    kind: "entity",
    type: "service_api_key",
    id: "k1",
    scope: { kind: "workspace", workspaceId: "ws-1" },
  },
];

it("opens History for the service key by target only", async () => {
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
  expect(history).toHaveAttribute("data-workspace", "ws-1");
});

it("offers History for service keys only, never for MCP keys", async () => {
  mocks.list.mockResolvedValue([key({ id: "m1", isMcp: true })]);
  renderCard();
  await screen.findByText("Pipeline");
  expect(
    screen.queryByRole("button", { name: "History for Pipeline (1)" }),
  ).toBeNull();
});

it("audits the revoked key after confirmed revocation", async () => {
  mocks.list.mockResolvedValue([key()]);
  mocks.revoke.mockResolvedValue(key({ enabled: false }));
  renderCard();
  fireEvent.click(await screen.findByLabelText("Revoke Pipeline"));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(mocks.audited).toHaveBeenCalledWith(keyTarget));
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
});

it("audits the re-attested key after a successful re-attestation", async () => {
  mocks.list.mockResolvedValue([key({ requiresReattestation: true })]);
  renderCard();
  fireEvent.click(await screen.findByRole("button", { name: "Re-attest" }));
  fireEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Re-attest",
    }),
  );
  await waitFor(() => expect(mocks.audited).toHaveBeenCalledWith(keyTarget));
  expect(toast.success).toHaveBeenCalledWith(
    translate("settings:serviceKeys.reattest.success"),
  );
});

it("audits a committed re-attestation even if the session changes before it returns", async () => {
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
  await waitFor(() => expect(mocks.audited).toHaveBeenCalledWith(keyTarget));
  expect(toast.success).not.toHaveBeenCalled();
});

it("does not audit a deletion request or a failed revocation", async () => {
  mocks.list.mockResolvedValue([key()]);
  mocks.revoke.mockRejectedValue(new Error("refused"));
  renderCard();
  fireEvent.click(await screen.findByLabelText("Request deletion of Pipeline"));
  await waitFor(() => expect(mocks.requestDeletion).toHaveBeenCalled());
  fireEvent.click(screen.getByLabelText("Revoke Pipeline"));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalled());
  expect(mocks.audited).not.toHaveBeenCalledWith(keyTarget);
});

it("does not audit a refused re-attestation proof", async () => {
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
  expect(mocks.audited).not.toHaveBeenCalledWith(keyTarget);
});
