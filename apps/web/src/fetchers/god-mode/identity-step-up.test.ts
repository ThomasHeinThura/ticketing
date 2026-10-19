import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  challenge: vi.fn(),
  prove: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    me: {
      "step-up": Object.assign((...args: unknown[]) => mocks.prove(...args), {
        $post: (...args: unknown[]) => mocks.prove(...args),
        challenges: { $post: (...args: unknown[]) => mocks.challenge(...args) },
      }),
    },
  },
}));

import { proveIdentityOperation } from "./identity-step-up";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  mocks.challenge.mockReset();
  mocks.prove.mockReset();
  mocks.challenge.mockResolvedValue(
    ok({ challengeId: "challenge-1", nonce: "n".repeat(43) }),
  );
  mocks.prove.mockResolvedValue(ok({ token: "t".repeat(43) }));
});

describe("proveIdentityOperation", () => {
  it("binds the scim_admin_update operation to the connection and the exact request", async () => {
    const request = {
      configVersion: 4,
      kind: "settings" as const,
      enabled: true,
    };
    const token = await proveIdentityOperation(
      { operation: "scim_admin_update", connectionId: "conn-1", request },
      { method: "totp", secret: "123456" },
    );
    expect(token).toBe("t".repeat(43));
    expect(mocks.challenge.mock.calls[0]?.[0]).toEqual({
      json: {
        kind: "operation",
        operation: "scim_admin_update",
        connectionId: "conn-1",
        request,
      },
    });
    expect(mocks.prove.mock.calls[0]?.[0]).toEqual({
      json: {
        kind: "operation",
        operation: "scim_admin_update",
        connectionId: "conn-1",
        request,
        challengeId: "challenge-1",
        nonce: "n".repeat(43),
        method: "totp",
        code: "123456",
      },
    });
  });

  it("binds token operations to the version only and sends a password as a password", async () => {
    await proveIdentityOperation(
      { operation: "scim_token_rotate", connectionId: "conn-1", version: 9 },
      { method: "password", secret: "placeholder-password" },
    );
    expect(mocks.challenge.mock.calls[0]?.[0]).toEqual({
      json: {
        kind: "operation",
        operation: "scim_token_rotate",
        connectionId: "conn-1",
        version: 9,
      },
    });
    const [proofCall] = mocks.prove.mock.calls[0] as [
      { json: Record<string, unknown> },
    ];
    const proof = proofCall.json;
    expect(proof).toMatchObject({
      method: "password",
      password: "placeholder-password",
    });
    expect(proof).not.toHaveProperty("code");
  });

  it("stops at a refused challenge without attempting a proof", async () => {
    mocks.challenge.mockResolvedValue(
      new Response("step_up_unavailable", { status: 403 }),
    );
    await expect(
      proveIdentityOperation(
        { operation: "scim_token_revoke", connectionId: "conn-1", version: 2 },
        { method: "backup_code", secret: "code" },
      ),
    ).rejects.toMatchObject({ status: 403, kind: "step_up" });
    expect(mocks.prove).not.toHaveBeenCalled();
  });

  it("surfaces a version conflict from the challenge with the current version", async () => {
    mocks.challenge.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "version_conflict", version: 12 }),
        {
          status: 409,
        },
      ),
    );
    await expect(
      proveIdentityOperation(
        { operation: "scim_token_rotate", connectionId: "conn-1", version: 2 },
        { method: "totp", secret: "123456" },
      ),
    ).rejects.toMatchObject({ kind: "conflict", currentVersion: 12 });
  });
});
