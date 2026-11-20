import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { PersonalProfileHistory } from "./personal-profile-history";

const mock = vi.hoisted(() => ({
  get: vi.fn(),
  guard: vi.fn().mockResolvedValue(undefined),
  identity: { id: "u1", session: "s1" },
}));
vi.mock("@/fetchers/settings/personal-history", () => ({
  getProfileHistory: mock.get,
  assertNotificationHistorySession: mock.guard,
  profileHistoryKey: (user: string, session: string) => [
    "personal-settings-history",
    window.location.host,
    "profile",
    user,
    session,
  ],
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

it("clears refused history rather than displaying cached rows", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.get
    .mockResolvedValueOnce({ section: "profile", lastChanged: null, rows: [] })
    .mockRejectedValueOnce(new HttpError(403, "refused"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PersonalProfileHistory userId="u1" />
    </QueryClientProvider>,
  );
  await screen.findByText("settings:history.empty");
  await client.invalidateQueries({ queryKey: ["personal-settings-history"] });
  await screen.findByRole("alert");
  expect(
    client.getQueryData([
      "personal-settings-history",
      window.location.host,
      "profile",
      "u1",
      "s1",
    ]),
  ).toBeNull();
});

it("does not display a late response from another identity", async () => {
  mock.identity = { id: "u1", session: "s1" };
  let resolve!: (value: unknown) => void;
  mock.get
    .mockReset()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce({ section: "profile", lastChanged: null, rows: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <PersonalProfileHistory userId="u1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mock.get).toHaveBeenCalledTimes(1));
  mock.identity = { id: "u2", session: "s2" };
  view.rerender(
    <QueryClientProvider client={client}>
      <PersonalProfileHistory userId="u2" />
    </QueryClientProvider>,
  );
  await screen.findByText("settings:history.empty");
  resolve({
    section: "profile",
    lastChanged: { at: "old", actor: "you" },
    rows: [],
  });
  await waitFor(() => expect(screen.queryByText(/old/)).toBeNull());
});
it("ignores a cancelled old denial after the replacement succeeds", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.get.mockReset();
  let denyOld!: (error: Error) => void;
  mock.get
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          denyOld = reject;
        }),
    )
    .mockResolvedValueOnce({ section: "profile", lastChanged: null, rows: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PersonalProfileHistory userId="u1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mock.get).toHaveBeenCalledOnce());
  const key = [
    "personal-settings-history",
    window.location.host,
    "profile",
    "u1",
    "s1",
  ];
  const { refreshSettingsHistory } = await import("./refresh-settings-history");
  refreshSettingsHistory(client, key, async () => {});
  await screen.findByText("settings:history.empty");
  denyOld(new HttpError(403, "old refusal"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.getQueryData(key)).toMatchObject({ section: "profile" });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("refuses a changed session before reading profile history", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.get.mockReset();
  mock.guard.mockRejectedValueOnce(new HttpError(403, "Session changed"));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PersonalProfileHistory userId="u1" />
    </QueryClientProvider>,
  );
  await screen.findByRole("alert");
  expect(mock.get).not.toHaveBeenCalled();
});

it("hides profile history while a disclosure read is pending", async () => {
  mock.identity = { id: "u1", session: "s1" };
  let resolve!: (value: unknown) => void;
  mock.get
    .mockReset()
    .mockResolvedValueOnce({ section: "profile", lastChanged: null, rows: [] })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PersonalProfileHistory userId="u1" />
    </QueryClientProvider>,
  );
  await screen.findByText("settings:history.empty");
  const { fireEvent } = await import("@testing-library/react");
  fireEvent.click(
    screen.getByRole("button", { name: "settings:history.title" }),
  );
  await waitFor(() =>
    expect(screen.queryByText("settings:history.empty")).toBeNull(),
  );
  resolve({ section: "profile", lastChanged: null, rows: [] });
  await screen.findByText("settings:history.empty");
});
