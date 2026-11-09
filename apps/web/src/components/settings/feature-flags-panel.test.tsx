import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureRow } from "@/fetchers/feature-flags";
import { HttpError } from "@/lib/http-error";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  save: vi.fn(),
  error: null as unknown,
  query: { isError: false, error: null as unknown },
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.source
        ? `${key}:${options.source}`
        : options?.who
          ? `${key}:${options.who}`
          : key,
  }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: () => "a date" }));
vi.mock("@/fetchers/feature-flags", async () => {
  class FeatureConflictError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    FeatureConflictError,
    getFeatures: vi.fn(),
    patchFeatures: (...args: unknown[]) => mocks.save(...args),
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    isPending: false,
    isError: mocks.query.isError,
    error: mocks.query.error,
    data: mocks.rows,
    refetch: vi.fn(),
  }),
  useQueryClient: () => ({
    setQueryData: mocks.setQueryData,
    invalidateQueries: mocks.invalidateQueries,
  }),
  useMutation: ({
    mutationFn,
    onSuccess,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
    onSuccess?: (data: unknown) => void;
  }) => ({
    isPending: false,
    isError: mocks.error !== null,
    error: mocks.error,
    mutate: (value: unknown) =>
      void mutationFn(value).then(
        (data) => onSuccess?.(data),
        () => {},
      ),
  }),
}));

import { FeatureFlagsPanel } from "./feature-flags-panel";

function row(overrides: Partial<FeatureRow> & { key: FeatureRow["key"] }) {
  return {
    enabled: false,
    source: "default",
    locked: false,
    defaultEnabled: false,
    version: 0,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  } satisfies FeatureRow;
}

afterEach(cleanup);
beforeEach(() => {
  mocks.error = null;
  mocks.query = { isError: false, error: null };
  mocks.save.mockReset().mockResolvedValue([]);
  mocks.invalidateQueries.mockReset();
  mocks.setQueryData.mockReset();
});

describe("FeatureFlagsPanel", () => {
  it.each([
    { level: "instance" },
    { level: "workspace", workspaceId: "workspace-1" },
    { level: "project", projectId: "project-1" },
  ] as const)(
    "refreshes the effective feature reads after a $level change",
    async (target) => {
      mocks.rows = [row({ key: "feature.knowledge_base", version: 2 })];
      const saved = [row({ key: "feature.knowledge_base", enabled: true })];
      mocks.save.mockResolvedValue(saved);
      render(<FeatureFlagsPanel target={target} />);
      const switches = screen.getAllByRole("switch");
      fireEvent.click(switches[switches.length - 1] as HTMLElement);
      await waitFor(() =>
        expect(mocks.invalidateQueries).toHaveBeenCalledTimes(2),
      );
      expect(mocks.setQueryData).toHaveBeenCalledWith(
        ["feature-flags", target],
        saved,
      );
      // The workspace's resolved values (navigation, KB, Triage) and every project's (Pages).
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["features"],
      });
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["agile", "features"],
      });
    },
  );

  it("does not refresh the effective feature reads when a change fails", async () => {
    mocks.rows = [row({ key: "feature.knowledge_base", version: 2 })];
    mocks.save.mockRejectedValue(new Error("boom"));
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[switches.length - 1] as HTMLElement);
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("instance level toggles a flag and its lock with the row version", async () => {
    mocks.rows = [row({ key: "feature.cycles", version: 4 })];
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    // The lock switch comes first in the row, the flag's own switch last.
    const [lockSwitch, flagSwitch] = screen.getAllByRole("switch");
    fireEvent.click(flagSwitch as HTMLElement);
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0]).toEqual([
      { level: "instance" },
      [{ key: "feature.cycles", enabled: true, expectedVersion: 4 }],
    ]);
    fireEvent.click(lockSwitch as HTMLElement);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]?.[1]).toEqual([
      { key: "feature.cycles", locked: true, expectedVersion: 4 },
    ]);
  });

  it("shows where an inherited value comes from and offers no reset when inherited", () => {
    mocks.rows = [
      row({
        key: "feature.sla",
        enabled: true,
        source: "instance",
        override: null,
        inherited: { enabled: true, source: "instance" },
      }),
    ];
    render(
      <FeatureFlagsPanel target={{ level: "workspace", workspaceId: "w1" }} />,
    );
    expect(screen.getByText("inheritedFrom:sources.instance")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "useInherited" })).toBeNull();
  });

  it("identifies a workspace-inherited project feature", () => {
    mocks.rows = [
      row({
        key: "feature.sla",
        enabled: true,
        source: "workspace",
        override: null,
        inherited: { enabled: true, source: "workspace" },
      }),
    ];
    render(
      <FeatureFlagsPanel target={{ level: "project", projectId: "p1" }} />,
    );
    expect(screen.getByText("inheritedFrom:sources.workspace")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "useInherited" })).toBeNull();
  });

  it("an override can be reset to the inherited value with null", async () => {
    mocks.rows = [
      row({
        key: "feature.sla",
        enabled: false,
        source: "project",
        override: false,
        version: 2,
        inherited: { enabled: true, source: "workspace" },
      }),
    ];
    render(
      <FeatureFlagsPanel target={{ level: "project", projectId: "p1" }} />,
    );
    expect(screen.getByText("overridden")).toBeTruthy();
    // S11: a quiet icon button beside the Overridden badge, not a text button by the switch.
    fireEvent.click(screen.getByRole("button", { name: "useInherited" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0]).toEqual([
      { level: "project", projectId: "p1" },
      [{ key: "feature.sla", enabled: null, expectedVersion: 2 }],
    ]);
  });

  it("a flag locked by the instance cannot be changed below", () => {
    mocks.rows = [
      row({
        key: "feature.sla",
        enabled: true,
        source: "instance",
        locked: true,
        override: null,
        inherited: { enabled: true, source: "instance" },
      }),
    ];
    render(
      <FeatureFlagsPanel target={{ level: "workspace", workspaceId: "w1" }} />,
    );
    expect(screen.getByText("lockedByInstance")).toBeTruthy();
    const flagSwitch = screen.getByRole("switch");
    expect(
      flagSwitch.hasAttribute("disabled") ||
        flagSwitch.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  it("says who last changed a flag and when", () => {
    mocks.rows = [
      row({
        key: "feature.sla",
        updatedAt: "2026-10-01T10:00:00.000Z",
        updatedBy: { id: "p", name: "Ada" },
      }),
    ];
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    expect(screen.getByText("lastChanged:Ada")).toBeTruthy();
  });

  it("attributes a seeded change with no recorded person to the system", () => {
    mocks.rows = [
      row({ key: "feature.sla", updatedAt: "2026-10-01T10:00:00.000Z" }),
    ];
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    expect(screen.getByText("lastChanged:system")).toBeTruthy();
  });

  it("names each switch by its feature and shows its real state (A-37)", () => {
    mocks.rows = [
      row({ key: "feature.sla", enabled: false }),
      row({ key: "feature.kb", enabled: true }),
    ];
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    const sla = screen.getByRole("switch", { name: "flags.feature.sla.name" });
    expect(sla.getAttribute("aria-checked")).toBe("false");
    const kb = screen.getByRole("switch", { name: "flags.feature.kb.name" });
    expect(kb.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("switch", { name: "lock flags.feature.sla.name" }),
    ).toBeTruthy();
    expect(screen.getAllByText("stateOff")).toHaveLength(1);
    expect(screen.getAllByText("stateOn")).toHaveLength(1);
    expect(screen.queryByText("enabledSwitch")).toBeNull();
  });

  it("says access is missing on a 403 instead of a generic load failure (M9)", () => {
    mocks.query = { isError: true, error: new HttpError(403, "Forbidden") };
    render(
      <FeatureFlagsPanel
        target={{ level: "workspace", workspaceId: "ws-1" }}
      />,
    );
    expect(screen.getByText("forbiddenTitle")).toBeTruthy();
    expect(screen.queryByText("loadFailed")).toBeNull();
  });

  it("keeps the generic load failure for other errors", () => {
    mocks.query = { isError: true, error: new HttpError(500, "boom") };
    render(
      <FeatureFlagsPanel
        target={{ level: "workspace", workspaceId: "ws-1" }}
      />,
    );
    expect(screen.getByText("loadFailed")).toBeTruthy();
  });

  it("never offers instance-only flags (SCIM, MCP) at workspace or project level, but does at instance level (P4R2-M2)", () => {
    const lower = (key: FeatureRow["key"]) =>
      row({
        key,
        override: null,
        inherited: { enabled: false, source: "default" },
      });
    mocks.rows = [
      lower("feature.scim"),
      lower("feature.mcp"),
      lower("feature.cycles"),
    ];
    render(
      <FeatureFlagsPanel target={{ level: "workspace", workspaceId: "w1" }} />,
    );
    expect(screen.queryByText("flags.feature.scim.name")).toBeNull();
    expect(screen.queryByText("flags.feature.mcp.name")).toBeNull();
    expect(screen.getByText("flags.feature.cycles.name")).toBeTruthy();
    cleanup();

    render(
      <FeatureFlagsPanel target={{ level: "project", projectId: "p1" }} />,
    );
    expect(screen.queryByText("flags.feature.scim.name")).toBeNull();
    cleanup();

    mocks.rows = [row({ key: "feature.scim" }), row({ key: "feature.mcp" })];
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    expect(screen.getByText("flags.feature.scim.name")).toBeTruthy();
    expect(screen.getByText("flags.feature.mcp.name")).toBeTruthy();
  });

  it("aligns the card header and the rows on one horizontal padding (S11)", () => {
    mocks.rows = [row({ key: "feature.sla" })];
    const { container } = render(
      <FeatureFlagsPanel target={{ level: "workspace", workspaceId: "w1" }} />,
    );
    const header = container.querySelector('[data-slot="card-header"]');
    const panel = container.querySelector('[data-slot="card-panel"]');
    expect(header?.classList.contains("td-density-card")).toBe(true);
    expect(panel?.classList.contains("td-density-card")).toBe(true);
  });
});
