import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingActionProof } from "./pending-actions";

const mocks = vi.hoisted(() => ({
  challengePost: vi.fn(),
  proofPost: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    me: {
      "step-up": {
        challenges: { $post: mocks.challengePost },
        $post: mocks.proofPost,
      },
      "pending-actions": {},
    },
  },
}));

const proofCases = [
  { method: "password", field: "password" },
  { method: "totp", field: "code" },
  { method: "backup_code", field: "code" },
] as const;

describe("createPendingActionProof", () => {
  beforeEach(() => {
    mocks.challengePost.mockReset();
    mocks.proofPost.mockReset();
    mocks.challengePost.mockResolvedValue({
      ok: true,
      json: async () => ({
        challengeId: "challenge-1",
        nonce: "n".repeat(43),
        expiresAt: "2030-01-01T00:00:00.000Z",
      }),
    });
    mocks.proofPost.mockImplementation(
      (request: { json: Record<string, unknown> }) => {
        const outgoingProof = JSON.parse(
          JSON.stringify(request.json),
        ) as Record<string, unknown>;
        const authField =
          outgoingProof.method === "password" ? "password" : "code";
        const expectedKeys = [
          "kind",
          "pendingActionId",
          "challengeId",
          "nonce",
          "method",
          authField,
        ].sort();
        if (
          JSON.stringify(Object.keys(outgoingProof).sort()) !==
          JSON.stringify(expectedKeys)
        ) {
          return { ok: false, status: 400 };
        }
        return {
          ok: true,
          json: async () => ({ token: "single-use-step-up-token" }),
        };
      },
    );
  });

  it.each(proofCases)(
    "copies only challenge ID and nonce for $method proofs",
    async ({ method, field }) => {
      const secret = "synthetic-proof-value";
      const token = await createPendingActionProof({
        pendingActionId: "pending-action-1",
        method,
        secret,
      });

      expect(mocks.challengePost).toHaveBeenCalledWith({
        json: {
          kind: "pending_action",
          pendingActionId: "pending-action-1",
        },
      });
      expect(token).toBe("single-use-step-up-token");

      const proofRequest = mocks.proofPost.mock.calls[0]?.[0] as {
        json: Record<string, unknown>;
      };
      const outgoingProof = JSON.parse(
        JSON.stringify(proofRequest.json),
      ) as Record<string, unknown>;
      expect(outgoingProof).toEqual({
        kind: "pending_action",
        pendingActionId: "pending-action-1",
        challengeId: "challenge-1",
        nonce: "n".repeat(43),
        method,
        [field]: secret,
      });
      expect(outgoingProof).not.toHaveProperty("expiresAt");
    },
  );
});
