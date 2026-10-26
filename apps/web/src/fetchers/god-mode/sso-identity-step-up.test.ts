import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IdentityAdminError,
  identityAdminFailureKind,
} from "./identity-admin-error";

const mocks = vi.hoisted(() => ({
  challenge: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  prove: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    me: {
      "step-up": Object.assign((...args: unknown[]) => mocks.prove(...args), {
        $post: (...args: unknown[]) => mocks.prove(...args),
        challenges: { $post: (...args: unknown[]) => mocks.challenge(...args) },
        sso: {
          start: { $post: (...args: unknown[]) => mocks.start(...args) },
          status: { $post: (...args: unknown[]) => mocks.status(...args) },
        },
      }),
    },
  },
}));

import { proveSsoStepUpBinding } from "./sso-identity-step-up";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  mocks.challenge.mockReset().mockResolvedValue(
    ok({
      challengeId: "challenge-1",
      nonce: "n".repeat(43),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  mocks.start.mockReset().mockResolvedValue(
    ok({
      authorizationUrl: "https://login.example.test/authorize?state=one-use",
    }),
  );
  mocks.status.mockReset().mockResolvedValue(ok({ status: "verified" }));
  mocks.prove.mockReset().mockResolvedValue(ok({ token: "t".repeat(43) }));
});

describe("SSO step-up browser transport", () => {
  it("keeps the original operation binding in the server proof call", async () => {
    const popup = {
      location: { replace: vi.fn() },
      closed: false,
    } as unknown as Window;
    const binding = {
      kind: "operation" as const,
      operation: "scim_token_rotate" as const,
      connectionId: "conn-1",
      version: 9,
    };

    await expect(proveSsoStepUpBinding(binding, popup)).resolves.toBe(
      "t".repeat(43),
    );
    expect(mocks.challenge).toHaveBeenCalledWith({ json: binding });
    expect(mocks.start).toHaveBeenCalledWith({
      json: { challengeId: "challenge-1", nonce: "n".repeat(43) },
    });
    expect(popup.location.replace).toHaveBeenCalledWith(
      "https://login.example.test/authorize?state=one-use",
    );
    expect(mocks.status).toHaveBeenCalledWith({
      json: { challengeId: "challenge-1" },
    });
    expect(mocks.prove).toHaveBeenCalledWith({
      json: {
        ...binding,
        challengeId: "challenge-1",
        nonce: "n".repeat(43),
        method: "sso_prompt_login",
      },
    });
  });

  it("supports pending-action proofs without exposing the token to the popup", async () => {
    const popup = {
      location: { replace: vi.fn() },
      closed: false,
    } as unknown as Window;
    const binding = {
      kind: "pending_action" as const,
      pendingActionId: "pending-1",
    };

    await proveSsoStepUpBinding(binding, popup);
    expect(mocks.challenge).toHaveBeenCalledWith({ json: binding });
    expect(mocks.prove).toHaveBeenCalledWith({
      json: {
        ...binding,
        challengeId: "challenge-1",
        nonce: "n".repeat(43),
        method: "sso_prompt_login",
      },
    });
    expect(popup.location.replace).toHaveBeenCalledTimes(1);
  });

  it("classifies a rejected callback as a safe step-up failure and never asks for proof", async () => {
    mocks.status.mockResolvedValue(ok({ status: "failed" }));
    const popup = {
      location: { replace: vi.fn() },
      closed: false,
    } as unknown as Window;

    let failure: unknown;
    try {
      await proveSsoStepUpBinding(
        { kind: "operation", operation: "secrets_rotate" },
        popup,
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(IdentityAdminError);
    expect(failure).toMatchObject({ status: 403, detail: "step_up" });
    expect(identityAdminFailureKind(failure)).toBe("step_up");
    expect(mocks.prove).not.toHaveBeenCalled();
  });
});
