import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityAdminError } from "@/fetchers/god-mode/identity-admin-error";
import { renderWithQuery, staffConnection } from "@/test/identity-test-harness";
import { Route } from "./identity";

const mocks = vi.hoisted(() => ({
  admin: true,
  read: vi.fn(),
  visibilityRead: vi.fn(),
  navigate: vi.fn(),
  params: { id: "org-1" },
  search: {} as Record<string, string | undefined>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: React.ComponentType }) => ({
    options,
    fullPath: "/agent/god-mode/organisations/$id/identity",
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
  getCurrentFactorStatus: async () => ({
    enabled: false,
    required: false,
    availableMethods: ["password"],
  }),
}));
vi.mock("@/fetchers/god-mode/identity-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/fetchers/god-mode/identity-connections")
  >()),
  getOrganisationIdentityConnection: (...args: unknown[]) =>
    mocks.read(...args),
  getScimAdminSettings: () => new Promise(() => {}),
  getIdentityConnectionEvents: () => new Promise(() => {}),
}));
vi.mock(
  "@/fetchers/god-mode/organisation-customer-visibility",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/fetchers/god-mode/organisation-customer-visibility")
    >()),
    getOrganisationCustomerVisibility: (...args: unknown[]) =>
      mocks.visibilityRead(...args),
  }),
);

const Component = (
  Route as unknown as { options: { component: React.ComponentType } }
).options.component;

const customerConnection = {
  ...staffConnection,
  id: "conn-c",
  displayName: "Acme SSO",
  portalScope: "customer" as const,
  organisationId: "org-1",
  defaultWorkspaceId: null,
  maxRoleRank: null,
};

beforeEach(() => {
  mocks.admin = true;
  mocks.params = { id: "org-1" };
  mocks.search = {};
  mocks.read.mockResolvedValue(customerConnection);
  mocks.visibilityRead.mockResolvedValue({
    organisationId: "org-1",
    defaultCustomerVisibility: "organisation",
    updatedAt: "2026-10-25T10:00:00.000Z",
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Organisation Identity tab (CP-17, IP-5)", () => {
  it("reads the connection bound to the organisation and shows the shared editor", async () => {
    renderWithQuery(<Component />);
    expect(
      await screen.findByRole("tab", { name: "Connection", selected: true }),
    ).toBeInTheDocument();
    expect(mocks.read).toHaveBeenCalledWith("org-1");
    expect(mocks.visibilityRead).toHaveBeenCalledWith("org-1");
    expect(await screen.findByText("Request visibility")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Default visibility for new requests"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Connection name")).toHaveValue("Acme SSO");
    // A customer connection has no workspace and no role ceiling.
    expect(screen.queryByLabelText("Default workspace ID")).toBeNull();
    expect(screen.queryByLabelText("Maximum role rank")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "SCIM provisioning" }),
    ).toBeInTheDocument();
  });

  it("keeps the selected tab in the URL", async () => {
    renderWithQuery(<Component />);
    fireEvent.click(
      await screen.findByRole("tab", { name: "SCIM provisioning" }),
    );
    const call = mocks.navigate.mock.calls[0]?.[0] as { search: () => unknown };
    expect(call.search()).toEqual({ tab: "scim" });
  });

  it("offers a customer create form when the organisation has no connection yet", async () => {
    mocks.read.mockResolvedValue(null);
    renderWithQuery(<Component />);
    expect(
      await screen.findByRole("button", { name: "Create disabled connection" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Default workspace ID")).toBeNull();
    expect(screen.queryByLabelText("Maximum role rank")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("says so for an unknown organisation", async () => {
    mocks.read.mockRejectedValue(
      new IdentityAdminError(404, "x", "Not found", null),
    );
    renderWithQuery(<Component />);
    expect(
      await screen.findByText("Organisation not found"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection name")).toBeNull();
  });

  it("denies a non-administrator without reading anything", async () => {
    mocks.admin = false;
    renderWithQuery(<Component />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.visibilityRead).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Connection name")).toBeNull();
  });
});
