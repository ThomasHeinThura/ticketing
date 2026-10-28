import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { z } from "../openapi";
import { loadLocalFactorState } from "./local-factor-service";
import type { StepUpExecutor } from "./repository";
import { appendStepUpAudit } from "./step-up-audit";
import { consumeExtProof, type ExtInput } from "./step-up-ext";

/** The request header that carries a one-use, operation-bound PA-15 proof. */
export const STEP_UP_TOKEN_HEADER = "x-taskdesk-step-up-token";

/** OpenAPI declaration of the proof header, shared by every route that spends one. */
export const stepUpTokenHeader = z.object({
  [STEP_UP_TOKEN_HEADER]: z.string().length(43).optional(),
});

/** Thrown inside the spending transaction; mapped to `403 step_up_unavailable` once it rolled back. */
class StepUpUnavailableError extends Error {
  constructor() {
    super("step_up_unavailable");
  }
}

/**
 * Whether the proof's authentication method is acceptable for this person's factor state: a
 * password proof is refused once a second factor is enabled or required, and a code proof is
 * refused when none is enabled. Shared by every route that spends a proof.
 */
export function proofMethodAcceptable(
  authMethod: "password" | "totp" | "backup_code" | "sso_prompt_login",
  factor: { required: boolean; enabled: boolean },
): boolean {
  if (authMethod === "password" || authMethod === "sso_prompt_login")
    return !(factor.required || factor.enabled);
  return factor.enabled;
}

export type StepUpSpender = (tx: StepUpExecutor) => Promise<void>;

/**
 * Spends the caller's operation-bound step-up proof for `input` inside the caller's own mutation
 * transaction. Hand `spend` to the write and call it after every domain check and immediately
 * before the first write: a refusal, a conflict or any later failure rolls the consumption back
 * with the write, so a request that did nothing never burns a proof, and a request that did
 * something always did so with exactly one. The header is read here, at the spend point, so a
 * request refused for another reason keeps that reason.
 *
 * Throws `403 step_up_required` when no proof was supplied and `403 step_up_unavailable` when the
 * proof is missing, expired, spent, bound to anything else, or the wrong method for the person's
 * factor. The denial is audited after the rollback.
 */
export async function runWithStepUp<T>(
  c: Context,
  input: ExtInput,
  run: (spend: StepUpSpender) => Promise<T>,
): Promise<T> {
  const userId = c.get("userId") as string;
  const traceId = c.req.header("x-request-id");
  const token = c.req.header(STEP_UP_TOKEN_HEADER);
  const session = c.get("session") as { id: string } | null;
  // The factor state is read here, outside the mutation transaction (a plain read, so a request
  // without a proof never pays for it and the pool is not asked for a second connection while the
  // transaction holds one).
  const factor = token && session ? await loadLocalFactorState(userId) : null;
  const spend: StepUpSpender = async (tx) => {
    if (!token) throw new HTTPException(403, { message: "step_up_required" });
    if (!session || !factor)
      throw new HTTPException(401, { message: "Unauthorized" });
    const proof = await consumeExtProof(
      tx,
      { token, personId: factor.personId, sessionId: session.id },
      input,
    );
    const currentFactor = await loadLocalFactorState(userId, tx);
    if (
      !proof ||
      currentFactor.personId !== factor.personId ||
      !proofMethodAcceptable(proof.authMethod, currentFactor)
    )
      throw new StepUpUnavailableError();
    await appendStepUpAudit(tx, {
      action: "auth.step_up_consumed",
      actorId: userId,
      personId: factor.personId,
      operation: input.operation,
      traceId,
    });
  };
  try {
    return await run(spend);
  } catch (error) {
    if (!(error instanceof StepUpUnavailableError)) throw error;
    if (factor)
      await appendStepUpAudit(db, {
        action: "auth.step_up_denied",
        actorId: userId,
        personId: factor.personId,
        operation: input.operation,
        traceId,
      });
    throw new HTTPException(403, { message: "step_up_unavailable" });
  }
}
