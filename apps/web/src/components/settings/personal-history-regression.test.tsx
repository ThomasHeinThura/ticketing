import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  captureNotificationHistoryRefresh,
  capturePreferencesHistoryRefresh,
  profileHistoryKey,
  refreshPersonalHistory,
} from "@/fetchers/settings/personal-history";
import { PersonalNotificationHistory } from "./personal-notification-history";
import { PersonalPreferencesHistory } from "./personal-preferences-history";
import { PersonalProfileHistory } from "./personal-profile-history";
import { PersonalSelfHistory } from "./personal-self-history";

const session = vi.hoisted(() => ({ fail: false }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u" }, session: { id: "s" } } }),
    getSession: async () =>
      session.fail
        ? { data: null, error: { status: 503 } }
        : { data: { user: { id: "u" }, session: { id: "s" } }, error: null },
  },
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: {
    getSession: async () =>
      session.fail
        ? { data: null, error: { status: 503 } }
        : { data: { user: { id: "u" }, session: { id: "s" } }, error: null },
  },
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
afterEach(() => {
  session.fail = false;
  vi.unstubAllGlobals();
});

const cases = [
  [
    "notifications",
    <PersonalNotificationHistory
      key="notifications"
      audience="portal"
      userId="u"
      sessionId="s"
    />,
  ],
  ["preferences", <PersonalPreferencesHistory key="preferences" userId="u" />],
  ["profile", <PersonalProfileHistory key="profile" userId="u" />],
  [
    "security",
    <PersonalSelfHistory
      key="security"
      section="security"
      audience="staff"
      userId="u"
      sessionId="s"
    />,
  ],
] as const;
it.each(cases)(
  "refetches %s on remount with production query defaults",
  async (section, component) => {
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            section,
            lastChanged: { actor: "you", at: "2026-01-01T00:00:00Z" },
            rows: [],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnMount: false,
          staleTime: Number.POSITIVE_INFINITY,
        },
      },
    });
    const view = () => (
      <QueryClientProvider client={client}>{component}</QueryClientProvider>
    );
    const first = render(view());
    await screen.findByText("settings:history.lastChanged");
    first.unmount();
    const second = render(view());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await screen.findByText("settings:history.lastChanged");
    second.unmount();
    client.clear();
  },
);
it.each(cases.slice(0, 3))(
  "clears %s after save and exposes guard failure and retry",
  async (section, component) => {
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            section,
            lastChanged: { actor: "you", at: "2026-01-01T00:00:00Z" },
            rows: [],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>{component}</QueryClientProvider>,
    );
    await screen.findByText("settings:history.lastChanged");
    session.fail = true;
    const identity = { user: { id: "u" }, session: { id: "s" } };
    if (section === "notifications")
      captureNotificationHistoryRefresh(client, "portal", identity)();
    if (section === "preferences")
      capturePreferencesHistoryRefresh(client, identity)();
    if (section === "profile")
      refreshPersonalHistory(client, profileHistoryKey("u", "s"));
    await screen.findByRole("alert");
    expect(screen.queryByText("settings:history.lastChanged")).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
    session.fail = false;
    fireEvent.click(
      screen.getByRole("button", { name: "settings:history.retry" }),
    );
    await screen.findByText("settings:history.lastChanged");
    view.unmount();
    client.clear();
  },
);
