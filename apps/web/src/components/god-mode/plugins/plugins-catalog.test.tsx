import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key === "checkedAt" ? `Updated ${String(options?.when ?? "")}` : key,
  }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/lib/routes", () => ({
  routes: {
    notificationProvider: { path: "/agent/god-mode/notifications" },
    godModeJobs: { path: "/agent/god-mode/jobs" },
  },
}));
vi.mock("@/fetchers/god-mode/plugins", () => ({
  listSupportedPlugins: () => mocks.list(),
}));

vi.mock("@/fetchers/god-mode/instance-health", () => ({
  getInstanceHealth: async () => ({
    checkedAt: "2026-10-25T12:00:00.000Z",
    state: "ok",
    checks: [
      {
        key: "secrets_encryption",
        state: "ok",
        detail: {
          keyConfigured: true,
          secretsTotal: 3,
          secretsPendingRekey: 0,
          rekeyComplete: true,
        },
      },
    ],
  }),
}));

import { PluginsCatalog } from "./plugins-catalog";

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({
    checkedAt: "2026-10-25T12:00:00.000Z",
    plugins: [
      {
        id: "notify.email",
        name: "Email",
        kind: "notification",
        state: "enabled",
        source: "runtime",
        configVersion: 4,
        credentialConfigured: true,
      },
    ],
  });
});
afterEach(cleanup);

describe("PluginsCatalog", () => {
  it("shows real supported provider state and links to its existing settings", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <PluginsCatalog />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Email")).toBeInTheDocument();
    expect(screen.getByText("states.enabled")).toBeInTheDocument();
    expect(screen.getByText("credentialConfigured")).toBeInTheDocument();
    expect(screen.getByText("healthNotRecorded")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "manageSettings" }),
    ).toHaveAttribute("href", "/agent/god-mode/notifications");
  });
});
