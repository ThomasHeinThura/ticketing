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
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (value: unknown) => Promise<unknown>;
  }) => ({
    isPending: false,
    isError: mocks.error !== null,
    error: mocks.error,
    mutate: (value: unknown) => void mutationFn(value),
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
});

describe("FeatureFlagsPanel", () => {
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
    expect(screen.queryByText("useInherited")).toBeNull();
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
    fireEvent.click(screen.getByText("useInherited"));
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

  it("labels the enabled switch as well as the lock switch", () => {
    mocks.rows = [row({ key: "feature.sla" })];
    render(<FeatureFlagsPanel target={{ level: "instance" }} />);
    expect(screen.getByText("enabledSwitch")).toBeTruthy();
    expect(screen.getByText("lock")).toBeTruthy();
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
});
