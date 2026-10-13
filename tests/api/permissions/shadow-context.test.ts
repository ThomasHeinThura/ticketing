import { describe, expect, it } from "vitest";
import {
  ensurePolicyRequestId,
  policyRequestId,
  setStrictPolicyWitness,
  strictPolicyWitness,
} from "../../../apps/api/src/permissions/shadow-context";

function context(headers: Record<string, string> = {}) {
  const values = new Map<string, unknown>();
  return {
    req: { header: (name: string) => headers[name.toLowerCase()] },
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
  } as never;
}

describe("strict policy request witness context", () => {
  it("creates a stable opaque server id without adopting a forged inbound id", () => {
    const c = context({ "x-request-id": "forged-correlation" });
    const first = ensurePolicyRequestId(c);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(ensurePolicyRequestId(c)).toBe(first);
    expect(policyRequestId(c)).toBe(first);
    expect(first).not.toBe("forged-correlation");
  });

  it("keeps only the typed strict witness in request context", () => {
    const c = context();
    const requestId = ensurePolicyRequestId(c);
    const witness = {
      requestId,
      route: "GET /api/asset/{id}" as never,
      policySource: "apps/api/src/asset/policy.ts",
      decisionCategory: "denied" as const,
      provenanceValidationResult: "complete" as const,
    };
    setStrictPolicyWitness(c, witness);
    expect(strictPolicyWitness(c)).toEqual(witness);
  });
});
