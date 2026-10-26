import { client } from "@taskdesk/libs";
import {
  ensureIdentityAdminOk,
  IdentityAdminError,
} from "./identity-admin-error";
import type { IdentityOperationBinding } from "./identity-step-up";

const stepUp = client.me["step-up"];

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function rejectedSsoStepUp(message: string) {
  return new IdentityAdminError(403, message, "step_up", null);
}

/** SSO popup runner is dynamically imported only for an explicitly selected SSO proof. */
export type SsoStepUpBinding =
  | ({ kind: "operation" } & IdentityOperationBinding)
  | { kind: "pending_action"; pendingActionId: string };

export async function proveSsoStepUpBinding(
  binding: SsoStepUpBinding,
  popup: Window,
): Promise<string> {
  const challengeResponse = await stepUp.challenges.$post({
    json: binding as never,
  });
  await ensureIdentityAdminOk(
    challengeResponse,
    "Fresh authentication is unavailable",
  );
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
    expiresAt: string;
  };
  const startResponse = await stepUp.sso.start.$post({
    json: { challengeId: challenge.challengeId, nonce: challenge.nonce },
  });
  await ensureIdentityAdminOk(startResponse, "SSO step-up is unavailable");
  const start = (await startResponse.json()) as { authorizationUrl: string };
  popup.location.replace(start.authorizationUrl);

  const deadline = Math.min(
    Date.parse(challenge.expiresAt),
    Date.now() + 5 * 60_000,
  );
  while (Date.now() < deadline) {
    if (popup.closed)
      throw rejectedSsoStepUp("Fresh authentication could not be verified");
    const statusResponse = await stepUp.sso.status.$post({
      json: { challengeId: challenge.challengeId },
    });
    await ensureIdentityAdminOk(
      statusResponse,
      "SSO step-up status is unavailable",
    );
    const status = (await statusResponse.json()) as {
      status: "pending" | "verified" | "failed";
    };
    if (status.status === "verified") break;
    if (status.status === "failed")
      throw rejectedSsoStepUp("Fresh authentication could not be verified");
    await pause(700);
  }
  if (Date.now() >= deadline)
    throw rejectedSsoStepUp("Fresh authentication could not be verified");

  const proofResponse = await stepUp.$post({
    json: {
      ...binding,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "sso_prompt_login",
    } as never,
  });
  await ensureIdentityAdminOk(
    proofResponse,
    "Fresh authentication could not be verified",
  );
  return ((await proofResponse.json()) as { token: string }).token;
}
