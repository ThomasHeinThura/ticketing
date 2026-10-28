import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExtChallenge,
  extChallengeSchemas,
  extProveSchemas,
  extSsoProveSchemas,
  WEBHOOK_ROTATE_ALL_OPERATION,
  WEBHOOK_ROTATE_ALL_ROUTE,
} from "../../../apps/api/src/auth/step-up-ext";
import * as operationService from "../../../apps/api/src/auth/step-up-service";

const digest = "ab".repeat(32);
const request = {
  kind: "operation" as const,
  operation: WEBHOOK_ROTATE_ALL_OPERATION,
  replacementSetDigest: digest,
};
afterEach(() => vi.restoreAllMocks());
const accepted = (
  schemas: readonly { safeParse: (x: unknown) => { success: boolean } }[],
  value: unknown,
) => schemas.some((schema) => schema.safeParse(value).success);
describe("WH-13 digest-only operation proof", () => {
  it("accepts the digest and refuses replacement entries on every challenge/proof path", () => {
    expect(accepted(extChallengeSchemas, request)).toBe(true);
    expect(
      accepted(extChallengeSchemas, {
        ...request,
        replacementSetDigest: "invalid",
      }),
    ).toBe(false);
    expect(accepted(extChallengeSchemas, { ...request, webhooks: [] })).toBe(
      false,
    );
    const proof = {
      ...request,
      challengeId: "challenge",
      nonce: "nonce",
      method: "password",
      password: "test-password",
    };
    expect(accepted(extProveSchemas, { ...proof, webhooks: [] })).toBe(false);
    expect(
      accepted(extSsoProveSchemas, {
        ...proof,
        method: "sso_prompt_login",
        webhooks: [],
      }),
    ).toBe(false);
  });
  it("binds only the exact digest to the fixed route and operation", async () => {
    const captured = new Error("captured operation binding");
    const spy = vi
      .spyOn(operationService, "createOperationChallenge")
      .mockRejectedValue(captured);
    await expect(
      createExtChallenge({ personId: "person", sessionId: "session" }, request),
    ).rejects.toBe(captured);
    const input = spy.mock.calls[0]?.[0];
    expect(input?.operation).toBe(WEBHOOK_ROTATE_ALL_OPERATION);
    expect(input?.route).toBe(WEBHOOK_ROTATE_ALL_ROUTE);
    expect(JSON.parse(input?.body.toString("utf8") ?? "null")).toEqual({
      operation: WEBHOOK_ROTATE_ALL_OPERATION,
      route: WEBHOOK_ROTATE_ALL_ROUTE,
      version: 1,
      request: { replacementSetDigest: digest },
    });
  });
});
