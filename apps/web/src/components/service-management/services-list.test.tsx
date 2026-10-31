import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({
  services: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  status: { data: undefined as unknown },
  canCreateProjects: true,
  modalProps: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
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
  useServices: () => mocks.services,
  isFeatureDisabled: (error: unknown) =>
    error instanceof HttpError && error.status === 409,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canBindProjectOrganisation: () => mocks.canCreateProjects,
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
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServicesList />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.canCreateProjects = true;
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
});
