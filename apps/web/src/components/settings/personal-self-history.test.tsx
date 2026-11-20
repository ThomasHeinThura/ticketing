import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  capturePersonalSelfHistoryRefresh,
  personalSelfHistoryKey,
} from "@/fetchers/settings/personal-history";
import { PersonalSelfHistory } from "./personal-self-history";

const identity = vi.hoisted(() => ({
  user: "u1",
  session: "s1",
  guard: null as Promise<unknown> | null,
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () =>
      identity.guard ?? {
        data: {
          user: { id: identity.user },
          session: { id: identity.session },
        },
        error: null,
      },
  },
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: {
    getSession: async () =>
      identity.guard ?? {
        data: {
          user: { id: identity.user },
          session: { id: identity.session },
        },
        error: null,
      },
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  identity.user = "u1";
  identity.session = "s1";
  identity.guard = null;
  onlineManager.setOnline(true);
});

function mount(
  section: "security" | "apiKeys",
  audience: "staff" | "portal" = "staff",
  sessionId = "s1",
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  const view = render(
    <QueryClientProvider client={client}>
      <PersonalSelfHistory
        section={section}
        audience={audience}
        userId="u1"
        sessionId={sessionId}
      />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

function historyBody(
  section: "security" | "apiKeys",
  category: "password" | "personalKey",
) {
  return JSON.stringify({
    section,
    lastChanged: { actor: "you", at: "2026-01-01T00:00:00Z" },
    rows: [
      {
        actor: "you",
        at: "2026-01-01T00:00:00Z",
        changedCategories: [category],
      },
    ],
  });
}

it.each([
  ["security", "staff", "password", "settings:history.securityPassword"],
  ["security", "portal", "password", "settings:history.securityPassword"],
  ["apiKeys", "staff", "personalKey", "settings:history.personalKey"],
] as const)(
  "withholds same-mount %s %s History after a captured write until a fresh read",
  async (section, audience, category, label) => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(historyBody(section, category), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { client } = mount(section, audience);
    await screen.findByText("settings:history.lastChanged");
    fireEvent.click(
      screen.getByRole("button", { name: "settings:history.title" }),
    );
    await screen.findByText(label);
    const key = personalSelfHistoryKey(section, audience, "u1", "s1");
    const otherSessionKey = personalSelfHistoryKey(
      section,
      audience,
      "u1",
      "s2",
    );
    client.setQueryData(otherSessionKey, { marker: "other-session" });
    let refuse!: (result: {
      data: { user: { id: string }; session: { id: string } };
      error: null;
    }) => void;
    identity.guard = new Promise((resolve) => {
      refuse = resolve;
    });

    const refresh = capturePersonalSelfHistoryRefresh(
      client,
      section,
      audience,
      {
        user: { id: "u1" },
        session: { id: "s1" },
      },
    );
    expect(refresh()).toBeUndefined();
    await waitFor(() =>
      expect(screen.queryByText("settings:history.lastChanged")).toBeNull(),
    );
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();
    expect(client.getQueryData(key)).toBeNull();
    expect(client.getQueryData(otherSessionKey)).toEqual({
      marker: "other-session",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    await act(async () => {
      refuse({
        data: { user: { id: "other" }, session: { id: "s2" } },
        error: null,
      });
      await identity.guard;
    });
    expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);

    identity.guard = null;
    await client.invalidateQueries({ queryKey: key });
    await screen.findByText("settings:history.lastChanged");
    expect(screen.getByText(label)).toBeInTheDocument();
  },
);

// Fourth correction: a transient failure of the post-write session guard must reach the query's
// error state and the existing Retry control, and Retry must run the real guard and read again.
it.each([
  ["security", "staff", "password", "settings:history.securityPassword"],
  ["security", "portal", "password", "settings:history.securityPassword"],
  ["apiKeys", "staff", "personalKey", "settings:history.personalKey"],
] as const)(
  "shows an error and a working Retry when the post-write session guard fails transiently (%s %s)",
  async (section, audience, category, label) => {
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(historyBody(section, category), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const { client } = mount(section, audience);
    await screen.findByText("settings:history.lastChanged");
    fireEvent.click(
      screen.getByRole("button", { name: "settings:history.title" }),
    );
    await screen.findByText(label);
    const key = personalSelfHistoryKey(section, audience, "u1", "s1");

    // The write confirms while the fresh session check is briefly unavailable (5xx).
    identity.guard = Promise.resolve({ data: null, error: { status: 503 } });
    capturePersonalSelfHistoryRefresh(client, section, audience, {
      user: { id: "u1" },
      session: { id: "s1" },
    })();
    // Cached metadata is withheld at once, and the failure is visible with a Retry.
    expect(client.getQueryData(key)).toBeNull();
    await screen.findByRole("alert");
    expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();
    // The refused guard never reached the network.
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The user clicks Retry: the real guard and the real read run again and recover.
    identity.guard = null;
    fireEvent.click(
      screen.getByRole("button", { name: "settings:history.retry" }),
    );
    await screen.findByText("settings:history.lastChanged");
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

it.each([
  ["security", "staff", "password", 403],
  ["security", "portal", "password", 404],
  ["apiKeys", "staff", "personalKey", 403],
] as const)(
  "withholds cached %s %s %s metadata on remount until fresh admission, including %i denial",
  async (section, audience, category, denial) => {
    let refuse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      refuse = resolve;
    });
    const body = historyBody(section, category);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(new Response(body, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const first = mount(section, audience);
    await screen.findByText("settings:history.lastChanged");
    first.unmount();
    const key = personalSelfHistoryKey(section, audience, "u1", "s1");
    await first.client.invalidateQueries({
      queryKey: key,
      refetchType: "none",
    });

    mount(section, audience, "s1", first.client);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const button = screen.getByRole("button", {
      name: "settings:history.title",
    });
    fireEvent.click(button);
    const label = `settings:history.${category === "password" ? "securityPassword" : "personalKey"}`;
    expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();

    refuse(new Response(null, { status: denial }));
    await screen.findByRole("alert");
    expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();
    expect(first.client.getQueryData(key)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "settings:history.retry" }),
    );
    await screen.findByText("settings:history.lastChanged");
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01T00:00:00Z/)).toBeInTheDocument();
  },
);

it("withholds cached security metadata while an offline remount is paused", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(historyBody("security", "password"), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  const first = mount("security");
  await screen.findByText("settings:history.lastChanged");
  first.unmount();
  onlineManager.setOnline(false);
  const key = personalSelfHistoryKey("security", "staff", "u1", "s1");
  await first.client.invalidateQueries({ queryKey: key, refetchType: "none" });
  const second = mount("security", "staff", "s1", first.client);
  expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  second.unmount();
  first.client.clear();
});

it("withholds cached security metadata during and after a transient refetch error", async () => {
  let fail!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    fail = resolve;
  });
  const body = historyBody("security", "password");
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(body, { status: 200 }))
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  mount("security");
  await screen.findByText("settings:history.lastChanged");
  fireEvent.click(
    screen.getByRole("button", { name: "settings:history.title" }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
  expect(screen.queryByText("settings:history.securityPassword")).toBeNull();
  expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();
  fail(new Response(null, { status: 500 }));
  await screen.findByRole("alert");
  expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
  expect(screen.queryByText("settings:history.securityPassword")).toBeNull();
  expect(screen.queryByText(/2026-01-01T00:00:00Z/)).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "settings:history.retry" }),
  );
  await screen.findByText("settings:history.lastChanged");
  expect(
    screen.getByText("settings:history.securityPassword"),
  ).toBeInTheDocument();
});

it.each([
  ["security", "staff", "password", "settings:history.securityPassword"],
  ["security", "portal", "password", "settings:history.securityPassword"],
  ["apiKeys", "staff", "personalKey", "settings:history.personalKey"],
] as const)(
  "renders only closed %s %s metadata",
  async (section, audience, category, label) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            section,
            lastChanged: { actor: "you", at: "2026-01-01T00:00:00Z" },
            rows: [
              {
                actor: "you",
                at: "2026-01-01T00:00:00Z",
                changedCategories: [category],
                keyId: "hidden-id",
                keyName: "hidden-name",
                secret: "hidden-secret",
                ip: "hidden-ip",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    mount(section, audience);
    const button = await screen.findByRole("button", {
      name: "settings:history.title",
    });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
    fireEvent.click(button);
    await screen.findByText(label);
    expect(screen.queryByText(/hidden-/)).toBeNull();
  },
);

it("never requests portal API-key history or history without a session", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  mount("apiKeys", "portal");
  mount("security", "staff", "");
  expect(fetcher).not.toHaveBeenCalled();
});

it("clears refused rows and permits retry", async () => {
  const body = JSON.stringify({
    section: "security",
    lastChanged: null,
    rows: [],
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(body, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(body, { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const { client } = mount("security");
  await screen.findByText("settings:history.empty");
  await client.invalidateQueries({
    queryKey: personalSelfHistoryKey("security", "staff", "u1", "s1"),
  });
  await screen.findByRole("alert");
  expect(
    client.getQueryData(
      personalSelfHistoryKey("security", "staff", "u1", "s1"),
    ),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "settings:history.retry" }),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("rejects a late obsolete response after identity changes", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const { client } = mount("security");
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  identity.session = "s2";
  finish(
    new Response(
      JSON.stringify({
        section: "security",
        lastChanged: null,
        rows: [
          {
            actor: "you",
            at: "2026-01-01T00:00:00Z",
            changedCategories: ["password"],
          },
        ],
      }),
      { status: 200 },
    ),
  );
  await screen.findByRole("alert");
  expect(
    client.getQueryData(
      personalSelfHistoryKey("security", "staff", "u1", "s1"),
    ),
  ).toBeNull();
  expect(screen.queryByText("settings:history.securityPassword")).toBeNull();
});
