import {
  type ApiKeyPermissionScope,
  apiKeyCapabilitySubset,
} from "../utils/require-api-key-permission-scope";
import { resolveIdentity } from "./resolve-identity";

export type AuthenticatedApiKey = ApiKeyPermissionScope & {
  readonly id: string;
  readonly userId: string;
  readonly enabled: boolean;
};

/** Build one canonical identity from the authenticated request credential facts. */
export function resolveRequestIdentity(input: {
  readonly userId: string;
  readonly apiKey?: AuthenticatedApiKey;
  readonly impersonatedBy?: string | null;
}) {
  const { userId, apiKey, impersonatedBy } = input;
  return resolveIdentity({
    userId,
    credential: apiKey
      ? "api_key"
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
