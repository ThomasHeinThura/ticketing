import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createContext,
  Suspense,
  startTransition,
  use,
  useContext,
  useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  getSession: vi.fn(),
  sessionHook: null as null | (() => { data: unknown }),
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
vi.mock("@/components/settings/terminology-editor", () => ({
  TerminologyEditor: () => null,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    // A test may supply a reactive hook to drive the session through React state.
    useSession: () =>
      mocks.sessionHook ? mocks.sessionHook() : { data: mocks.session },
    getSession: (...args: unknown[]) => mocks.getSession(...args),
  },
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: ({ target }: { target: unknown }) => (
    <div data-testid="history" data-target={JSON.stringify(target)} />
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (rawKey: string, options: Record<string, unknown> = {}) =>
      translate(
        namespace && !rawKey.includes(":") ? `${namespace}:${rawKey}` : rawKey,
        options,
      ),
  }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/fetchers/god-mode/instance-settings", async () => {
  const { HttpError: Http } = await import("@/lib/http-error");
  return {
    getInstanceSettings: (...args: unknown[]) => mocks.get(...args),
    patchInstanceSettings: (...args: unknown[]) => mocks.patch(...args),
    // The real class's shape: an HttpError 409 with the version_conflict message.
    InstanceSettingsConflictError: class InstanceSettingsConflictError extends Http {
      constructor() {
        super(409, "version_conflict");
      }
    },
  };
});

import { InstanceSettingsConflictError } from "@/fetchers/god-mode/instance-settings";
import { InstanceSettingsForm } from "./instance-settings-form";

const response = {
  updatedAt: "2026-10-25T00:00:00.000Z",
  settings: {
    approvalDefaultExpiryDays: 7,
    clarificationWindowDays: 14,
    reopenWindowDays: 14,
    notificationRetentionDays: 90,
    cspMode: "report_only" as const,
    invitationLifetimeHours: 48,
    customerInvitationCreateWindowMinutes: 60,
    customerInvitationPerInviterLimit: 20,
    customerInvitationPerOrganisationLimit: 50,
    customerInvitationResendCooldownSeconds: 60,
    anonymousRateLimitWindowMs: 600_000,
    anonymousRateLimitMax: 100,
    mcpWriteCeilingPerMinute: 30,
    apiKeyBurstThreshold: 300,
    timezone: "UTC",
    attachmentMaxBytes: 25 * 1024 * 1024,
    attachmentMaxPerItem: 100,
    attachmentAllowedExtensions: ["pdf"],
  },
};

beforeEach(() => {
  mocks.get.mockReset();
  mocks.patch.mockReset();
  mocks.get.mockResolvedValue(response);
  mocks.getSession.mockReset();
  mocks.getSession.mockImplementation(async () => ({
    data: mocks.session,
    error: null,
  }));
  mocks.sessionHook = null;
  mocks.session = {
    user: { id: "user-one" },
    session: { id: "session-one" },
  };
});
afterEach(cleanup);

async function chooseSelectOption(combobox: HTMLElement, name: string) {
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name });
  // Base UI ignores a mouse activation immediately after opening to avoid
  // interpreting the opening pointer-up as an option selection.
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

function renderForm() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnMount: false },
      mutations: { retry: false },
    },
  });
  // A fresh element each time: re-rendering the same element object would bail out.
  const tree = () => (
    <QueryClientProvider client={client}>
      <InstanceSettingsForm />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, ...view, rerenderForm: () => view.rerender(tree()) };
}

describe("instance MCP rate setting", () => {
  it("loads the persisted ceiling and saves changes through instance settings", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      updatedAt: "2026-10-25T00:01:00.000Z",
      settings: { ...response.settings, mcpWriteCeilingPerMinute: 12 },
    });
    renderForm();

    const input = await screen.findByLabelText(
      translate("godModeSettings:fields.mcpWriteCeilingPerMinute.label"),
    );
    expect(input).toHaveValue(30);
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "100");
    expect(
      screen.getByText(translate("godModeSettings:mcpRateLimit.description")),
    ).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: { mcpWriteCeilingPerMinute: 12 },
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: translate("common:actions.saved"),
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByLabelText(
        translate("godModeSettings:fields.mcpWriteCeilingPerMinute.label"),
      ),
    ).toHaveValue(12);
  });
  it("edits the persisted burst threshold separately from the write ceiling", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      settings: { ...response.settings, apiKeyBurstThreshold: 450 },
    });
    renderForm();
    const input = await screen.findByLabelText(
      translate("godModeSettings:fields.apiKeyBurstThreshold.label"),
    );
    expect(input).toHaveValue(300);
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "100000");
    fireEvent.change(input, { target: { value: "450" } });
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: { apiKeyBurstThreshold: 450 },
      }),
    );
  });
});

describe("content security policy settings", () => {
  it("saves report-only or enforced mode through the shared settings patch", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      updatedAt: "2026-10-25T00:03:00.000Z",
      settings: { ...response.settings, cspMode: "enforce" },
    });
    renderForm();

    const policyMode = await screen.findByRole("combobox", {
      name: translate("godModeSettings:fields.cspMode.label"),
    });
    expect(policyMode).toHaveTextContent(
      translate("godModeSettings:cspModeOptions.reportOnly"),
    );
    expect(
      screen.getByText(
        translate("godModeSettings:contentSecurityPolicy.description"),
      ),
    ).toBeInTheDocument();

    await chooseSelectOption(
      policyMode,
      translate("godModeSettings:cspModeOptions.enforce"),
    );
    expect(policyMode).toHaveTextContent(
      translate("godModeSettings:cspModeOptions.enforce"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: { cspMode: "enforce" },
      }),
    );
  });
});

describe("customer invitation runtime settings", () => {
  it("edits bounded invitation values through the shared General settings patch", async () => {
    mocks.patch.mockResolvedValue({
      ...response,
      updatedAt: "2026-10-25T00:02:00.000Z",
      settings: {
        ...response.settings,
        invitationLifetimeHours: 72,
        customerInvitationPerOrganisationLimit: 55,
      },
    });
    renderForm();

    const lifetime = await screen.findByLabelText(
      translate("godModeSettings:fields.invitationLifetimeHours.label"),
    );
    const organisationLimit = screen.getByLabelText(
      translate(
        "godModeSettings:fields.customerInvitationPerOrganisationLimit.label",
      ),
    );
    expect(lifetime).toHaveValue(48);
    expect(lifetime).toHaveAttribute("min", "1");
    expect(lifetime).toHaveAttribute("max", "720");
    expect(organisationLimit).toHaveValue(50);
    expect(organisationLimit).toHaveAttribute("max", "10000");
    expect(
      screen.getByText(
        translate("godModeSettings:invitationLimits.description"),
      ),
    ).toBeInTheDocument();

    fireEvent.change(lifetime, { target: { value: "72" } });
    fireEvent.change(organisationLimit, { target: { value: "55" } });
    fireEvent.click(
      screen.getByRole("button", { name: translate("godModeSettings:save") }),
    );
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({
        expectedUpdatedAt: response.updatedAt,
        changes: {
          invitationLifetimeHours: 72,
          customerInvitationPerOrganisationLimit: 55,
        },
      }),
    );
  });
});

const historyPanel = () => screen.findByTestId("history");
const mcpInput = () =>
  screen.findByLabelText(
    translate("godModeSettings:fields.mcpWriteCeilingPerMinute.label"),
  );
const save = () =>
  fireEvent.click(
    screen.getByRole("button", { name: translate("godModeSettings:save") }),
  );
const changed = {
  ...response,
  updatedAt: "2026-10-25T00:01:00.000Z",
  settings: { ...response.settings, mcpWriteCeilingPerMinute: 12 },
};

describe("instance settings History", () => {
  it("mounts the History panel for the literal singleton only after the settings read succeeded", async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderForm();
    expect(screen.queryByTestId("history")).toBeNull();
    await act(async () => finish(response));
    expect(JSON.parse((await historyPanel()).dataset.target ?? "")).toEqual({
      kind: "entity",
      type: "instance",
      id: "singleton",
      scope: { kind: "instance" },
    });
  });

  it("declares the singleton as the audited target of a confirmed save", async () => {
    mocks.patch.mockResolvedValue(changed);
    const view = renderForm();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
    const [mutation] = view.client.getMutationCache().getAll();
    expect(
      mutation?.meta?.audits?.targets(undefined as never, undefined as never),
    ).toEqual([
      {
        kind: "entity",
        type: "instance",
        id: "singleton",
        scope: { kind: "instance" },
      },
    ]);
  });
});

describe("instance settings are scoped to the browser user and session", () => {
  const userB = { user: { id: "user-two" }, session: { id: "session-b" } };
  const settingsKey = (user: string, session: string) => [
    "instance",
    "settings",
    user,
    session,
  ];
  const valueB = {
    ...response,
    updatedAt: "2026-10-25T00:05:00.000Z",
    settings: { ...response.settings, mcpWriteCeilingPerMinute: 45 },
  };
  const held = () => {
    let release: (value: unknown) => void = () => {};
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    return { promise, release: (value: unknown) => release(value) };
  };
  /**
   * The agent-session layer resets every query outside its own `agent-auth` family when a
   * different person signs in (`agent-session.ts` adoptUser); that predicate is reproduced here
   * with the literal key, without importing or executing the session module.
   */
  const switchToB = async (
    view: ReturnType<typeof renderForm>,
    next: typeof userB,
  ) => {
    mocks.session = next;
    await act(async () => {
      // Not awaited, as in adoptUser: the reset resolves only when the active re-read settles.
      void view.client.resetQueries({
        predicate: (query) => query.queryKey[0] !== "agent-auth",
      });
      view.rerenderForm();
    });
  };

  it("sends no settings read, and shows no History, without a browser session", async () => {
    mocks.session = null;
    renderForm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("history")).toBeNull();
  });

  it("keeps a late response for A out of B's settings, fields, Saved state and History", async () => {
    const patchA = held();
    const readB = held();
    mocks.patch.mockImplementationOnce(() => patchA.promise);
    const view = renderForm();
    await historyPanel();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());

    // Reads made under B's session are held; the reset may also re-read the old entry once.
    mocks.get.mockImplementation(() => readB.promise);
    await switchToB(view, userB);
    await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(1));

    await act(async () => patchA.release(changed));
    // B's own read has not settled: nothing of A's answer may stand in for it.
    expect(
      view.client.getQueryData(settingsKey("user-two", "session-b")),
    ).toBeUndefined();
    expect(
      screen.queryByLabelText(
        translate("godModeSettings:fields.mcpWriteCeilingPerMinute.label"),
      ),
    ).toBeNull();
    expect(screen.queryByTestId("history")).toBeNull();
    expect(
      screen.queryByRole("button", { name: translate("common:actions.saved") }),
    ).toBeNull();
    await act(async () => readB.release(valueB));
    expect(await mcpInput()).toHaveValue(45);
    await historyPanel();
    expect(
      view.client.getQueryData<typeof valueB>(
        settingsKey("user-two", "session-b"),
      )?.settings.mcpWriteCeilingPerMinute,
    ).toBe(45);
  });

  it("does not let A's late response overwrite a read of B that already advanced", async () => {
    const patchA = held();
    mocks.patch.mockImplementationOnce(() => patchA.promise);
    const view = renderForm();
    await historyPanel();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());

    mocks.get.mockResolvedValue(valueB);
    await switchToB(view, userB);
    expect(await mcpInput()).toHaveValue(45);

    await act(async () => patchA.release(changed));
    expect(await mcpInput()).toHaveValue(45);
    expect(
      view.client.getQueryData<typeof valueB>(
        settingsKey("user-two", "session-b"),
      )?.updatedAt,
    ).toBe(valueB.updatedAt);
    expect(
      screen.queryByRole("button", { name: translate("common:actions.saved") }),
    ).toBeNull();
  });

  it("discards one session's unsaved draft when the same person's session rotates", async () => {
    const view = renderForm();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    expect(await mcpInput()).toHaveValue(12);
    mocks.session = {
      user: { id: "user-one" },
      session: { id: "session-two" },
    };
    await act(async () => view.rerenderForm());
    // Same user: the shared cache is kept, but the read and the fields belong to the new session.
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(await mcpInput()).toHaveValue(30);
    expect(
      view.client.getQueryData(settingsKey("user-one", "session-two")),
    ).toEqual(response);
  });

  it.each([
    ["another person", userB, "user-two", "session-b"],
    [
      "the same person's rotated session",
      { user: { id: "user-one" }, session: { id: "session-two" } },
      "user-one",
      "session-two",
    ],
  ])(
    "an obsolete conflict from the earlier session invalidates only that session's entry, never %s's draft",
    async (_name, next, user, sessionId) => {
      const patchA = held();
      mocks.patch.mockImplementationOnce(() => patchA.promise);
      const newerB = {
        ...valueB,
        updatedAt: "2026-10-25T00:09:00.000Z",
        settings: { ...response.settings, mcpWriteCeilingPerMinute: 99 },
      };
      mocks.get.mockImplementation(async () =>
        mocks.session?.session.id === "session-one" ? response : valueB,
      );
      const view = renderForm();
      await historyPanel();
      fireEvent.change(await mcpInput(), { target: { value: "12" } });
      save();
      await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
      await switchToB(view, next);
      expect(await mcpInput()).toHaveValue(45);
      fireEvent.change(await mcpInput(), { target: { value: "20" } });

      // From now on the backend would answer B's next read with a newer version.
      mocks.get.mockImplementation(async () => newerB);
      const readsBefore = mocks.get.mock.calls.length;
      await act(async () =>
        patchA.release(Promise.reject(new InstanceSettingsConflictError())),
      );
      await aInvalidated(view.client);

      expect(mocks.get.mock.calls.length).toBe(readsBefore);
      expect(await mcpInput()).toHaveValue(20);
      expect(conflictNotice()).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: translate("common:actions.saved"),
        }),
      ).toBeNull();
      const entryB = view.client.getQueryState(settingsKey(user, sessionId));
      expect(entryB?.isInvalidated).toBe(false);
      expect(
        view.client.getQueryData<typeof valueB>(settingsKey(user, sessionId))
          ?.updatedAt,
      ).toBe(valueB.updatedAt);
      expect(
        view.client.getQueryState(settingsKey("user-one", "session-one"))
          ?.isInvalidated,
      ).toBe(true);
    },
  );

  const conflictNotice = () =>
    screen.queryByText(translate("godModeSettings:conflict"));
  // A's callbacks are observable on A's own exact entry: a 409 invalidates it, a success writes it.
  const keyA = () => settingsKey("user-one", "session-one");
  const aInvalidated = (client: QueryClient) =>
    waitFor(() =>
      expect(client.getQueryState(keyA())?.isInvalidated).toBe(true),
    );
  const aWritten = (client: QueryClient) =>
    waitFor(() =>
      expect(client.getQueryData<typeof valueB>(keyA())?.updatedAt).toBe(
        changed.updatedAt,
      ),
    );
  const newer = {
    ...valueB,
    updatedAt: "2026-10-25T00:09:00.000Z",
  };

  it("a real conflict in the current session refreshes its own entry and keeps the notice beside the newer version", async () => {
    mocks.patch.mockRejectedValueOnce(new InstanceSettingsConflictError());
    const view = renderForm();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    mocks.get.mockResolvedValue(newer);
    save();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue("45")).toBeInTheDocument();
    // The fields were replaced by the newer version, yet the explanation stays.
    expect(conflictNotice()).toBeInTheDocument();
    expect(
      view.client.getQueryData<typeof valueB>(
        settingsKey("user-one", "session-one"),
      )?.updatedAt,
    ).toBe(newer.updatedAt);
  });

  it("clears the conflict notice at the next legitimate edit", async () => {
    mocks.patch.mockRejectedValueOnce(new InstanceSettingsConflictError());
    renderForm();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    mocks.get.mockResolvedValue(newer);
    save();
    await screen.findByDisplayValue("45");
    expect(conflictNotice()).toBeInTheDocument();
    fireEvent.change(await mcpInput(), { target: { value: "46" } });
    await waitFor(() => expect(conflictNotice()).toBeNull());
  });

  it("clears the conflict notice when a new save starts", async () => {
    mocks.patch
      .mockRejectedValueOnce(new InstanceSettingsConflictError())
      .mockResolvedValueOnce({
        ...newer,
        updatedAt: "2026-10-25T00:10:00.000Z",
      });
    renderForm();
    fireEvent.change(await mcpInput(), { target: { value: "12" } });
    mocks.get.mockResolvedValue(newer);
    save();
    await screen.findByDisplayValue("45");
    expect(conflictNotice()).toBeInTheDocument();
    fireEvent.change(await mcpInput(), { target: { value: "46" } });
    save();
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(2));
    expect(conflictNotice()).toBeNull();
  });

  describe.each([
    ["another person", userB],
    [
      "the same person's rotated session",
      { user: { id: "user-one" }, session: { id: "session-two" } },
    ],
  ])(
    "an obsolete earlier-session save settling after %s's own save",
    (_name, next) => {
      const arrangeB = async () => {
        const patchA = held();
        mocks.patch.mockImplementationOnce(() => patchA.promise);
        mocks.get.mockImplementation(async () =>
          mocks.session?.session.id === "session-one" ? response : valueB,
        );
        const view = renderForm();
        await historyPanel();
        fireEvent.change(await mcpInput(), { target: { value: "12" } });
        save();
        await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
        await switchToB(view, next);
        expect(await mcpInput()).toHaveValue(45);
        fireEvent.change(await mcpInput(), { target: { value: "20" } });
        return { patchA, view };
      };

      it("keeps B's own conflict notice when A's old 409 resolves later", async () => {
        const { patchA, view } = await arrangeB();
        mocks.patch.mockRejectedValueOnce(new InstanceSettingsConflictError());
        mocks.get.mockImplementation(async () => newer);
        save();
        await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(conflictNotice()).toBeInTheDocument());
        await act(async () =>
          patchA.release(Promise.reject(new InstanceSettingsConflictError())),
        );
        await aInvalidated(view.client);
        expect(conflictNotice()).toBeInTheDocument();
        // A's own entry is the only one its 409 invalidated; B's entry holds B's newer version.
        expect(
          view.client.getQueryData<typeof valueB>(
            settingsKey(
              mocks.session?.user.id ?? "",
              mocks.session?.session.id ?? "",
            ),
          )?.updatedAt,
        ).toBe(newer.updatedAt);
      });

      it("keeps B's Saved state when A's old success resolves later", async () => {
        const { patchA, view } = await arrangeB();
        mocks.patch.mockResolvedValueOnce({
          ...newer,
          updatedAt: "2026-10-25T00:11:00.000Z",
          settings: { ...newer.settings, mcpWriteCeilingPerMinute: 20 },
        });
        save();
        await screen.findByRole("button", {
          name: translate("common:actions.saved"),
        });
        await act(async () => patchA.release(changed));
        await aWritten(view.client);
        expect(
          screen.getByRole("button", {
            name: translate("common:actions.saved"),
          }),
        ).toBeInTheDocument();
      });

      it("keeps B's conflict notice when A's old success resolves later", async () => {
        const { patchA, view } = await arrangeB();
        mocks.patch.mockRejectedValueOnce(new InstanceSettingsConflictError());
        mocks.get.mockImplementation(async () => newer);
        save();
        await waitFor(() => expect(conflictNotice()).toBeInTheDocument());
        await act(async () => patchA.release(changed));
        await aWritten(view.client);
        expect(conflictNotice()).toBeInTheDocument();
      });
    },
  );

  describe("an interrupted render of the next session", () => {
    // Bounded evidence: React state in a test context stands in for Better Auth's session store.
    // It proves how the form's callback admission behaves when a render reaches B but never
    // commits; it does not prove the real store's integration.
    const sessionOf = {
      a: { user: { id: "user-one" }, session: { id: "session-one" } },
      b: userB,
    };
    const Ctx = createContext<"a" | "b">("a");
    let setWho: (who: "a" | "b") => void = () => {};
    let renderedSessions: string[] = [];
    let openGate: () => void = () => {};

    function Gate({ block, gate }: { block: boolean; gate: Promise<void> }) {
      if (block) use(gate);
      return null;
    }
    function Harness({
      client,
      gate,
    }: {
      client: QueryClient;
      gate: Promise<void>;
    }) {
      const [who, set] = useState<"a" | "b">("a");
      setWho = set;
      return (
        <QueryClientProvider client={client}>
          <Ctx.Provider value={who}>
            <InstanceSettingsForm />
            <Suspense fallback={null}>
              <Gate block={who === "b"} gate={gate} />
            </Suspense>
          </Ctx.Provider>
        </QueryClientProvider>
      );
    }

    /** A is committed with a held PATCH; a transition renders B but a sibling suspends, so B never commits. */
    const arrangeInterrupted = async () => {
      renderedSessions = [];
      mocks.sessionHook = () => {
        const who = useContext(Ctx);
        renderedSessions.push(sessionOf[who].session.id);
        return { data: sessionOf[who] };
      };
      mocks.get.mockImplementation(async () => response);
      const patchA = held();
      mocks.patch.mockImplementationOnce(() => patchA.promise);
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnMount: false },
          mutations: { retry: false },
        },
      });
      render(<Harness client={client} gate={gate} />);
      fireEvent.change(await mcpInput(), { target: { value: "12" } });
      save();
      await waitFor(() => expect(mocks.patch).toHaveBeenCalledOnce());
      renderedSessions = [];
      await act(async () => {
        startTransition(() => setWho("b"));
      });
      // B's render was reached before A's callback runs, yet A is still what is committed.
      expect(renderedSessions).toContain("session-b");
      expect(await mcpInput()).toHaveValue(12);
      return { patchA, client };
    };

    it("still shows A's conflict notice when A's 409 settles while B's render is uncommitted", async () => {
      const { patchA, client } = await arrangeInterrupted();
      mocks.get.mockImplementation(async () => newer);
      const reads = mocks.get.mock.calls.length;
      await act(async () =>
        patchA.release(Promise.reject(new InstanceSettingsConflictError())),
      );
      // A's callback ran: its exact entry was invalidated and re-read.
      await waitFor(() =>
        expect(mocks.get.mock.calls.length).toBeGreaterThan(reads),
      );
      await waitFor(() => expect(conflictNotice()).toBeInTheDocument());
      expect(
        client.getQueryData<typeof valueB>(
          settingsKey("user-one", "session-one"),
        )?.updatedAt,
      ).toBe(newer.updatedAt);
      // Abandon cleanly: let the transition commit B, which shows none of A's feedback.
      await act(async () => openGate());
      await waitFor(() => expect(renderedSessions.at(-1)).toBe("session-b"));
      expect(conflictNotice()).toBeNull();
    });

    it("still shows A's Saved state when A's success settles while B's render is uncommitted", async () => {
      const { patchA, client } = await arrangeInterrupted();
      await act(async () => patchA.release(changed));
      // A's callback ran: its exact settings entry holds the saved version.
      await waitFor(() =>
        expect(
          client.getQueryData<typeof valueB>(
            settingsKey("user-one", "session-one"),
          )?.updatedAt,
        ).toBe(changed.updatedAt),
      );
      expect(
        await screen.findByRole("button", {
          name: translate("common:actions.saved"),
        }),
      ).toBeInTheDocument();
      await act(async () => openGate());
      await waitFor(() => expect(renderedSessions.at(-1)).toBe("session-b"));
    });
  });
});
