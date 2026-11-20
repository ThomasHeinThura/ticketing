import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { PersonalPreferencesHistory } from "./personal-preferences-history";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  identity: { id: "u1", session: "s1" },
}));
vi.mock("@/fetchers/settings/personal-history", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/settings/personal-history")
  >()),
  getPreferencesHistory: mock.get,
  preferencesHistoryKey: (user: string, session: string) => [
    "personal-settings-history",
    window.location.host,
    "preferences",
    user,
    session,
  ],
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: async () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
      error: null,
    }),
    useSession: () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
    }),
  },
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

it.each([401, 403, 404])(
  "renders closed field labels and clears current refusal %s",
  async (status) => {
    mock.identity = { id: "u1", session: "s1" };
    mock.get
      .mockReset()
      .mockResolvedValueOnce({
        section: "preferences",
        lastChanged: null,
        rows: [
          {
            at: "2026-01-01",
            actor: "you",
            changedFields: ["density", "layout"],
          },
        ],
      })
      .mockRejectedValueOnce(new HttpError(status, "refused"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <PersonalPreferencesHistory userId="u1" />
      </QueryClientProvider>,
    );
    await screen.findByText("settings:history.empty");
    fireEvent.click(screen.getByRole("button", { name: /History/ }));
    expect(
      screen.getByText(/settings:history.preferenceFields.density/),
    ).toBeTruthy();
    await screen.findByRole("alert");
    expect(
      client.getQueryData([
        "personal-settings-history",
        window.location.host,
        "preferences",
        "u1",
        "s1",
      ]),
    ).toBeNull();
  },
);
it("ignores a cancelled denial after replacement and separates identities", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.get.mockReset();
  let rejectOld!: (e: Error) => void;
  mock.get
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
    )
    .mockResolvedValue({ section: "preferences", lastChanged: null, rows: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PersonalPreferencesHistory userId="u1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mock.get).toHaveBeenCalledOnce());
  const key = [
    "personal-settings-history",
    window.location.host,
    "preferences",
    "u1",
    "s1",
  ];
  const { refreshSettingsHistory } = await import("./refresh-settings-history");
  refreshSettingsHistory(client, key, async () => {});
  await screen.findByText("settings:history.empty");
  rejectOld(new HttpError(403, "old"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.getQueryData(key)).toMatchObject({ section: "preferences" });
  mock.identity = { id: "u2", session: "s2" };
  view.rerender(
    <QueryClientProvider client={client}>
      <PersonalPreferencesHistory userId="u2" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      client.getQueryData([
        "personal-settings-history",
        window.location.host,
        "preferences",
        "u2",
        "s2",
      ]),
    ).toBeTruthy(),
  );
});

beforeEach(() =>
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test"))),
);
afterEach(() => vi.unstubAllGlobals());
it("rejects a response when the cookie session changes during the read", async () => {
  mock.identity = { id: "u1", session: "s1" };
  let finish!: (value: unknown) => void;
  mock.get.mockReset().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PersonalPreferencesHistory userId="u1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mock.get).toHaveBeenCalledOnce());
  mock.identity = { id: "u2", session: "s2" };
  finish({
    section: "preferences",
    lastChanged: null,
    rows: [{ at: "foreign", actor: "you", changedFields: ["density"] }],
  });
  await waitFor(() =>
    expect(
      client.getQueryData([
        "personal-settings-history",
        window.location.host,
        "preferences",
        "u1",
        "s1",
      ]),
    ).toBeNull(),
  );
  expect(screen.queryByText(/foreign/)).toBeNull();
});
