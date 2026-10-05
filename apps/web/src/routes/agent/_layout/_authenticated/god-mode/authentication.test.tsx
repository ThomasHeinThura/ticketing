import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/god-mode/authentication";
const apiFetch = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: (namespace: string) => ({
    i18n: { language: "en-US" },
    t: (key: string, options?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        "identityConnections.editor.connectionName": "Connection name",
        "identityConnections.editor.tenantId": "Entra tenant ID",
        "identityConnections.editor.clientId": "Application client ID",
        "identityConnections.editor.clientSecret": "Client secret",
        "identityConnections.editor.freshAuth": "Fresh authentication",
        "identityConnections.editor.createDisabled":
          "Create disabled connection",
        "identityConnections.editor.created": "Identity connection created",
        "identityConnections.editor.openSettings": "Open connection settings",
        "identityConnections.list.title": "Identity connections",
        "identityConnections.list.description":
          "Configure Microsoft Entra sign-in, review safe connection metadata, and manage the associated SCIM settings.",
        "identityConnections.list.add": "Add identity connection",
        "identityConnections.list.configured":
          "Configured identity connections",
        "identityConnections.list.manage": "Manage settings",
        "identityConnections.list.enabled": "Enabled",
        "identityConnections.list.disabled": "Disabled",
        "identityConnections.editor.staffPortal": "Staff portal",
        "identityConnections.editor.customerPortal": "Customer portal",
      };
      const fullKey = key.includes(":") ? key : `${namespace}.${key}`;
      let value = values[fullKey] ?? key;
      for (const [name, replacement] of Object.entries(options ?? {})) {
        value = value.replaceAll(`{{${name}}}`, String(replacement));
      }
      return value;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Outlet: () => <div data-testid="identity-connection-outlet" />,
  useLocation: () => ({ pathname }),
}));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.test/${path}`,
}));

import { Route } from "./authentication";

const IdentityConnectionsRoute = (
  Route as unknown as { component: ComponentType }
).component;

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
  pathname = "/god-mode/authentication";
});

describe("God Mode identity connection list", () => {
  it("shows safe connection metadata and links to the registered editor URL", async () => {
    apiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "connection/one",
              providerType: "entra",
              portalScope: "agent",
              organisationId: null,
              defaultWorkspaceId: null,
              displayName: "Staff directory",
              enabled: true,
              configVersion: 3,
              clientSecretConfigured: true,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    render(<IdentityConnectionsRoute />);

    const link = await screen.findByRole("link", { name: "Manage settings" });
    expect(
      screen.getByRole("link", { name: "Add identity connection" }),
    ).toHaveAttribute("href", "/god-mode/authentication/new");
    expect(link).toHaveAttribute(
      "href",
      "/god-mode/authentication/connection%2Fone",
    );
    expect(screen.getByText(/Staff portal/u)).toBeTruthy();
    expect(screen.queryByText(/clientSecret|secretConfigured/u)).toBeNull();
  });

  it("renders the nested editor without refetching the connection list", () => {
    pathname = "/god-mode/authentication/connection-one";
    render(<IdentityConnectionsRoute />);
    expect(screen.getByTestId("identity-connection-outlet")).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
