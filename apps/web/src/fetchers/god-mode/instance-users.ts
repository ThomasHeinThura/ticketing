import { client } from "@taskdesk/libs";
import type { InferRequestType, InferResponseType } from "hono/client";
import { HttpError } from "@/lib/http-error";

const users = client.instance.users;
const detail = users[":id"];

export type InstanceUserPage = InferResponseType<typeof users.$get, 200>;
export type InstanceUser = InferResponseType<typeof detail.$get, 200>;
export type InstanceUserFilters = NonNullable<
  InferRequestType<typeof users.$get>["query"]
>;
export type CurrentFactorStatus = InferResponseType<
  typeof client.me.security.factors.$get,
  200
>;

export async function getCurrentFactorStatus(): Promise<CurrentFactorStatus> {
  const response = await client.me.security.factors.$get();
  await ensureOk(response, "Unable to read current authentication status");
  return (await response.json()) as CurrentFactorStatus;
}

async function ensureOk(response: Response, message: string): Promise<void> {
  if (!response.ok) {
    throw new HttpError(response.status, message);
  }
}

export async function getInstanceUsers(
  query: InstanceUserFilters,
): Promise<InstanceUserPage> {
  const response = await users.$get({ query });
  await ensureOk(response, "Unable to load instance users");
  return (await response.json()) as InstanceUserPage;
}

export async function getInstanceUser(id: string): Promise<InstanceUser> {
  const response = await detail.$get({ param: { id } });
  await ensureOk(response, "Unable to load this user");
  return (await response.json()) as InstanceUser;
}

export async function suspendInstanceUser(input: {
  id: string;
  reason?: string;
  expiresAt?: string | null;
}) {
  const response = await detail.suspend.$post({
    param: { id: input.id },
    json: {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    },
  });
  await ensureOk(response, "Unable to suspend this user");
  return response.json();
}

export async function unsuspendInstanceUser(id: string) {
  const response = await detail.unsuspend.$post({
    param: { id },
    json: {},
  });
  await ensureOk(response, "Unable to unsuspend this user");
  return response.json();
}

export async function signOutInstanceUser(id: string) {
  const response = await detail["sign-out"].$post({
    param: { id },
    json: {},
  });
  await ensureOk(response, "Unable to sign out this user");
  return response.json();
}

export async function grantInstanceAdmin(input: { id: string; token: string }) {
  const response = await detail["grant-admin"].$post({
    param: { id: input.id },
    header: { "x-taskdesk-step-up-token": input.token },
    json: {},
  });
  await ensureOk(response, "Unable to grant instance administrator access");
  return response.json();
}

export async function resetInstanceUserMfa(input: {
  id: string;
  verificationNote: string;
  token: string;
}) {
  const response = await detail["reset-mfa"].$post({
    param: { id: input.id },
    header: { "x-taskdesk-step-up-token": input.token },
    json: { verificationNote: input.verificationNote },
  });
  await ensureOk(response, "Unable to reset this user's MFA");
  return response.json();
}

export type StepUpMethod = "password" | "totp" | "backup_code";

export async function createUserOperationProof(input: {
  operation: "instance_admin_grant" | "mfa_reset";
  userId: string;
  verificationNote?: string;
  method: StepUpMethod;
  secret: string;
}) {
  const binding =
    input.operation === "instance_admin_grant"
      ? {
          kind: "operation" as const,
          operation: input.operation,
          targetUserId: input.userId,
        }
      : {
          kind: "operation" as const,
          operation: input.operation,
          userId: input.userId,
          verificationNote: input.verificationNote ?? "",
        };
  const challengeResponse = await client.me["step-up"].challenges.$post({
    json: binding,
  });
  await ensureOk(challengeResponse, "Fresh authentication is unavailable");
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const challengeFields = {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
  };
  const proofResponse =
    input.operation === "instance_admin_grant"
      ? input.method === "password"
        ? await client.me["step-up"].$post({
            json: {
              ...binding,
              ...challengeFields,
              method: "password",
              password: input.secret,
            },
          })
        : input.method === "totp"
          ? await client.me["step-up"].$post({
              json: {
                ...binding,
                ...challengeFields,
                method: "totp",
                code: input.secret,
              },
            })
          : await client.me["step-up"].$post({
              json: {
                ...binding,
                ...challengeFields,
                method: "backup_code",
                code: input.secret,
              },
            })
      : input.method === "password"
        ? await client.me["step-up"].$post({
            json: {
              ...binding,
              ...challengeFields,
              method: "password",
              password: input.secret,
            },
          })
        : input.method === "totp"
          ? await client.me["step-up"].$post({
              json: {
                ...binding,
                ...challengeFields,
                method: "totp",
                code: input.secret,
              },
            })
          : await client.me["step-up"].$post({
              json: {
                ...binding,
                ...challengeFields,
                method: "backup_code",
                code: input.secret,
              },
            });
  await ensureOk(proofResponse, "Fresh authentication could not be verified");
  const proof = (await proofResponse.json()) as { token: string };
  return proof.token;
}
