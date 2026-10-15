import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import { renderWithQuery, staffConnection } from "@/test/identity-test-harness";
import { Route } from "./authentication";

const mocks = vi.hoisted(() => ({
  admin: true,
  list: vi.fn(),
  pathname: "/agent/god-mode/authentication",
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    fullPath: "/agent/god-mode/authentication",
  }),
  useLocation: () => ({ pathname: mocks.pathname }),
  Outlet: () => <div data-testid="outlet" />,
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
vi.mock("@/fetchers/god-mode/identity-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/identity-connections")
  >()),
  getIdentityConnections: (...args: unknown[]) => mocks.list(...args),
}));

const Component = (
  Route as unknown as { options: { component: React.ComponentType } }
).options.component;

beforeEach(() => {
  mocks.admin = true;
  mocks.pathname = "/agent/god-mode/authentication";
  mocks.list.mockResolvedValue([
    staffConnection,
    {
      ...staffConnection,
      id: "conn-2",
      displayName: "Contoso customers",
      portalScope: "customer",
      organisationId: "org-1",
      enabled: true,
    },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Authentication providers list", () => {
  it("shows a loading state, then staff and customer connections", async () => {
    renderWithQuery(<Component />);
    expect(
      screen.getByRole("status", { name: "Loading authentication providers" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Staff Entra")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Authentication providers" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add Entra connection" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Manage settings" }),
    ).toBeInTheDocument();
  });

  it("does not offer customer connections for editing here and points to the organisation Identity tab", async () => {
    renderWithQuery(<Component />);
    await screen.findByText("Contoso customers");
    expect(
      screen.getByText(
        "Customer connections are configured from the organisation's Identity tab.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Manage settings" }),
    ).toHaveLength(1);
    expect(screen.getByRole("link", { name: "View" })).toBeInTheDocument();
  });

  it("shows an empty state with the add action", async () => {
    mocks.list.mockResolvedValue([]);
    renderWithQuery(<Component />);
    expect(
      await screen.findByText("No authentication providers"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Add Entra connection" }),
    ).toBeInTheDocument();
  });

  it("denies a non-administrator without a retry or an add action", async () => {
    mocks.list.mockRejectedValue(
      new IdentityAdminError(403, "x", "Forbidden", null),
    );
    renderWithQuery(<Component />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Add Entra connection" }),
    ).toBeNull();
  });

  it("reports an invalid stored configuration (503) and offers a retry", async () => {
    mocks.list.mockRejectedValue(new IdentityAdminError(503, "x", "", null));
    renderWithQuery(<Component />);
    expect(
      await screen.findByText(
        /stored identity configuration is invalid/u,
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders only the child route under the detail path", () => {
    mocks.pathname = "/agent/god-mode/authentication/conn-1";
    renderWithQuery(<Component />);
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Authentication providers" }),
    ).toBeNull();
  });

  it("never reads or renders anything for a session without the instance-admin signal", async () => {
    mocks.admin = false;
    renderWithQuery(<Component />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "Add Entra connection" }),
    ).toBeNull();
    expect(screen.queryByText("Staff Entra")).toBeNull();
  });
});
