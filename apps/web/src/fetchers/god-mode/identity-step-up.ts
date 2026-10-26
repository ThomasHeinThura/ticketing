import { client } from "@taskdesk/libs";
import { ensureIdentityAdminOk } from "./identity-admin-error";
import type {
  IdentityConnectionConfigureBody,
  IdentityConnectionCreateBody,
  ScimAdminRequest,
} from "./identity-connections";
import type { StepUpMethod } from "./instance-users";

/**
 * The only operations this screen binds, exactly as the accepted API defines them. The proof is
 * bound server-side to the operation, route, connection, persisted version and canonical body, so
 * the same request object is sent to the challenge, the proof and the mutation.
 */
export type IdentityOperationBinding =
  | {
      operation: "instance_admin_grant";
      targetUserId: string;
    }
  | {
      operation: "instance_admin_suspend";
      targetUserId: string;
      request: { reason?: string; expiresAt?: string | null };
    }
  | {
      operation: "mfa_reset";
      userId: string;
      verificationNote: string;
    }
  | {
      operation: "impersonation_start";
      targetUserId: string;
      reason: string;
    }
  | {
      operation: "identity_connection_create";
      request: IdentityConnectionCreateBody;
    }
  | {
      operation: "identity_connection_configure";
      connectionId: string;
      request: IdentityConnectionConfigureBody;
    }
  | {
      operation: "scim_admin_update";
      connectionId: string;
      request: ScimAdminRequest;
    }
  | {
      operation: "scim_token_rotate" | "scim_token_revoke";
      connectionId: string;
      version: number;
    }
  | {
      operation: "webhook_create";
      workspaceId: string;
      name: string;
      url: string;
      events: string[];
    }
  | {
      operation: "webhook_update_url";
      workspaceId: string;
      webhookId: string;
      url: string;
    }
  | {
      operation: "webhook_rotate_secret";
      workspaceId: string;
      webhookId: string;
    }
  | {
      operation: "secrets_rotate";
    }
  | {
      operation: "webhook_rotate_all";
      replacementSetDigest: string;
    }
  | {
      operation: "organisation_restore";
      organisationId: string;
      expectedOperationId: string;
      expectedGeneration: number;
    }
  | {
      operation: "workspace_role_create";
      workspaceId: string;
      role: string;
      description?: string | null;
      rank?: number;
      capabilities?: string[];
      cloneFromRoleId?: string;
    }
  | {
      operation: "workspace_role_update";
      workspaceId: string;
      roleId: string;
      name?: string;
      description?: string | null;
      rank?: number;
      capabilities?: string[];
      expectedVersion?: string;
    }
  | {
      operation: "service_key_reattest";
      workspaceId: string;
      keyId: string;
      expectedVersion: number;
    }
  | {
      operation: "workspace_ownership_transfer";
      workspaceId: string;
      newOwnerUserId: string;
    }
  | {
      operation: "service_key_create";
      workspaceId: string;
      name: string;
      expiresIn?: number | null;
      capabilities: string[];
      ipAllowlist?: string[];
      rateLimitPerMinute?: number;
    }
  | {
      operation: "change_freeze_override";
      workspaceId: string;
      workItemKey: string;
      reason: string;
      windowStart?: string | null;
      windowEnd?: string | null;
    };

export type IdentityStepUpFactor = { method: StepUpMethod; secret: string };

const stepUp = client.me["step-up"];

/**
 * Obtains one single-use proof token for one operation. The secret is only used for this call; it
 * is never stored in a query or mutation cache.
 */
export async function proveIdentityOperation(
  binding: IdentityOperationBinding,
  factor: IdentityStepUpFactor,
): Promise<string> {
  const operationBinding = { kind: "operation" as const, ...binding };
  if (factor.method === "sso_prompt_login") {
    const popup =
      typeof window === "undefined"
        ? null
        : window.open("about:blank", "_blank", "popup,width=520,height=720");
    if (!popup) throw new Error("Fresh authentication is unavailable");
    popup.opener = null;
    try {
      const { proveSsoStepUpBinding } = await import("./sso-identity-step-up");
      return await proveSsoStepUpBinding(operationBinding, popup);
    } finally {
      if (!popup.closed) popup.close();
    }
  }
  const challengeResponse = await stepUp.challenges.$post({
    json: operationBinding as never,
  });
  await ensureIdentityAdminOk(
    challengeResponse,
    "Fresh authentication is unavailable",
  );
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const credential =
    factor.method === "password"
      ? { method: "password" as const, password: factor.secret }
      : { method: factor.method, code: factor.secret };
  const proofResponse = await stepUp.$post({
    json: {
      ...operationBinding,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      ...credential,
    } as never,
  });
  await ensureIdentityAdminOk(
    proofResponse,
    "Fresh authentication could not be verified",
  );
  return ((await proofResponse.json()) as { token: string }).token;
}
