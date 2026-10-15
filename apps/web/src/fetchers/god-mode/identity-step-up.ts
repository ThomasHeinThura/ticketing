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
