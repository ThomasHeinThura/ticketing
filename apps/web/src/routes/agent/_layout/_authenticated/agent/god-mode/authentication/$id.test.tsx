import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import { renderWithQuery, staffConnection } from "@/test/identity-test-harness";
import { Route } from "./$id";

const mocks = vi.hoisted(() => ({
  admin: true,
  list: vi.fn(),
  navigate: vi.fn(),
  params: { id: "conn-1" },
  search: {} as Record<string, string | undefined>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    fullPath: "/agent/god-mode/authentication/$id",
    useParams: () => mocks.params,
    useSearch: () => mocks.search,
  }),
  useNavigate: () => mocks.navigate,
  Link: ({
    children,
    params: _params,
    to: _to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    to?: string;
  }) => (
    <a href="/link" {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-instance-admin-signal", () => ({
  useInstanceAdminSignal: () => mocks.admin,
}));
vi.mock("react-i18next", async () => {
  const { translate } = await import("@/test/en-translation");
  return {
    useTranslation: (namespace: string) => ({
      t: (key: string, options?: Record<string, unknown>) =>
        translate(`${namespace}:${key}`, options),
      i18n: { language: "en-US" },
    }),
  };
});
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: async () => ({ enabled: false }),
}));
vi.mock("@/fetchers/god-mode/identity-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/identity-connections")
  >()),
  getIdentityConnections: (...args: unknown[]) => mocks.list(...args),
  getScimAdminSettings: () => new Promise(() => {}),
  getIdentityConnectionEvents: () => new Promise(() => {}),
}));

const Component = (
  Route as unknown as { options: { component: React.ComponentType } }
).options.component;

beforeEach(() => {
  mocks.admin = true;
  mocks.params = { id: "conn-1" };
  mocks.search = {};
  mocks.list.mockResolvedValue([staffConnection]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Provider editor route", () => {
  it("shows a loading state and then the connection tabs with the connection tab open", async () => {
    renderWithQuery(<Component />);
    expect(
      screen.getByRole("status", { name: "Loading authentication provider" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Staff Entra", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Connection", selected: true }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Connection name")).toHaveValue("Staff Entra");
  });

  it("encodes the selected tab in the URL instead of local state", async () => {
    renderWithQuery(<Component />);
    await screen.findByRole("tab", { name: "SCIM provisioning" });
    fireEvent.click(screen.getByRole("tab", { name: "SCIM provisioning" }));
    const call = mocks.navigate.mock.calls[0]?.[0] as { search: () => unknown };
    expect(call.search()).toEqual({ tab: "scim" });
    fireEvent.click(screen.getByRole("tab", { name: "Provisioning history" }));
    expect(
      (mocks.navigate.mock.calls[1] as [{ search: () => unknown }])[0].search(),
    ).toEqual({ tab: "events" });
  });

  it("opens the tab named by the URL", async () => {
    mocks.search = { tab: "events" };
    renderWithQuery(<Component />);
    expect(
      await screen.findByRole("tab", {
        name: "Provisioning history",
        selected: true,
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("status", {
        name: "Loading provisioning history",
      }),
    ).toBeInTheDocument();
  });

  it("does not offer an editor for a customer connection", async () => {
    mocks.list.mockResolvedValue([
      { ...staffConnection, portalScope: "customer", organisationId: "org-1" },
    ]);
    renderWithQuery(<Component />);
    expect(
      await screen.findByText("Managed from the organisation"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection name")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("explains an unknown connection id", async () => {
    mocks.params = { id: "missing" };
    renderWithQuery(<Component />);
    expect(await screen.findByText("Connection not found")).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection name")).toBeNull();
  });

  it("denies a non-administrator", async () => {
    mocks.list.mockRejectedValue(
      new IdentityAdminError(403, "x", "Forbidden", null),
    );
    renderWithQuery(<Component />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
  });

  it("opens the create form for the id new without reading any connection", async () => {
    mocks.params = { id: "new" };
    renderWithQuery(<Component />);
    expect(
      await screen.findByRole("heading", {
        name: "Add Entra connection",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create disabled connection" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("does not show the create form or read anything before the server could deny a non-administrator", async () => {
    mocks.admin = false;
    mocks.params = { id: "new" };
    renderWithQuery(<Component />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection name")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create disabled connection" }),
    ).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("does not show an existing connection to a non-administrator either", async () => {
    mocks.admin = false;
    renderWithQuery(<Component />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection name")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
