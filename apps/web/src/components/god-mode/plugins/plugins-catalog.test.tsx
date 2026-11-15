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
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "checkedAt") return `Updated ${String(options?.when ?? "")}`;
      if (key === "destination")
        return `destination:${String(options?.value ?? "")}`;
      if (key === "dataProcessed")
        return `dataProcessed:${String(options?.value ?? "")}`;
      if (key === "subprocessorsActiveCount")
        return `subprocessorsActiveCount:${String(options?.count ?? "")}`;
      return key;
    },
  }),
}));
vi.mock("@/lib/format", () => ({ formatDateTime: (value: string) => value }));
vi.mock("@/lib/routes", () => ({
  routes: {
    notificationProvider: { path: "/god-mode/notifications" },
    godModeJobs: { path: "/god-mode/jobs" },
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
    ).toHaveAttribute("href", "/god-mode/notifications");
  });

  it("renders the live subprocessor register with redacted destination summaries, data processed, and per-integration settings links", async () => {
    mocks.list.mockResolvedValueOnce({
      checkedAt: "2026-11-15T12:00:00.000Z",
      plugins: [
        {
          id: "notify.email",
          name: "Email",
          kind: "notification",
          category: "outbound_email",
          state: "enabled",
          source: "runtime",
          configVersion: 4,
          credentialConfigured: true,
          dataProcessed:
            "Recipient email addresses, notification subjects, and message bodies",
          destinationSummary: "Configured SMTP relay",
          configPath: "/god-mode/notifications",
        },
        {
          id: "storage.s3",
          name: "S3 Object Storage",
          kind: "storage",
          category: "object_storage",
          state: "unconfigured",
          source: "unconfigured",
          configVersion: 0,
          credentialConfigured: false,
          dataProcessed:
            "Work item, comment, and portal submission attachment objects",
          destinationSummary: "Disabled",
          configPath: "/god-mode/storage",
        },
        {
          id: "identity.sso",
          name: "Identity Providers & SCIM",
          kind: "identity",
          category: "identity_provider",
          state: "enabled",
          source: "runtime",
          configVersion: 2,
          credentialConfigured: true,
          dataProcessed:
            "User identifiers, email addresses, display names, and group memberships",
          destinationSummary: "1 active OIDC connection, 1 SCIM enabled",
          configPath: "/god-mode/authentication",
        },
        {
          id: "observability.telemetry",
          name: "Error Reporting & Telemetry",
          kind: "observability",
          category: "telemetry",
          state: "unconfigured",
          source: "unconfigured",
          configVersion: 0,
          credentialConfigured: false,
          dataProcessed:
            "Operational service metrics and allowlisted diagnostic metadata",
          destinationSummary: "Disabled",
          configPath: "/god-mode/observability",
        },
      ],
    });

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <PluginsCatalog />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("S3 Object Storage")).toBeInTheDocument();
    expect(screen.getByText("Identity Providers & SCIM")).toBeInTheDocument();
    expect(screen.getByText("Error Reporting & Telemetry")).toBeInTheDocument();
    expect(screen.getByText("subprocessorsActiveCount:2")).toBeInTheDocument();
    expect(
      screen.getByText("destination:1 active OIDC connection, 1 SCIM enabled"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "dataProcessed:Work item, comment, and portal submission attachment objects",
      ),
    ).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "manageSettings" });
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/god-mode/notifications",
      "/god-mode/storage",
      "/god-mode/authentication",
      "/god-mode/observability",
    ]);
  });
});
