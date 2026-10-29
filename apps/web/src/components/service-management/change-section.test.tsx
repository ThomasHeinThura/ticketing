import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeView } from "@/fetchers/service-management";
import { translate } from "@/test/en-translation";

const mocks = vi.hoisted(() => ({
  status: {
    data: undefined as unknown,
  },
  change: { data: undefined as unknown, isLoading: false, isError: false },
  patchChange: vi.fn(),
  setWorkItemService: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key.includes(":")
        ? translate(key, values)
        : values
          ? `${key} ${JSON.stringify(values)}`
          : key,
  }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canUpdateTasks: () => true,
  }),
}));
vi.mock("@/hooks/queries/service-management", () => ({
  useCatalogueStatus: () => mocks.status,
  useChange: () => mocks.change,
  useServices: () => ({
    data: [
      { id: "s1", name: "Payments" },
      { id: "s2", name: "Search" },
    ],
  }),
  useInvalidateServiceManagement: () => vi.fn(),
}));
vi.mock("@/fetchers/service-management", () => ({
  CHANGE_RISKS: ["low", "medium", "high"],
  patchChange: (...args: unknown[]) => mocks.patchChange(...args),
  setWorkItemService: (...args: unknown[]) => mocks.setWorkItemService(...args),
}));
vi.mock("@/lib/format", () => ({
  formatDateTime: (value: string) => `at ${value}`,
}));
vi.mock("./override-freeze-dialog", () => ({
  OverrideFreezeDialog: () => <div data-testid="override-dialog" />,
}));

import WorkItemChangeSection from "./change-section";

function change(overrides: Partial<ChangeView> = {}): ChangeView {
  return {
    workItemKey: "OPS-1",
    workItemId: "wi1",
    title: "Patch the gateway",
    isChange: true,
    service: null,
    impact: { services: 3, customers: 2 },
    detail: {
      risk: "medium",
      windowStart: null,
      windowEnd: null,
      rollbackPlan: "Roll back",
      release: null,
      version: 3,
      updatedAt: "2031-01-01T00:00:00.000Z",
    },
    services: [{ id: "s1", name: "Payments" }],
    cabRequired: true,
    rollbackPlanPresent: true,
    retrospective: false,
    freeze: { blocked: false, overridden: false, freezes: [], override: null },
    conflicts: [],
    ...overrides,
  };
}

function setup(
  view: ChangeView | undefined,
  status: Partial<{
    enabled: boolean;
    canManageChanges: boolean;
    canManageServices: boolean;
  }> = {},
) {
  mocks.status.data = {
    enabled: true,
    canManageChanges: true,
    canManageServices: true,
    canManageReleases: true,
    ...status,
  };
  mocks.change.data = view;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <WorkItemChangeSection workItemKey="OPS-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.patchChange.mockResolvedValue(change());
  mocks.setWorkItemService.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  cleanup();
  vi.clearAllMocks();
});

describe("WorkItemChangeSection", () => {
  it("renders nothing while the service catalogue is off", () => {
    setup(change(), { enabled: false });
    expect(screen.queryByTestId("work-item-change")).toBeNull();
  });

  it("shows only the service reference for a work item that is not a change", () => {
    setup(change({ isChange: false, detail: null }));
    expect(screen.getByText("change.service")).toBeTruthy();
    expect(screen.queryByText("change.rollback")).toBeNull();
  });

  it("links the service from a Kaneo picker popover and can clear it", async () => {
    setup(change({ service: { id: "s1", name: "Payments" } }));
    const trigger = screen.getByRole("button", { name: "change.service" });
    expect(trigger).toHaveTextContent("Payments");
    expect(screen.queryByRole("combobox", { name: "change.service" })).toBe(
      null,
    );

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(mocks.setWorkItemService).toHaveBeenCalledWith("OPS-1", "s2"),
    );

    fireEvent.click(screen.getByRole("button", { name: "change.service" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "change.noService" }),
    );
    await waitFor(() =>
      expect(mocks.setWorkItemService).toHaveBeenLastCalledWith("OPS-1", null),
    );
  });

  it("says how many services and customers the change affects", () => {
    setup(change());
    expect(screen.getByText(/change.impact/u).textContent).toContain(
      '"services":3,"customers":2',
    );
  });

  it("explains a missing rollback plan (CH-6)", () => {
    setup(
      change({
        rollbackPlanPresent: false,
        detail: { ...(change().detail as object), rollbackPlan: null } as never,
      }),
    );
    expect(screen.getByText("change.rollbackMissingTitle")).toBeTruthy();
  });

  it("flags a freeze and offers the override only to someone who manages changes (CH-4)", () => {
    const frozen = change({
      freeze: {
        blocked: true,
        overridden: false,
        freezes: [
          {
            id: "f1",
            name: "Year end",
            startsAt: "2031-01-01T00:00:00Z",
            endsAt: "2031-01-05T00:00:00Z",
          },
        ],
        override: null,
      },
    });
    setup(frozen);
    expect(screen.getByText("change.frozenTitle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "change.override" }));
    expect(screen.getByTestId("override-dialog")).toBeTruthy();
    cleanup();
    setup(frozen, { canManageChanges: false });
    expect(screen.getByText("change.frozenTitle")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "change.override" }),
    ).toBeNull();
  });

  it("shows who overrode a freeze, and why", () => {
    setup(
      change({
        freeze: {
          blocked: false,
          overridden: true,
          freezes: [],
          override: {
            reason: "Customer outage",
            by: "Ada",
            at: "2031-01-02T00:00:00Z",
          },
        },
      }),
    );
    expect(
      screen.getByText(/change.overriddenDescription/u).textContent,
    ).toContain("Customer outage");
  });

  it("lists same-service conflicts (CH-5)", () => {
    setup(
      change({
        conflicts: [{ key: "OPS-9", title: "Upgrade", serviceIds: ["s1"] }],
      }),
    );
    expect(screen.getByText("change.conflictTitle")).toBeTruthy();
    expect(screen.getByText("OPS-9")).toBeTruthy();
  });

  it("saves the detail with the loaded version", async () => {
    setup(change());
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() => expect(mocks.patchChange).toHaveBeenCalledTimes(1));
    expect(mocks.patchChange).toHaveBeenCalledWith(
      "OPS-1",
      expect.objectContaining({
        risk: "medium",
        rollbackPlan: "Roll back",
        serviceIds: ["s1"],
        version: 3,
      }),
    );
  });

  it("blocks saving an inverted window selected in the library picker", async () => {
    vi.stubEnv("TZ", "Asia/Yangon");
    const view = change();
    if (!view.detail) throw new Error("The change fixture requires its detail");
    view.detail.windowStart = "2031-01-02T03:30:00.000Z";
    view.detail.windowEnd = "2031-01-02T04:30:00.000Z";
    setup(view);
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "change.windowEnd" }));
    const hour = screen.getByRole("combobox", { name: "Hour" });
    hour.focus();
    fireEvent.click(hour);
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("role", "option"),
    );
    const option = screen.getByRole("option", { name: "09" });
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("change.windowInvalid")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "common.save" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(mocks.patchChange).not.toHaveBeenCalled();
  });

  it("requires both window bounds or neither and retains the version when both are cleared", async () => {
    const view = change();
    if (!view.detail) throw new Error("The change fixture requires its detail");
    view.detail.windowStart = "2031-01-02T03:30:00.000Z";
    view.detail.windowEnd = "2031-01-02T04:30:00.000Z";
    setup(view);
    for (const name of ["change.windowStart", "change.windowEnd"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
      if (name === "change.windowStart")
        expect(
          screen.getByRole("button", { name: "common.save" }),
        ).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));
    await waitFor(() =>
      expect(mocks.patchChange).toHaveBeenCalledWith(
        "OPS-1",
        expect.objectContaining({
          windowStart: null,
          windowEnd: null,
          version: 3,
        }),
      ),
    );
  });

  it("keeps service choices inside a named library scroll region", () => {
    setup(change());
    const region = screen.getByRole("region", { name: "change.affected" });
    expect(
      region.querySelectorAll('[data-slot="scroll-area-viewport"]'),
    ).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Payments" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Search" })).not.toBeChecked();
  });

  it("is read-only for someone who cannot manage changes", () => {
    setup(change(), { canManageChanges: false });
    expect(screen.queryByRole("button", { name: "common.save" })).toBeNull();
    expect(
      (screen.getByLabelText("change.rollback") as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "change.windowStart" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "change.windowEnd" }),
    ).toBeDisabled();
  });
});
