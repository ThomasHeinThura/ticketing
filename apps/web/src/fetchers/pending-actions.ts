import { client } from "@taskdesk/libs";
import type { InferResponseType } from "hono/client";
import type { StepUpMethod } from "@/fetchers/god-mode/instance-users";
import { HttpError } from "@/lib/http-error";

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
  await ensureOk(challengeResponse, "Fresh authentication is unavailable");
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proofResponse =
    input.method === "password"
      ? await client.me["step-up"].$post({
          json: {
            ...binding,
            ...challenge,
            method: "password",
            password: input.secret,
          },
        })
      : input.method === "totp"
        ? await client.me["step-up"].$post({
            json: {
              ...binding,
              ...challenge,
              method: "totp",
              code: input.secret,
            },
          })
        : await client.me["step-up"].$post({
            json: {
              ...binding,
              ...challenge,
              method: "backup_code",
              code: input.secret,
            },
          });
  await ensureOk(proofResponse, "Fresh authentication could not be verified");
  const proof = (await proofResponse.json()) as { token: string };
  return proof.token;
}

export async function approveOwnPendingAction(input: {
  id: string;
  typedName?: string;
  stepUpToken?: string;
}) {
  const response = await pendingActions[":id"].approve.$post({
    param: { id: input.id },
    header: input.stepUpToken
      ? { "x-taskdesk-step-up-token": input.stepUpToken }
      : {},
    json: input.typedName === undefined ? {} : { typedName: input.typedName },
  });
  await ensureOk(response, "Unable to approve this pending action");
  return response.json();
}

export const approveOwnDeactivation = approveOwnPendingAction;
