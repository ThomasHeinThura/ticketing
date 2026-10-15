import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type {
  IdentityConnection,
  ScimAdminSettings,
} from "@/fetchers/god-mode/identity-connections";

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { client, ...result };
}

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const CLIENT = "22222222-2222-4222-8222-222222222222";

export const staffConnection: IdentityConnection = {
  id: "conn-1",
  providerType: "entra",
  portalScope: "agent",
  organisationId: null,
  defaultWorkspaceId: "ws-1",
  displayName: "Staff Entra",
  issuer: "https://login.example.test/tenant/v2.0",
  tenantId: TENANT,
  clientId: CLIENT,
  clientSecretConfigured: true,
  redirectUri: "https://desk.example.test/api/auth/callback/conn-1",
  scopes: ["openid", "profile", "email"],
  claimMapping: { version: 1, displayName: "name" },
  claimMappingState: "valid",
  domainBindings: ["example.test"],
  jitPolicy: {
    enabled: false,
    default_role_id: null,
    required_entra_app_role: "TaskDesk.User",
  },
  maxRoleRank: 10,
  mfaUpstreamMode: "off",
  enabled: false,
  configVersion: 7,
  healthState: "healthy",
  healthCheckedAt: null,
};

export const scimSettings: ScimAdminSettings = {
  configVersion: 7,
  data: {
    enabled: false,
    allowedResources: ["users", "groups"],
    lifecyclePolicy: "end_memberships",
    matchAttributes: ["externalId", "userName"],
    attributeMapping: {
      version: 1,
      name: "displayName",
      email: "emails.primary.value",
      jobTitle: "title",
      locale: "preferredLanguage",
    },
    mappings: [
      {
        id: "map-1",
        externalGroupId: "group-1",
        externalGroupNameSnapshot: "Support",
        roleId: "role-1",
        scope: "workspace",
        scopeId: "ws-1",
        enabled: true,
      },
    ],
  },
};

/**
 * Opens a select and picks an option. The select ignores an item click that follows the opening
 * click too closely (it protects against a mouse-up landing on the popup), so the helper waits.
 */
export async function chooseOption(
  combobox: HTMLElement,
  name: string | RegExp,
) {
  fireEvent.click(combobox);
  const option = await screen.findByRole("option", { name });
  await new Promise((resolve) => setTimeout(resolve, 300));
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}
