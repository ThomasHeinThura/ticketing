import { client } from "./hono";

export type ScimAdministrationDto = {
  readonly configVersion: number;
  readonly data: {
    readonly enabled: boolean;
    readonly allowedResources: readonly ("users" | "groups")[];
    readonly lifecyclePolicy: "end_memberships" | "keep_memberships";
    readonly attributeMapping: {
      readonly version: 1;
      readonly name: "displayName" | "name.formatted";
      readonly email: "emails.primary.value" | "userName";
      readonly jobTitle: "title" | "unmapped";
      readonly locale: "preferredLanguage" | "locale" | "unmapped";
    };
    readonly mappings: readonly {
      readonly id: string;
      readonly externalGroupId: string;
      readonly externalGroupNameSnapshot: string | null;
      readonly roleId: string;
      readonly scope: "organisation" | "workspace";
      readonly scopeId: string;
      readonly enabled: boolean;
    }[];
  };
};

export type ScimAdministrationRequest =
  | {
      readonly kind: "settings";
      readonly configVersion: number;
      readonly enabled?: boolean;
      readonly allowedResources?: ("users" | "groups")[];
      readonly lifecyclePolicy?: "end_memberships" | "keep_memberships";
    }
  | {
      readonly kind: "attribute_mapping";
      readonly configVersion: number;
      readonly attributeMapping: ScimAdministrationDto["data"]["attributeMapping"];
    }
  | {
      readonly kind: "mapping_create";
      readonly configVersion: number;
      readonly externalGroupId: string;
      readonly externalGroupNameSnapshot?: string | null;
      readonly roleId: string;
      readonly scope: "organisation" | "workspace";
      readonly scopeId?: string;
      readonly enabled?: boolean;
    }
  | {
      readonly kind: "mapping_update";
      readonly configVersion: number;
      readonly mappingId: string;
      readonly externalGroupNameSnapshot?: string | null;
      readonly roleId?: string;
      readonly scopeId?: string;
      readonly enabled?: boolean;
    };

async function requireOk(response: Response): Promise<Response> {
  if (!response.ok) throw new Error("Identity administration request failed");
  return response;
}

export async function getScimAdministration(
  connectionId: string,
): Promise<ScimAdministrationDto> {
  const response = await client.instance["identity-connections"][
    ":id"
  ].scim.$get({
    param: { id: connectionId },
  });
  return (await (await requireOk(response)).json()) as ScimAdministrationDto;
}

export async function patchScimAdministration(
  connectionId: string,
  input: ScimAdministrationRequest,
  stepUpToken: string,
): Promise<ScimAdministrationDto> {
  const response = await client.instance["identity-connections"][
    ":id"
  ].scim.$patch({
    param: { id: connectionId },
    header: { "x-taskdesk-step-up-token": stepUpToken },
    json: input,
  });
  return (await (await requireOk(response)).json()) as ScimAdministrationDto;
}

export async function createScimTokenChallenge(
  operation: "scim_token_rotate" | "scim_token_revoke",
  connectionId: string,
  version: number,
): Promise<{ challengeId: string; nonce: string; expiresAt: string }> {
  const response = await client.me["step-up"].challenges.$post({
    json: { kind: "operation", operation, connectionId, version },
  });
  return (await (await requireOk(response)).json()) as {
    challengeId: string;
    nonce: string;
    expiresAt: string;
  };
}

export async function proveScimTokenOperation(
  operation: "scim_token_rotate" | "scim_token_revoke",
  connectionId: string,
  version: number,
  challenge: { challengeId: string; nonce: string },
  proof:
    | { method: "password"; password: string }
    | { method: "totp" | "backup_code"; code: string },
): Promise<{ stepUpToken: string; expiresAt: string }> {
  const response = await client.me["step-up"].$post({
    json: {
      kind: "operation",
      operation,
      connectionId,
      version,
      ...challenge,
      ...proof,
    },
  });
  return (await (await requireOk(response)).json()) as {
    stepUpToken: string;
    expiresAt: string;
  };
}

export async function rotateScimToken(
  connectionId: string,
  version: number,
  stepUpToken: string,
): Promise<{ configVersion: number; token: string; tokenRotatedAt: string }> {
  const response = await client.instance["identity-connections"][":id"].scim[
    "rotate-token"
  ].$post({
    param: { id: connectionId },
    header: { "x-taskdesk-step-up-token": stepUpToken },
    json: { version },
  });
  return (await (await requireOk(response)).json()) as {
    configVersion: number;
    token: string;
    tokenRotatedAt: string;
  };
}

export async function revokeScimToken(
  connectionId: string,
  version: number,
  stepUpToken: string,
): Promise<{ configVersion: number; revoked: true }> {
  const response = await client.instance["identity-connections"][":id"].scim[
    "revoke-token"
  ].$post({
    param: { id: connectionId },
    header: { "x-taskdesk-step-up-token": stepUpToken },
    json: { version },
  });
  return (await (await requireOk(response)).json()) as {
    configVersion: number;
    revoked: true;
  };
}
