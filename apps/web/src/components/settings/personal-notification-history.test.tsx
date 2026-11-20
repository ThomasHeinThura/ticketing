import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalNotificationHistory } from "./personal-notification-history";

const identity = vi.hoisted(() => ({ user: "u1", session: "s1" }));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () => ({
      data: { user: { id: identity.user }, session: { id: identity.session } },
      error: null,
    }),
  },
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: {
    getSession: async () => ({
      data: { user: { id: identity.user }, session: { id: identity.session } },
      error: null,
    }),
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
});
const empty = () =>
  new Response(
    JSON.stringify({ section: "notifications", lastChanged: null, rows: [] }),
    { status: 200 },
  );
function mount(audience: "staff" | "portal" = "staff") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PersonalNotificationHistory
        audience={audience}
        userId="u1"
        sessionId="s1"
      />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
it("waits for a session before fetching history", async () => {
  const fetcher = vi.fn().mockResolvedValue(empty());
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PersonalNotificationHistory audience="staff" userId="u1" />
    </QueryClientProvider>,
  );
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(
    <QueryClientProvider client={client}>
      <PersonalNotificationHistory
        audience="staff"
        userId="u1"
        sessionId="s1"
      />
    </QueryClientProvider>,
  );
  await screen.findByText("settings:history.empty");
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each(["staff", "portal"] as const)(
  "shows closed %s history and keyboard disclosure",
  async (audience) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            section: "notifications",
            lastChanged: { actor: "you", at: "2026-01-01T00:00:00Z" },
            rows: [
              {
                actor: "you",
                at: "2026-01-01T00:00:00Z",
                changedCategories: ["delivery", "digest"],
                value: "secret",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    mount(audience);
    const button = await screen.findByRole("button", {
      name: "settings:history.title",
    });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter", code: "Enter" });
    fireEvent.click(button);
    await screen.findByText(
      "settings:history.notificationDelivery, settings:history.notificationDigest",
    );
    expect(screen.queryByText("secret")).toBeNull();
  },
);
it("clears denied cached rows and retries", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(empty())
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(empty());
  vi.stubGlobal("fetch", fetcher);
  const { client } = mount();
  await screen.findByText("settings:history.empty");
  await client.invalidateQueries({ queryKey: ["personal-settings-history"] });
  await screen.findByRole("alert");
  expect(
    client.getQueryData([
      "personal-settings-history",
      window.location.host,
      "notifications",
      "staff",
      "u1",
      "s1",
    ]),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "settings:history.retry" }),
  );
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it.each(["staff", "portal"] as const)(
  "does not expose an obsolete %s response after a session switch",
  async (audience) => {
    let finish!: (response: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(empty());
    vi.stubGlobal("fetch", fetcher);
    const { client, rerender } = mount(audience);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    identity.user = "u2";
    identity.session = "s2";
    rerender(
      <QueryClientProvider client={client}>
        <PersonalNotificationHistory
          audience={audience}
          userId="u2"
          sessionId="s2"
        />
      </QueryClientProvider>,
    );
    await screen.findByText("settings:history.empty");
    finish(
      new Response(
        JSON.stringify({
          section: "notifications",
          lastChanged: { actor: "you", at: "2020-01-01T00:00:00Z" },
          rows: [],
        }),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(screen.queryByText(/2020-01-01/)).toBeNull());
  },
);
