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
import { type ComponentType, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./account";

const mocks = vi.hoisted(() => ({
  change: vi.fn(),
  success: vi.fn(),
  history: vi.fn(),
  audited: vi.fn(),
  historyDenied: false,
  client: null as QueryClient | null,
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useRouteContext: () => ({ portalUserId: "customer" }),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/i18n/portal-translation", () => ({
  usePortalTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/account/portal-canonical-preferences", () => ({
  PortalCanonicalPreferencesPage: ({ history }: { history: React.ReactNode }) =>
    history,
}));
vi.mock("@/components/settings/settings-history", () => ({
  SettingsHistory: (props: unknown) => {
    mocks.history(props);
    return mocks.historyDenied ? <p role="alert">History unavailable</p> : null;
  },
}));
vi.mock("@/components/portal/portal-page-title", () => ({
  PortalPageTitle: () => null,
}));
vi.mock("@/lib/toast", () => ({ toast: { success: mocks.success } }));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { $fetch: mocks.change },
}));
const Page = (Route as unknown as { component: ComponentType }).component;
function Account() {
  const [client] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onSuccess: (data, variables, _context, mutation) =>
            mocks.audited(
              mutation.meta?.audits?.targets(variables as never, data as never),
            ),
        }),
      }),
  );
  mocks.client = client;
  return (
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}

function status(hasLocalPassword: boolean) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ hasLocalPassword }), { status: 200 }),
      ),
  );
}
function fillAndSubmit() {
  fireEvent.change(
    screen.getByLabelText("auth:changePassword.currentPassword"),
    { target: { value: "current-password" } },
  );
  fireEvent.change(screen.getByLabelText("auth:changePassword.newPassword"), {
    target: { value: "new-password" },
  });
  fireEvent.change(
    screen.getByLabelText("auth:changePassword.confirmPassword"),
    { target: { value: "new-password" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "auth:changePassword.submit" }),
  );
}
beforeEach(() => {
  mocks.change.mockReset();
  mocks.success.mockReset();
  mocks.history.mockReset();
  mocks.audited.mockReset();
  mocks.historyDenied = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("portal account password section", () => {
  it("mounts portal notification and security history by target only", async () => {
    status(false);
    render(<Account />);
    await waitFor(() =>
      expect(mocks.history).toHaveBeenCalledWith({
        target: { kind: "self", audience: "portal", section: "security" },
      }),
    );
    expect(mocks.history).toHaveBeenCalledWith({
      target: { kind: "self", audience: "portal", section: "notifications" },
    });
  });
  it("hides for SSO-only accounts", async () => {
    status(false);
    render(<Account />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: "auth:changePassword.submit" }),
    ).toBeNull();
  });
  it("sends the current user's change to portal auth and reports wrong passwords", async () => {
    status(true);
    mocks.change.mockResolvedValueOnce({ error: { code: "INVALID_PASSWORD" } });
    render(<Account />);
    await screen.findByRole("button", { name: "auth:changePassword.submit" });
    fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "auth:changePassword.wrongCurrent",
    );
    expect(mocks.change).toHaveBeenCalledWith("/change-password", {
      method: "POST",
      body: {
        currentPassword: "current-password",
        newPassword: "new-password",
        revokeOtherSessions: true,
      },
    });
    expect(mocks.audited).not.toHaveBeenCalled();
  });
  it("clears the fields and shows a toast after success", async () => {
    status(true);
    mocks.change.mockResolvedValueOnce({ data: {}, error: null });
    render(<Account />);
    await screen.findByRole("button", { name: "auth:changePassword.submit" });
    fillAndSubmit();
    await waitFor(() =>
      expect(
        screen.getByLabelText("auth:changePassword.currentPassword"),
      ).toHaveValue(""),
    );
    expect(mocks.success).toHaveBeenCalled();
    expect(mocks.audited).toHaveBeenCalledWith([
      { kind: "self", audience: "portal", section: "security" },
    ]);
  });

  it("keeps an authorized password save working while History is denied", async () => {
    mocks.historyDenied = true;
    status(true);
    mocks.change.mockResolvedValueOnce({ data: {}, error: null });
    render(<Account />);
    await screen.findByRole("button", { name: "auth:changePassword.submit" });
    fillAndSubmit();
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
    expect(await screen.findAllByText("History unavailable")).not.toHaveLength(
      0,
    );
  });
});

it("does not retain passwords in the mutation cache after saving", async () => {
  status(true);
  mocks.change.mockResolvedValue({ error: null });
  render(<Account />);
  await screen.findByLabelText("auth:changePassword.currentPassword");
  fillAndSubmit();
  await waitFor(() => expect(mocks.change).toHaveBeenCalled());
  await waitFor(() =>
    expect(mocks.client?.getMutationCache().getAll()[0]?.state.status).toBe(
      "success",
    ),
  );
  const cache = JSON.stringify(
    mocks.client
      ?.getMutationCache()
      .getAll()
      .map((mutation) => ({ state: mutation.state, meta: mutation.meta })),
  );
  expect(cache).not.toContain("current-password");
  expect(cache).not.toContain("new-password");
});
