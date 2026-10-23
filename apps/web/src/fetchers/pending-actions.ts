import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import type { StepUpMethod } from "@/fetchers/god-mode/instance-users";
import { HttpError, readErrorDetail } from "@/lib/http-error";

const pendingActions = client.me["pending-actions"];

export type OwnPendingActions = InferResponseType<
  typeof pendingActions.$get,
  200
>;
export type OwnPendingAction = InferResponseType<
  (typeof pendingActions)[":id"]["$get"],
  200
>;

async function ensureOk(response: Response, message: string) {
  if (!response.ok) throw new HttpError(response.status, message);
}

/**
 * Step-up refusals carry the API's code (`step_up_unavailable` for a wrong proof,
 * `step_up_attempt_limit` on `429`, `Forbidden`), which the approval UI maps to a specific
 * message; any other failure keeps the generic one.
 */
async function ensureProofOk(response: Response, message: string) {
  if (response.ok) return;
  const detail = await readErrorDetail(response, message);
  throw new HttpError(
    response.status,
    response.status === 403 || response.status === 429 ? detail : message,
  );
}

export async function getOwnPendingActions(
  cursor?: string,
): Promise<OwnPendingActions> {
  const response = await pendingActions.$get({
    query: { limit: "50", ...(cursor ? { cursor } : {}) },
  });
  await ensureOk(response, "Unable to load pending actions");
  return (await response.json()) as OwnPendingActions;
}

export async function getOwnPendingAction(
  id: string,
): Promise<OwnPendingAction> {
  const response = await pendingActions[":id"].$get({ param: { id } });
  await ensureOk(response, "Unable to load this pending action");
  return (await response.json()) as OwnPendingAction;
}

export async function cancelOwnPendingAction(id: string) {
  const response = await pendingActions[":id"].cancel.$post({
    param: { id },
  });
  await ensureOk(response, "Unable to cancel this pending action");
  return response.json();
}

export async function createPendingActionProof(input: {
  pendingActionId: string;
  method: StepUpMethod;
  secret: string;
}) {
  const binding = {
    kind: "pending_action" as const,
    pendingActionId: input.pendingActionId,
  };
  const challengeResponse = await client.me["step-up"].challenges.$post({
    json: binding,
  });
  await ensureProofOk(challengeResponse, "Fresh authentication is unavailable");
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const challengeFields = {
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
  };
  const proofResponse =
    input.method === "password"
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
  await ensureProofOk(
    proofResponse,
    "Fresh authentication could not be verified",
  );
  const proof = (await proofResponse.json()) as { token: string };
  return proof.token;
}

export async function approveOwnPendingAction(input: {
  id: string;
  typedName?: string;
  typedCount?: string;
  stepUpToken?: string;
}) {
  const response = await pendingActions[":id"].approve.$post({
    param: { id: input.id },
    header: input.stepUpToken
      ? { "x-taskdesk-step-up-token": input.stepUpToken }
      : {},
    json: {
      ...(input.typedName === undefined ? {} : { typedName: input.typedName }),
      ...(input.typedCount === undefined
        ? {}
        : { typedCount: input.typedCount }),
    },
  });
  await ensureOk(response, "Unable to approve this pending action");
  return response.json();
}
