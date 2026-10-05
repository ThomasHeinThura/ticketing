import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.test/${path}`,
}));

import { IdentityConnectionEditor } from "./identity-connection-editor";

afterEach(() => {
  cleanup();
  apiFetch.mockReset();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("God Mode identity connection create form", () => {
  it("binds the create request to fresh step-up and does not display or retain the secret after saving", async () => {
    apiFetch
      .mockResolvedValueOnce(
        jsonResponse({ challengeId: "challenge", nonce: "n".repeat(43) }),
      )
      .mockResolvedValueOnce(jsonResponse({ token: "proof" }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: "connection-one",
              providerType: "entra",
              portalScope: "agent",
              organisationId: null,
              defaultWorkspaceId: null,
              displayName: "Staff sign-in",
              issuer: "https://login.microsoftonline.com/tenant/v2.0",
              tenantId: "12345678-1234-4234-8234-123456789012",
              clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              clientSecretConfigured: true,
              redirectUri:
                "https://agent.example.test/api/auth/identity/callback",
              scopes: ["openid", "profile", "email"],
              claimMapping: { version: 1, displayName: "name" },
              claimMappingState: "valid",
              domainBindings: [],
              jitPolicy: {
                enabled: false,
                default_role_id: null,
                required_entra_app_role: "TaskDesk.User",
              },
              maxRoleRank: 10,
              mfaUpstreamMode: "off",
              enabled: false,
              configVersion: 1,
              healthState: "unknown",
              healthCheckedAt: null,
            },
          },
          201,
        ),
      );

    render(<IdentityConnectionEditor connectionId={null} />);
    fireEvent.change(screen.getByLabelText("Connection name"), {
      target: { value: "Staff sign-in" },
    });
    fireEvent.change(screen.getByLabelText("Entra tenant ID"), {
      target: { value: "12345678-1234-4234-8234-123456789012" },
    });
    fireEvent.change(screen.getByLabelText("Application client ID"), {
      target: { value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    fireEvent.change(screen.getByLabelText("Client secret"), {
      target: { value: "one-time-client-secret" },
    });
    fireEvent.change(screen.getByLabelText("Fresh authentication"), {
      target: { value: "admin-password" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Create disabled connection" }),
    );

    expect(
      await screen.findByText(/Identity connection created/u),
    ).toBeTruthy();
    expect(screen.queryByDisplayValue("one-time-client-secret")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open connection settings" }),
    ).toHaveAttribute("href", "/god-mode/authentication/connection-one");
    const calls = apiFetch.mock.calls as Array<[string, RequestInit]>;
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[0]).toBe("https://api.test/me/step-up/challenges");
    const binding = JSON.parse(String(calls[0]?.[1].body)) as {
      operation: string;
      request: Record<string, unknown>;
    };
    expect(binding.operation).toBe("identity_connection_create");
    expect(binding.request).toMatchObject({
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: null,
      tenantId: "12345678-1234-4234-8234-123456789012",
      clientSecret: "one-time-client-secret",
      maxRoleRank: 10,
    });
    expect(calls[2]?.[0]).toBe(
      "https://api.test/instance/identity-connections",
    );
    expect(
      new Headers(calls[2]?.[1].headers).get("x-taskdesk-step-up-token"),
    ).toBe("proof");
    expect(calls[2]?.[1].method).toBe("POST");
  });
});
