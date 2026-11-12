import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import { headingLevels } from "@/test/headings";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  canManage: true,
  enabled: true,
  statusLoading: false,
  servicesWorkspace: vi.fn(),
  releasesWorkspace: vi.fn(),
}));
vi.mock("react-i18next", async () => ({
  ...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key.includes(":") ? key : `${namespace}:${key}`, options),
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: () => null,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-one" } }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useCatalogueStatus: () => ({
    data: mocks.statusLoading
      ? undefined
      : { enabled: mocks.enabled, canManageReleases: mocks.canManage },
    isLoading: mocks.statusLoading,
    isError: false,
  }),
  useServices: (workspaceId: string) => {
    mocks.servicesWorkspace(workspaceId);
    return { data: [{ id: "service-one", name: "Payments" }] };
  },
  useReleases: (workspaceId: string) => {
    mocks.releasesWorkspace(workspaceId);
    return { data: [], isLoading: false, isError: false };
  },
  useInvalidateServiceManagement: () => vi.fn(),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageWorkspaceSettings: () => false }),
}));
vi.mock("@/fetchers/service-management", () => ({
  createRelease: (...args: unknown[]) => mocks.create(...args),
}));

import { ReleasesList } from "./releases-list";

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReleasesList search={{}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));
  mocks.canManage = true;
  mocks.enabled = true;
  mocks.statusLoading = false;
  mocks.create.mockResolvedValue({ id: "release-one" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("release planned-date control", () => {
  it("submits the selected calendar date without a timezone conversion or premature create", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "New release" }));
    expect(document.querySelector('input[type="date"]')).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "October release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Planned date" }));
    fireEvent.click(screen.getByRole("button", { name: /October 31/ }));
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create release" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith("workspace-one", {
        name: "October release",
        serviceId: "service-one",
        plannedDate: "2026-10-31",
        changeKeys: [],
      }),
    );
  });

  it("allows clearing an optional date and submits null", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "New release" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Undated release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Planned date" }));
    fireEvent.click(screen.getByRole("button", { name: /October 31/ }));
    fireEvent.click(screen.getByRole("button", { name: "Planned date" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(
      screen.getByRole("button", { name: "Planned date" }),
    ).toHaveTextContent("Not set");
    fireEvent.click(screen.getByRole("button", { name: "Create release" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        "workspace-one",
        expect.objectContaining({ plannedDate: null }),
      ),
    );
  });

  it("does not expose create controls without release-management permission", () => {
    mocks.canManage = false;
    setup();
    expect(screen.queryByRole("button", { name: "New release" })).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

// UX-1a (SR-03/SR-04): with the catalogue off, the shared off state comes before any release
// chrome, nothing is fetched, and New release is not offered.
describe("releases with the catalogue off", () => {
  it("shows the off state with the section tabs, and no filter, New release or list request", () => {
    mocks.enabled = false;
    setup();
    expect(screen.getAllByTestId("service-catalogue-off")).toHaveLength(1);
    // One h1, the page title; the off state's title sits under it as h2.
    expect(headingLevels()).toEqual([1, 2]);
    expect(
      screen.getByRole("navigation", {
        name: translate("serviceManagement:nav.title"),
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New release" })).toBeNull();
    expect(
      screen.queryByText(
        translate("serviceManagement:releases.list.filterService"),
      ),
    ).toBeNull();
    for (const [workspaceId] of mocks.servicesWorkspace.mock.calls)
      expect(workspaceId).toBe("");
    for (const [workspaceId] of mocks.releasesWorkspace.mock.calls)
      expect(workspaceId).toBe("");
  });

  it("asks for nothing and shows no filter while the catalogue status loads", () => {
    mocks.statusLoading = true;
    setup();
    expect(
      screen.queryByText(
        translate("serviceManagement:releases.list.filterService"),
      ),
    ).toBeNull();
    expect(screen.queryByTestId("service-catalogue-off")).toBeNull();
    for (const [workspaceId] of mocks.servicesWorkspace.mock.calls)
      expect(workspaceId).toBe("");
    for (const [workspaceId] of mocks.releasesWorkspace.mock.calls)
      expect(workspaceId).toBe("");
  });
});
