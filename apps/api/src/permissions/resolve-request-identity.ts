import {
  type ApiKeyPermissionScope,
  apiKeyCapabilitySubset,
} from "../utils/require-api-key-permission-scope";
import { resolveIdentity } from "./resolve-identity";
import { resolveServicePrincipal } from "./service-principal";

export type AuthenticatedApiKey = ApiKeyPermissionScope & {
  readonly id: string;
  readonly userId: string;
  readonly enabled: boolean;
  /** MC-14: an MCP key is a distinct credential kind with its own clamp and rate class. */
  readonly isMcp?: boolean;
  /**
   * AK-7: set only for a workspace SERVICE key, which has no person behind it. The workspace and
   * stored capability subset it is evaluated against; see `service-principal.ts`.
   */
  readonly service?: {
    readonly workspaceId: string;
    readonly capabilities: readonly string[] | null;
  };
};

/** Build one canonical identity from the authenticated request credential facts. */
export function resolveRequestIdentity(input: {
  readonly userId: string;
  readonly apiKey?: AuthenticatedApiKey;
  readonly impersonatedBy?: string | null;
}) {
  const { userId, apiKey, impersonatedBy } = input;
  if (apiKey?.service) {
    // AK-7: a service key is evaluated against its own stored subset in its own workspace.
    return resolveServicePrincipal({
      apiKeyId: apiKey.id,
      workspaceId: apiKey.service.workspaceId,
      capabilities: apiKey.service.capabilities,
    });
  }
  return resolveIdentity({
    userId,
    credential: apiKey
      ? apiKey.isMcp
        ? "mcp_key"
        : "api_key"
      : impersonatedBy
        ? "impersonation"
        : "session",
    ...(apiKey
      ? {
          apiKey: {
            enabled: apiKey.enabled,
            ownerUserId: apiKey.userId,
            capabilities: apiKeyCapabilitySubset(apiKey),
          },
        }
      : {}),
  });
}
