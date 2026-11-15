import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getHealth: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock("@/fetchers/god-mode/instance-health", () => ({
  getInstanceHealth: mocks.getHealth,
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("./legal-holds-panel", () => ({ LegalHoldsPanel: () => null }));
vi.mock("./rotate-secrets-dialog", () => ({ RotateSecretsDialog: () => null }));
function renderPanel() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InstanceHealthPanel />
    </QueryClientProvider>,
  );
}

import { InstanceHealthPanel } from "./instance-health-panel";

const healthy = {
  checkedAt: "2026-11-15T00:00:00.000Z",
  state: "ok",
  checks: [],
};
beforeEach(() => mocks.getHealth.mockReset());
afterEach(cleanup);
describe("InstanceHealthPanel hold status", () => {
  it.each([
    undefined,
    { state: "unknown", activeCount: null },
    { state: "ok", activeCount: null },
  ])("renders unavailable rather than zero for %j", async (legalHolds) => {
    mocks.getHealth.mockResolvedValue({ ...healthy, legalHolds });
    renderPanel();
    expect(
      await screen.findByText("legalHolds.unavailableBadge"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("legalHolds.activeBadge:0"),
    ).not.toBeInTheDocument();
  });
  it("renders verified zero", async () => {
    mocks.getHealth.mockResolvedValue({
      ...healthy,
      legalHolds: { state: "ok", activeCount: 0 },
    });
    renderPanel();
    expect(
      await screen.findByText("legalHolds.activeBadge:0"),
    ).toBeInTheDocument();
  });
  it("retries a failed health request", async () => {
    mocks.getHealth
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue({
        ...healthy,
        legalHolds: { state: "ok", activeCount: 2 },
      });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "retry" }));
    expect(
      await screen.findByText("legalHolds.activeBadge:2"),
    ).toBeInTheDocument();
  });
});
