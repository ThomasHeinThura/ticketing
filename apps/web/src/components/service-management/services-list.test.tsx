import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { headingLevels } from "@/test/headings";

const mocks = vi.hoisted(() => ({
  services: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  status: { data: undefined as unknown, isLoading: false, isError: false },
  canCreateProjects: true,
  canManageSettings: false,
  modalProps: vi.fn(),
  servicesWorkspace: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to?: string; children?: React.ReactNode }) => (
    <a href={to ?? "/"}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/team/use-teams", () => ({
  useTeams: () => ({ data: [] }),
}));
vi.mock("@/hooks/queries/service-calendar/use-service-calendars", () => ({
  useServiceCalendars: () => ({ data: { data: [] } }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  serviceManagementKeys: { all: ["service-management"] },
  useCatalogueStatus: () => mocks.status,
  useServices: (workspaceId: string) => {
    mocks.servicesWorkspace(workspaceId);
    return mocks.services;
  },
  isFeatureDisabled: (error: unknown) =>
    error instanceof HttpError && error.status === 409,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canBindProjectOrganisation: () => mocks.canCreateProjects,
    canManageWorkspaceSettings: () => mocks.canManageSettings,
  }),
}));
vi.mock("@/components/shared/modals/create-project-modal", () => ({
  default: (props: { open: boolean; defaultKind?: string }) => {
    mocks.modalProps(props);
    return props.open ? <div data-testid="create-project-modal" /> : null;
  },
}));
vi.mock("@/fetchers/service-management", () => ({
  SUPPORT_LEVELS: ["L1", "L2", "L3"],
  createService: vi.fn(),
}));

import { ServicesList } from "./services-list";

function setup(
  services: Partial<typeof mocks.services>,
  status: Record<string, boolean> = {},
) {
  Object.assign(mocks.services, {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...services,
  });
  mocks.status.data = {
    enabled: true,
    canManageServices: true,
    canManageChanges: false,
    canManageReleases: false,
    ...status,
  };
  mocks.status.isLoading = false;
  mocks.status.isError = false;
  const client = new QueryClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ServicesList />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  cleanup();
  mocks.canCreateProjects = true;
  mocks.canManageSettings = false;
  mocks.modalProps.mockClear();
});

const service = (overrides: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "Checkout API",
  ownerTeamName: "Platform",
  supportLevel: "L2",
  status: "degraded",
  incidentCount: 3,
  openChangeCount: 1,
  ...overrides,
});

describe("ServicesList", () => {
  it("lists services with their owner, status and counts (SVC-1, SVC-3, SVC-4)", () => {
    setup({
      data: [
        service(),
        service({ id: "s2", name: "Search", status: "outage" }),
      ],
    });
    expect(screen.getByText("Checkout API")).toBeTruthy();
    expect(screen.getByText("status.degraded")).toBeTruthy();
    expect(screen.getByText("status.outage")).toBeTruthy();
    expect(screen.getAllByText(/services.list.incidents/u).length).toBe(2);
  });

  it("offers creation only to someone who manages services", () => {
    setup({ data: [service()] });
    expect(
      screen.getByRole("button", { name: /services.list.new/u }),
    ).toBeTruthy();
    cleanup();
    setup({ data: [service()] }, { canManageServices: false });
    expect(
      screen.queryByRole("button", { name: /services.list.new/u }),
    ).toBeNull();
  });

  it("explains an empty catalogue", () => {
    setup({ data: [] });
    expect(screen.getByText("services.list.emptyTitle")).toBeTruthy();
  });

  it("says the feature is off instead of showing an error", () => {
    setup({
      isError: true,
      error: new HttpError(409, "feature_disabled"),
    });
    expect(screen.getByText("disabled.title")).toBeTruthy();
    expect(screen.queryByText("common.retry")).toBeNull();
  });

  it("offers a retry for any other failure", () => {
    setup({ isError: true, error: new HttpError(500, "boom") });
    expect(screen.getByText("common.loadErrorTitle")).toBeTruthy();
    expect(screen.getByRole("button", { name: /common.retry/u })).toBeTruthy();
  });

  it("explains that the catalogue is not where customers are supported", () => {
    setup({ data: [] });
    expect(screen.getByText("services.list.catalogueDescription")).toBeTruthy();
  });

  it("opens the create-project modal preset to a managed service (S5)", async () => {
    setup({ data: [service()] }, { canManageServices: false });
    fireEvent.click(
      screen.getByRole("button", {
        name: "services.list.createManagedService",
      }),
    );
    expect(await screen.findByTestId("create-project-modal")).toBeTruthy();
    expect(mocks.modalProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, defaultKind: "managed_service" }),
    );
  });

  it("hides the managed-service action without project:create", () => {
    mocks.canCreateProjects = false;
    setup({ data: [service()] });
    expect(
      screen.queryByRole("button", {
        name: "services.list.createManagedService",
      }),
    ).toBeNull();
  });

  it("offers no create action while catalogue status is unresolved or resolves off", () => {
    mocks.status.data = undefined;
    mocks.status.isLoading = true;
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <ServicesList />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("create-managed-service")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /services.list.new/u }),
    ).toBeNull();

    mocks.status.data = { enabled: false, canManageServices: true };
    mocks.status.isLoading = false;
    view.rerender(
      <QueryClientProvider client={client}>
        <ServicesList />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("create-managed-service")).toBeNull();
    expect(screen.getByTestId("service-catalogue-off")).toBeInTheDocument();
  });

  it("closes a managed-service dialog when the catalogue switches off", async () => {
    const { client, rerender } = setup({ data: [service()] });
    fireEvent.click(screen.getByTestId("create-managed-service"));
    expect(
      await screen.findByTestId("create-project-modal"),
    ).toBeInTheDocument();

    mocks.status.data = { enabled: false, canManageServices: true };
    rerender(
      <QueryClientProvider client={client}>
        <ServicesList />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("create-project-modal")).toBeNull();
    expect(screen.queryByTestId("create-managed-service")).toBeNull();

    mocks.status.data = { enabled: true, canManageServices: true };
    rerender(
      <QueryClientProvider client={client}>
        <ServicesList />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("create-project-modal")).toBeNull();
  });
});

describe("ServicesList with the catalogue off (UAT re-audit)", () => {
  it("shows the off state once, offers no New Service or search, and asks for no list", () => {
    mocks.servicesWorkspace.mockClear();
    setup({}, { enabled: false });
    expect(screen.getAllByTestId("service-catalogue-off")).toHaveLength(1);
    // One h1, the page title; the off state's title sits under it as h2.
    expect(headingLevels()).toEqual([1, 2]);
    expect(screen.getAllByText("disabled.description")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /services.list.new/u }),
    ).toBeNull();
    expect(screen.queryByLabelText("services.list.searchLabel")).toBeNull();
    // An empty workspace id leaves the services query disabled: no 409 is fetched.
    expect(mocks.servicesWorkspace).toHaveBeenCalled();
    for (const [workspaceId] of mocks.servicesWorkspace.mock.calls)
      expect(workspaceId).toBe("");
  });

  // UX-1a (SR-04): the section tabs stay, the managed-service action into the off feature goes,
  // and only a settings manager is offered the way to switch the catalogue on.
  it("keeps the section tabs and hides Create managed service while off", () => {
    setup({}, { enabled: false });
    expect(
      screen.getByRole("navigation", { name: "nav.title" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("create-managed-service")).toBeNull();
    expect(screen.getByText("disabled.description")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "common:featureOff.turnOn" }),
    ).toBeNull();
  });

  it("offers a settings manager Turn on in Features while off", () => {
    mocks.canManageSettings = true;
    setup({}, { enabled: false });
    expect(screen.getByText("disabled.manageDescription")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "common:featureOff.turnOn" }),
    ).toHaveAttribute("href", "/dashboard/settings/workspace/features");
  });

  it("asks for the list once the catalogue is on", () => {
    mocks.servicesWorkspace.mockClear();
    setup({ data: [service()] });
    expect(mocks.servicesWorkspace).toHaveBeenLastCalledWith("w1");
  });
});
