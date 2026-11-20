import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  audited: vi.fn(),
  guard: vi.fn(),
  session: { user: { id: "u1" }, session: { id: "s1" } },
  prove: vi.fn(),
  factorStatus: {
    enabled: false,
    required: false,
    availableMethods: ["password"] as string[],
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: mocks.session }) },
}));
vi.mock("@/lib/profile-session-guard", () => ({
  profileSessionGuard: () => () => mocks.guard(),
}));
vi.mock("@/lib/i18n", () => ({ i18n: { t: (key: string) => key } }));

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/fetchers/god-mode/identity-step-up", () => ({
  proveIdentityOperation: (...args: unknown[]) => mocks.prove(...args),
}));
vi.mock("@/fetchers/god-mode/instance-users", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/fetchers/god-mode/instance-users")>();
  return {
    ...actual,
    getCurrentFactorStatus: async () => mocks.factorStatus,
  };
});
vi.mock("@/fetchers/service-keys", () => ({
  createServiceKey: (...args: unknown[]) => mocks.create(...args),
}));

import { agentSessionKeys } from "@/lib/agent-session";
import { CreateServiceKeyDialog } from "./create-service-key-dialog";

beforeEach(() => {
  mocks.session = { user: { id: "u1" }, session: { id: "s1" } };
  mocks.audited.mockReset();
  mocks.guard.mockReset().mockResolvedValue(undefined);
  mocks.create
    .mockReset()
    .mockResolvedValue({ id: "k1", name: "Pipeline", key: "tdk_secret" });
  mocks.prove.mockReset().mockResolvedValue("step-up-token");
});
afterEach(cleanup);

function renderFixture(onCreated = vi.fn(), workspaceId = "ws-1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) =>
        mocks.audited(
          mutation.meta?.audits?.targets(variables as never, data as never),
        ),
    }),
  });
  client.setQueryData(["god-mode", "step-up-factor"], mocks.factorStatus);
  client.setQueryData(agentSessionKeys.session(), {
    user: { id: "u1" },
    session: { id: "s1", userId: "u1" },
  });
  client.setQueryData(agentSessionKeys.factorsPassed("u1", "s1"), true);
  const onClose = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <CreateServiceKeyDialog
        workspaceId={workspaceId}
        onClose={onClose}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { client, onCreated, onClose, ...view };
}
function renderDialog(onCreated = vi.fn()) {
  return renderFixture(onCreated).onCreated;
}
function submit() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Pipeline" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "fresh-factor" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create key" }));
}

describe("CreateServiceKeyDialog", () => {
  it("cannot create until a fresh verification is entered, then spends one bound to the exact key", async () => {
    const onCreated = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pipeline" },
    });
    const create = screen.getByRole("button", { name: "Create key" });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse" },
    });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.prove).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "service_key_create",
        workspaceId: "ws-1",
        name: "Pipeline",
        capabilities: expect.arrayContaining(["workspace:read"]),
      }),
      { method: "password", secret: "correct horse" },
    );
    expect(mocks.create).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ name: "Pipeline" }),
      "step-up-token",
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("creates nothing when the verification fails", async () => {
    mocks.prove.mockRejectedValue(new Error("refused"));
    renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pipeline" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(
      await screen.findAllByText(
        "Fresh verification failed. Nothing was created.",
      ),
    ).not.toHaveLength(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("shows the translated creation failure rather than raw server text", async () => {
    mocks.create.mockRejectedValue(new Error("raw server refusal"));
    const onCreated = renderDialog();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Pipeline" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(
      await screen.findByText(translate("settings:serviceKeys.create.failed")),
    ).toBeInTheDocument();
    expect(screen.queryByText("raw server refusal")).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

it("audits the returned key ID without waiting for the list refresh", async () => {
  const fixture = renderFixture();
  vi.spyOn(fixture.client, "invalidateQueries").mockImplementation(
    () => new Promise(() => {}),
  );
  submit();
  await waitFor(() =>
    expect(mocks.audited).toHaveBeenCalledWith([
      {
        kind: "entity",
        type: "service_api_key",
        id: "k1",
        scope: { kind: "workspace", workspaceId: "ws-1" },
      },
    ]),
  );
  await waitFor(() =>
    expect(fixture.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "k1", key: "tdk_secret" }),
    ),
  );
  expect(fixture.onClose).toHaveBeenCalled();
});

it("audits the created key in its original workspace when the session and workspace switch during creation", async () => {
  let finish!: (value: { id: string; name: string; key: string }) => void;
  mocks.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const fixture = renderFixture();
  submit();
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
  fixture.rerender(
    <QueryClientProvider client={fixture.client}>
      <CreateServiceKeyDialog
        workspaceId="ws-2"
        onClose={fixture.onClose}
        onCreated={fixture.onCreated}
      />
    </QueryClientProvider>,
  );
  finish({ id: "k1", name: "Pipeline", key: "tdk_secret" });
  await waitFor(() =>
    expect(mocks.audited).toHaveBeenCalledWith([
      {
        kind: "entity",
        type: "service_api_key",
        id: "k1",
        scope: { kind: "workspace", workspaceId: "ws-1" },
      },
    ]),
  );
  expect(fixture.onCreated).not.toHaveBeenCalled();
  expect(fixture.onClose).not.toHaveBeenCalled();
});

it("does not block ordinary creation handoff for an impersonated session", async () => {
  Object.assign(mocks.session.session, { impersonatedBy: "admin" });
  const fixture = renderFixture();
  submit();
  await waitFor(() => expect(fixture.onCreated).toHaveBeenCalled());
  expect(fixture.onClose).toHaveBeenCalled();
});

it("does not audit or hand off a key on failed creation", async () => {
  mocks.create.mockRejectedValue(new Error("refused"));
  const fixture = renderFixture();
  submit();
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  await screen.findByText(translate("settings:serviceKeys.create.failed"));
  expect(mocks.audited).not.toHaveBeenCalled();
  expect(fixture.onCreated).not.toHaveBeenCalled();
});

it("keeps the one-time key for retry if post-create session verification is temporarily unavailable", async () => {
  mocks.guard
    .mockRejectedValueOnce(new Error("temporary session failure"))
    .mockResolvedValue(undefined);
  const fixture = renderFixture();
  submit();
  await screen.findByText(translate("common:error.sessionUnavailable"));
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(fixture.onCreated).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: translate("common:actions.retry") }),
  );
  await waitFor(() =>
    expect(fixture.onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "k1", key: "tdk_secret" }),
    ),
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it("does not hand the one-time key to a new session if identity changes while the UI guard is pending", async () => {
  let release!: () => void;
  mocks.guard.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const fixture = renderFixture();
  submit();
  await waitFor(() => expect(mocks.guard).toHaveBeenCalled());
  mocks.session = { user: { id: "u2" }, session: { id: "s2" } };
  fixture.rerender(
    <QueryClientProvider client={fixture.client}>
      <CreateServiceKeyDialog
        workspaceId="ws-2"
        onClose={fixture.onClose}
        onCreated={fixture.onCreated}
      />
    </QueryClientProvider>,
  );
  release();
  await waitFor(() => expect(mocks.audited).toHaveBeenCalled());
  expect(fixture.onCreated).not.toHaveBeenCalled();
  expect(fixture.onClose).not.toHaveBeenCalled();
});

it("audits the created key even if its dialog unmounts while creation is pending", async () => {
  let finish!: (value: { id: string; name: string; key: string }) => void;
  mocks.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const fixture = renderFixture();
  submit();
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  fixture.unmount();
  finish({ id: "k1", name: "Pipeline", key: "tdk_secret" });
  await waitFor(() =>
    expect(mocks.audited).toHaveBeenCalledWith([
      {
        kind: "entity",
        type: "service_api_key",
        id: "k1",
        scope: { kind: "workspace", workspaceId: "ws-1" },
      },
    ]),
  );
  expect(fixture.onCreated).not.toHaveBeenCalled();
  expect(fixture.onClose).not.toHaveBeenCalled();
});
