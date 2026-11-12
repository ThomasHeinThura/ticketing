import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_ONLY_ACTIONS } from "../../../apps/api/src/audit/actions";
import {
  deriveCustomerInvitationCredential,
  resolveCustomerInvitationCredentialForCopy,
} from "../../../apps/api/src/customer-invitation/credential-key";
import {
  buildAcceptLink,
  credentialMatches,
} from "../../../apps/api/src/customer-invitation/logic";
import { requireAgentBrowserSession } from "../../../apps/api/src/utils/require-agent-browser-session";
import {
  requireCopyInvitationLinkRateLimit,
  resetCopyInvitationLinkRateLimitBuckets,
} from "../../../apps/api/src/utils/require-copy-link-rate-limit";
import { requireInvitationCopyAccess } from "../../../apps/api/src/utils/require-invitation-copy-access";

const KEY_A = "11".repeat(32);
const KEY_B = "22".repeat(32);
const PORTAL_ORIGIN = "https://portal.example.test";

const originalKey = process.env.TASKDESK_ENCRYPTION_KEY;
const originalPrevKey = process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;

beforeEach(() => {
  process.env.TASKDESK_ENCRYPTION_KEY = KEY_A;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  resetCopyInvitationLinkRateLimitBuckets();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalKey;

  if (originalPrevKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  else process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS = originalPrevKey;

  resetCopyInvitationLinkRateLimitBuckets();
  vi.restoreAllMocks();
});

describe("customer invitation credential derivation (CP-23, D-N)", () => {
  it("produces the exact same accept link until resend, and a different link once generation increments", () => {
    const gen1First = deriveCustomerInvitationCredential("inv_abc123", 1);
    const gen1Second = deriveCustomerInvitationCredential("inv_abc123", 1);
    expect(gen1First).toEqual(gen1Second);
    expect(gen1First.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gen1First.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(gen1First.hash).not.toContain(gen1First.credential);

    const emailedLink = buildAcceptLink(
      PORTAL_ORIGIN,
      "inv_abc123",
      gen1First.credential,
    );
    const copiedCredential = resolveCustomerInvitationCredentialForCopy({
      invitationId: "inv_abc123",
      generation: 1,
      storedHash: gen1First.hash,
    });
    expect(copiedCredential).toBe(gen1First.credential);
    expect(
      buildAcceptLink(PORTAL_ORIGIN, "inv_abc123", copiedCredential ?? ""),
    ).toBe(emailedLink);

    // Resend increments generation -> new credential, previous link stops matching storedHash.
    const gen2 = deriveCustomerInvitationCredential("inv_abc123", 2);
    expect(gen2.credential).not.toBe(gen1First.credential);
    expect(gen2.hash).not.toBe(gen1First.hash);
    expect(credentialMatches(gen2.hash, gen1First.credential)).toBe(false);
    expect(credentialMatches(gen2.hash, gen2.credential)).toBe(true);
  });

  it("derives via a purpose-specific HKDF sub-key rather than reusing the raw master key directly", () => {
    const derived = deriveCustomerInvitationCredential("inv_subkey", 1);
    const directMasterHmac = createHmac("sha256", Buffer.from(KEY_A, "hex"))
      .update("inv_subkey:1", "utf8")
      .digest("base64url");
    expect(derived.credential).not.toBe(directMasterHmac);
  });

  it("falls back to TASKDESK_ENCRYPTION_KEY_PREVIOUS during key rotation and fails when neither key matches", () => {
    const beforeRotation = deriveCustomerInvitationCredential("inv_rot", 1);

    process.env.TASKDESK_ENCRYPTION_KEY = KEY_B;
    process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS = KEY_A;

    expect(
      resolveCustomerInvitationCredentialForCopy({
        invitationId: "inv_rot",
        generation: 1,
        storedHash: beforeRotation.hash,
      }),
    ).toBe(beforeRotation.credential);

    // Without the matching previous key (or for a pre-0221 random hash), reconstruction fails closed.
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
    expect(
      resolveCustomerInvitationCredentialForCopy({
        invitationId: "inv_rot",
        generation: 1,
        storedHash: beforeRotation.hash,
      }),
    ).toBeNull();
  });

  it("invalidates acceptance after revoke clears credentialHash while preserving anti-oracle copy behaviour on inert rows", () => {
    const issued = deriveCustomerInvitationCredential("inv_revoked", 1);
    // Revoke clears credentialHash to null -> credentialMatches is always false.
    expect(credentialMatches(null, issued.credential)).toBe(false);

    // Inert pending rows (CP-22 anti-oracle) have storedHash === null; copy still derives
    // deterministically without revealing inertness, while accept refuses because storedHash is null.
    const inertCopied = resolveCustomerInvitationCredentialForCopy({
      invitationId: "inv_inert",
      generation: 1,
      storedHash: null,
    });
    expect(inertCopied).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credentialMatches(null, inertCopied ?? "")).toBe(false);
  });
});

describe("copy-link endpoint guards, permissions, rate limit and audit contract", () => {
  type TestVars = {
    workspaceId: string;
    userId: string | undefined;
    session: { impersonatedBy?: string | null; portal?: string | null } | null;
    apiKey: { id: string; isMcp?: boolean } | null;
    policyRowFacts?: { createdBy: string };
  };

  function createGuardedTestApp(options: {
    now?: () => number;
    maxRequests?: number;
    invitationRow?: {
      id: string;
      inviterId: string;
      inviterPersonId: string;
      email: string;
      status: "pending" | "accepted" | "canceled";
      expiresAt: Date;
      generation: number;
      credentialHash: string | null;
    } | null;
    callerHasInviteCapability?: boolean;
    callerHasWorkspaceRead?: boolean;
    auditSink?: Array<Record<string, unknown>>;
  }) {
    const app = new Hono<{ Variables: TestVars }>();
    const row = options.invitationRow ?? null;
    const audits = options.auditSink ?? [];

    app.use("*", async (c, next) => {
      c.set("workspaceId", "ws_1");
      const actorHeader = c.req.header("x-test-user");
      c.set("userId", actorHeader || undefined);
      const authKind = c.req.header("x-test-auth") ?? "session";
      if (authKind === "apikey") {
        c.set("apiKey", { id: "ak_1" });
        c.set("session", null);
      } else if (authKind === "mcp") {
        c.set("apiKey", { id: "ak_mcp_1", isMcp: true });
        c.set("session", null);
      } else if (authKind === "none") {
        c.set("apiKey", null);
        c.set("session", null);
      } else if (authKind === "impersonated") {
        c.set("apiKey", null);
        c.set("session", { impersonatedBy: "admin_1", portal: "agent" });
      } else if (authKind === "portal-session") {
        c.set("apiKey", null);
        c.set("session", { portal: "customer" });
      } else {
        c.set("apiKey", null);
        c.set("session", { portal: "agent" });
      }
      return next();
    });

    app.post(
      "/workspace/:workspaceId/organisations/:organisationId/invitations/:id/copy-link",
      requireAgentBrowserSession({
        resolvePortal: (host) =>
          host === "portal.example.test" ? "customer" : "agent",
      }),
      requireCopyInvitationLinkRateLimit({
        now: options.now,
        maxRequests: options.maxRequests ?? 30,
        windowMs: 60_000,
      }),
      requireInvitationCopyAccess({
        scope: "customer",
        idParam: "id",
        loadInvitationOwner: async ({ invitationId }) =>
          row && row.id === invitationId
            ? { inviterId: row.inviterId, inviterPersonId: row.inviterPersonId }
            : null,
        checkCapabilityOrOwner: async ({ isOwner }) => {
          if (options.callerHasInviteCapability) return;
          if (isOwner && (options.callerHasWorkspaceRead ?? true)) return;
          throw new HTTPException(403, { message: "Insufficient permissions" });
        },
      }),
      async (c) => {
        if (!row || row.id !== c.req.param("id")) {
          throw new HTTPException(404, { message: "Invitation not found" });
        }
        const currentMs = options.now ? options.now() : Date.now();
        if (row.status !== "pending" || row.expiresAt.getTime() <= currentMs) {
          throw new HTTPException(409, {
            message: "Only a pending, unexpired invitation link can be copied",
          });
        }
        const credential = resolveCustomerInvitationCredentialForCopy({
          invitationId: row.id,
          generation: row.generation,
          storedHash: row.credentialHash,
        });
        if (!credential) {
          throw new HTTPException(409, {
            message: "Invitation link is unavailable",
          });
        }
        audits.push({
          actorId: c.get("userId"),
          actorType: "user",
          apiKeyId: null,
          workspaceId: c.req.param("workspaceId"),
          organisationId: c.req.param("organisationId"),
          action: "invitation.link_copied",
          entityType: "invitation",
          entityId: row.id,
          before: null,
          after: { scope: "customer" },
        });
        c.header("Cache-Control", "no-store");
        return c.json(
          {
            link: buildAcceptLink(PORTAL_ORIGIN, row.id, credential),
            expiresAt: row.expiresAt.toISOString(),
          },
          200,
        );
      },
    );

    return { app, audits };
  }

  function makeLiveRow(
    overrides: Partial<{
      status: "pending" | "accepted" | "canceled";
      expiresAt: Date;
      generation: number;
      credentialHash: string | null;
    }> = {},
  ) {
    const generation = overrides.generation ?? 1;
    const derived = deriveCustomerInvitationCredential("inv_live", generation);
    return {
      id: "inv_live",
      inviterId: "user_inviter",
      inviterPersonId: "person_inviter",
      email: "secret.customer@example.test",
      status: overrides.status ?? ("pending" as const),
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000),
      generation,
      credentialHash:
        overrides.credentialHash === undefined
          ? derived.hash
          : overrides.credentialHash,
      expectedCredential: derived.credential,
    };
  }

  const path =
    "/workspace/ws_1/organisations/org_1/invitations/inv_live/copy-link";

  it("allows the original inviter (even without member:invite) and sets Cache-Control: no-store without extending expiry", async () => {
    const row = makeLiveRow();
    const originalExpiryIso = row.expiresAt.toISOString();
    const { app, audits } = createGuardedTestApp({
      invitationRow: row,
      callerHasInviteCapability: false,
      callerHasWorkspaceRead: true,
    });

    const res = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { link: string; expiresAt: string };
    expect(body).toEqual({
      link: `https://portal.example.test/invite/inv_live#t=${row.expectedCredential}`,
      expiresAt: originalExpiryIso,
    });
    expect(audits).toHaveLength(1);
  });

  it("allows a member:invite capability holder who was not the original inviter", async () => {
    const row = makeLiveRow();
    const { app } = createGuardedTestApp({
      invitationRow: row,
      callerHasInviteCapability: true,
    });

    const res = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_admin",
      },
    });
    expect(res.status).toBe(200);
  });

  it("refuses an unrelated workspace member without member:invite (403)", async () => {
    const row = makeLiveRow();
    const { app, audits } = createGuardedTestApp({
      invitationRow: row,
      callerHasInviteCapability: false,
      callerHasWorkspaceRead: true,
    });

    const res = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_unrelated_member",
      },
    });
    expect(res.status).toBe(403);
    expect(audits).toHaveLength(0);
  });

  it("refuses API keys, MCP keys, impersonation sessions, unauthenticated callers and portal hosts", async () => {
    const row = makeLiveRow();
    const { app } = createGuardedTestApp({
      invitationRow: row,
      callerHasInviteCapability: true,
    });

    const apiKeyRes = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "apikey",
      },
    });
    expect(apiKeyRes.status).toBe(403);
    expect(await apiKeyRes.text()).toContain("session_required");

    const mcpRes = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "mcp",
      },
    });
    expect(mcpRes.status).toBe(403);
    expect(await mcpRes.text()).toContain("session_required");

    const impersonatedRes = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "impersonated",
      },
    });
    expect(impersonatedRes.status).toBe(403);
    expect(await impersonatedRes.text()).toContain("session_required");

    const unauthRes = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-auth": "none",
      },
    });
    expect(unauthRes.status).toBe(401);

    const portalHostRes = await app.request(path, {
      method: "POST",
      headers: {
        host: "portal.example.test",
        "x-test-user": "user_inviter",
      },
    });
    expect(portalHostRes.status).toBe(403);

    const portalSessionRes = await app.request(path, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "portal-session",
      },
    });
    expect(portalSessionRes.status).toBe(403);
  });

  it("refuses expired, revoked and already-accepted invitations with 409", async () => {
    const expired = makeLiveRow({ expiresAt: new Date(Date.now() - 1_000) });
    const revoked = makeLiveRow({ status: "canceled", credentialHash: null });
    const accepted = makeLiveRow({ status: "accepted", credentialHash: null });

    for (const row of [expired, revoked, accepted]) {
      const { app, audits } = createGuardedTestApp({
        invitationRow: row,
        callerHasInviteCapability: true,
      });
      const res = await app.request(path, {
        method: "POST",
        headers: {
          host: "agent.example.test",
          "x-test-user": "user_inviter",
        },
      });
      expect(res.status).toBe(409);
      expect(audits).toHaveLength(0);
    }
  });

  it("rate limits copy requests per actor and sets Retry-After without blocking other actors", async () => {
    let clock = 1_700_000_000_000;
    const row = makeLiveRow({ expiresAt: new Date(clock + 3_600_000) });
    const { app } = createGuardedTestApp({
      now: () => clock,
      maxRequests: 3,
      invitationRow: row,
      callerHasInviteCapability: true,
    });

    for (let i = 0; i < 3; i += 1) {
      const ok = await app.request(path, {
        method: "POST",
        headers: { host: "agent.example.test", "x-test-user": "actor_1" },
      });
      expect(ok.status).toBe(200);
    }

    clock += 15_000;
    const limited = await app.request(path, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_1" },
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("45");

    // Another actor has their own independent bucket.
    const otherActor = await app.request(path, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_2" },
    });
    expect(otherActor.status).toBe(200);

    // Advancing past the 60s window resets actor_1's bucket.
    clock += 46_000;
    const recovered = await app.request(path, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_1" },
    });
    expect(recovered.status).toBe(200);
  });

  it("registers invitation.link_copied as an audit-only action and never records the secret or email address", async () => {
    expect(AUDIT_ONLY_ACTIONS).toContain("invitation.link_copied");
    const row = makeLiveRow();
    const { app, audits } = createGuardedTestApp({
      invitationRow: row,
      callerHasInviteCapability: true,
    });

    const res = await app.request(path, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "user_inviter" },
    });
    expect(res.status).toBe(200);
    expect(audits).toEqual([
      {
        actorId: "user_inviter",
        actorType: "user",
        apiKeyId: null,
        workspaceId: "ws_1",
        organisationId: "org_1",
        action: "invitation.link_copied",
        entityType: "invitation",
        entityId: "inv_live",
        before: null,
        after: { scope: "customer" },
      },
    ]);
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain(row.expectedCredential);
    expect(serialized).not.toContain(row.email);
  });
});
