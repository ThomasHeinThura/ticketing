import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roleStore = vi.hoisted(() => ({
  rolesByUserAndWorkspace: new Map<string, string[]>(),
}));

vi.mock("../../../apps/api/src/utils/access-lookups.repository", () => ({
  listMemberRoleRows: vi.fn(
    async (
      _executor: unknown,
      workspaceId: string,
      userId: string,
    ): Promise<Array<{ role: string }>> =>
      (
        roleStore.rolesByUserAndWorkspace.get(`${workspaceId}:${userId}`) ?? []
      ).map((role) => ({ role })),
  ),
  findRoleIsSystem: vi.fn(async () => ({ isSystem: true })),
}));

vi.mock(
  "../../../apps/api/src/permissions/workspace-role-authority.repository",
  () => ({
    findWorkspaceRoleByKey: vi.fn(async () => null),
    expandedRoleCapabilities: vi.fn(() => new Set<string>()),
  }),
);

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
  copyInvitationLinkTrackedActorCount,
  requireCopyInvitationLinkRateLimit,
  resetCopyInvitationLinkRateLimitBuckets,
} from "../../../apps/api/src/utils/require-copy-link-rate-limit";
import { requireInvitationCopyAccess } from "../../../apps/api/src/utils/require-invitation-copy-access";

const KEY_A = "11".repeat(32);
const KEY_B = "22".repeat(32);
const PORTAL_ORIGIN = "https://portal.example.test";
const AGENT_ORIGIN = "https://agent.example.test";

const originalKey = process.env.TASKDESK_ENCRYPTION_KEY;
const originalPrevKey = process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;

function grantRole(workspaceId: string, userId: string, role: string | null) {
  const key = `${workspaceId}:${userId}`;
  if (role === null) roleStore.rolesByUserAndWorkspace.delete(key);
  else roleStore.rolesByUserAndWorkspace.set(key, [role]);
}

beforeEach(() => {
  process.env.TASKDESK_ENCRYPTION_KEY = KEY_A;
  delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  roleStore.rolesByUserAndWorkspace.clear();
  resetCopyInvitationLinkRateLimitBuckets();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalKey;

  if (originalPrevKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS;
  else process.env.TASKDESK_ENCRYPTION_KEY_PREVIOUS = originalPrevKey;

  roleStore.rolesByUserAndWorkspace.clear();
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

describe("copy-link endpoint guards, member:invite capability, hard-bounded rate limit and audit contract", () => {
  type TestVars = {
    workspaceId: string;
    userId: string | undefined;
    session: { impersonatedBy?: string | null; portal?: string | null } | null;
    apiKey: { id: string; isMcp?: boolean } | null;
  };

  function createGuardedTestApp(options: {
    now?: () => number;
    maxRequests?: number;
    windowMs?: number;
    maxTrackedActors?: number;
    invitationRow?: {
      id: string;
      inviterId: string;
      email: string;
      status: "pending" | "accepted" | "canceled";
      expiresAt: Date;
      generation: number;
      credentialHash: string | null;
    } | null;
    staffRow?: {
      id: string;
      inviterId: string;
      email: string;
      status: "pending" | "accepted" | "canceled";
      expiresAt: Date;
    } | null;
    auditSink?: Array<Record<string, unknown>>;
  }) {
    const app = new Hono<{ Variables: TestVars }>();
    const row = options.invitationRow ?? null;
    const staffRow = options.staffRow ?? null;
    const audits = options.auditSink ?? [];

    app.use("/workspace/:workspaceId/*", async (c, next) => {
      c.set("workspaceId", c.req.param("workspaceId"));
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

    const sessionGuard = requireAgentBrowserSession({
      resolvePortal: (host) =>
        host === "portal.example.test" ? "customer" : "agent",
    });
    const rateLimiter = requireCopyInvitationLinkRateLimit({
      now: options.now,
      maxRequests: options.maxRequests ?? 30,
      windowMs: options.windowMs ?? 60_000,
      maxTrackedActors: options.maxTrackedActors,
    });

    app.post(
      "/workspace/:workspaceId/organisations/:organisationId/invitations/:id/copy-link",
      sessionGuard,
      rateLimiter,
      requireInvitationCopyAccess({
        scope: "customer",
        idParam: "id",
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

    app.post(
      "/workspace/:workspaceId/invitations/:invitationId/copy-link",
      sessionGuard,
      rateLimiter,
      requireInvitationCopyAccess({
        scope: "staff",
        idParam: "invitationId",
      }),
      async (c) => {
        if (!staffRow || staffRow.id !== c.req.param("invitationId")) {
          throw new HTTPException(404, { message: "Invitation not found" });
        }
        const currentMs = options.now ? options.now() : Date.now();
        if (
          staffRow.status !== "pending" ||
          staffRow.expiresAt.getTime() <= currentMs
        ) {
          throw new HTTPException(409, {
            message: "Only a pending, unexpired invitation link can be copied",
          });
        }
        audits.push({
          actorId: c.get("userId"),
          actorType: "person",
          apiKeyId: null,
          workspaceId: c.req.param("workspaceId"),
          organisationId: null,
          action: "invitation.link_copied",
          entityType: "invitation",
          entityId: staffRow.id,
          before: null,
          after: { scope: "staff" },
        });
        c.header("Cache-Control", "no-store");
        return c.json(
          {
            link: `${AGENT_ORIGIN}/invitation/accept/${staffRow.id}`,
            expiresAt: staffRow.expiresAt.toISOString(),
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

  const customerPath =
    "/workspace/ws_1/organisations/org_1/invitations/inv_live/copy-link";
  const staffPath = "/workspace/ws_1/invitations/inv_staff_1/copy-link";

  it("allows a member:invite holder (owner/admin/manager/lead) and sets Cache-Control: no-store without extending expiry", async () => {
    const row = makeLiveRow();
    const originalExpiryIso = row.expiresAt.toISOString();
    const { app, audits } = createGuardedTestApp({ invitationRow: row });

    for (const [actor, role] of [
      ["user_owner", "owner"],
      ["user_admin", "admin"],
      ["user_manager", "manager"],
      ["user_lead", "lead"],
    ] as const) {
      grantRole("ws_1", actor, role);
      const res = await app.request(customerPath, {
        method: "POST",
        headers: {
          host: "agent.example.test",
          "x-test-user": actor,
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = (await res.json()) as { link: string; expiresAt: string };
      expect(body).toEqual({
        link: `https://portal.example.test/invite/inv_live#t=${row.expectedCredential}`,
        expiresAt: originalExpiryIso,
      });
    }
    expect(audits).toHaveLength(4);
  });

  it("refuses the original inviter when they no longer hold member:invite (demoted to member, viewer, custom role without invite, or removed) on both customer and staff endpoints", async () => {
    const row = makeLiveRow();
    const staffRow = {
      id: "inv_staff_1",
      inviterId: "user_inviter",
      email: "staff.invitee@example.test",
      status: "pending" as const,
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    const { app, audits } = createGuardedTestApp({
      invitationRow: row,
      staffRow,
    });

    for (const role of [
      "member",
      "viewer",
      "custom-no-invite",
      null,
    ] as const) {
      grantRole("ws_1", "user_inviter", role);

      const custRes = await app.request(customerPath, {
        method: "POST",
        headers: {
          host: "agent.example.test",
          "x-test-user": "user_inviter",
        },
      });
      expect(custRes.status).toBe(403);

      const staffRes = await app.request(staffPath, {
        method: "POST",
        headers: {
          host: "agent.example.test",
          "x-test-user": "user_inviter",
        },
      });
      expect(staffRes.status).toBe(403);
    }
    expect(audits).toHaveLength(0);
  });

  it("refuses API keys, MCP keys, impersonation sessions, unauthenticated callers and portal hosts", async () => {
    const row = makeLiveRow();
    grantRole("ws_1", "user_inviter", "admin");
    const { app } = createGuardedTestApp({ invitationRow: row });

    const apiKeyRes = await app.request(customerPath, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "apikey",
      },
    });
    expect(apiKeyRes.status).toBe(403);
    expect(await apiKeyRes.text()).toContain("session_required");

    const mcpRes = await app.request(customerPath, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "mcp",
      },
    });
    expect(mcpRes.status).toBe(403);
    expect(await mcpRes.text()).toContain("session_required");

    const impersonatedRes = await app.request(customerPath, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-user": "user_inviter",
        "x-test-auth": "impersonated",
      },
    });
    expect(impersonatedRes.status).toBe(403);
    expect(await impersonatedRes.text()).toContain("session_required");

    const unauthRes = await app.request(customerPath, {
      method: "POST",
      headers: {
        host: "agent.example.test",
        "x-test-auth": "none",
      },
    });
    expect(unauthRes.status).toBe(401);

    const portalHostRes = await app.request(customerPath, {
      method: "POST",
      headers: {
        host: "portal.example.test",
        "x-test-user": "user_inviter",
      },
    });
    expect(portalHostRes.status).toBe(403);

    const portalSessionRes = await app.request(customerPath, {
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
    grantRole("ws_1", "user_inviter", "admin");
    const expired = makeLiveRow({ expiresAt: new Date(Date.now() - 1_000) });
    const revoked = makeLiveRow({ status: "canceled", credentialHash: null });
    const accepted = makeLiveRow({ status: "accepted", credentialHash: null });

    for (const row of [expired, revoked, accepted]) {
      const { app, audits } = createGuardedTestApp({ invitationRow: row });
      const res = await app.request(customerPath, {
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

  it("shares one per-actor rate-limit bucket across customer and staff copy endpoints and across workspaces", async () => {
    let clock = 1_700_000_000_000;
    const row = makeLiveRow({ expiresAt: new Date(clock + 3_600_000) });
    const staffRow = {
      id: "inv_staff_1",
      inviterId: "actor_shared",
      email: "staff.invitee@example.test",
      status: "pending" as const,
      expiresAt: new Date(clock + 3_600_000),
    };
    grantRole("ws_1", "actor_shared", "admin");
    grantRole("ws_2", "actor_shared", "admin");
    grantRole("ws_1", "actor_other", "admin");

    const { app } = createGuardedTestApp({
      now: () => clock,
      maxRequests: 3,
      windowMs: 60_000,
      invitationRow: row,
      staffRow,
    });

    // 1) Customer copy in ws_1
    const r1 = await app.request(customerPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_shared" },
    });
    expect(r1.status).toBe(200);

    // 2) Staff copy in ws_1
    const r2 = await app.request(staffPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_shared" },
    });
    expect(r2.status).toBe(200);

    // 3) Customer copy in ws_2
    const r3 = await app.request(
      "/workspace/ws_2/organisations/org_1/invitations/inv_live/copy-link",
      {
        method: "POST",
        headers: { host: "agent.example.test", "x-test-user": "actor_shared" },
      },
    );
    expect(r3.status).toBe(200);

    // 4) Staff copy in ws_2 hits the shared 3/window actor ceiling -> 429
    clock += 15_000;
    const limited = await app.request(
      "/workspace/ws_2/invitations/inv_staff_1/copy-link",
      {
        method: "POST",
        headers: { host: "agent.example.test", "x-test-user": "actor_shared" },
      },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("45");

    // Independent actor still succeeds.
    const other = await app.request(customerPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_other" },
    });
    expect(other.status).toBe(200);
  });

  it("enforces a hard admission bound on tracked actors without evicting or resetting live buckets, and recovers once windows expire", async () => {
    let clock = 1_700_000_000_000;
    const row = makeLiveRow({ expiresAt: new Date(clock + 3_600_000) });
    for (const actor of [
      "actor_1",
      "actor_2",
      "actor_3",
      "actor_4",
      "actor_5",
    ]) {
      grantRole("ws_1", actor, "admin");
    }

    const { app } = createGuardedTestApp({
      now: () => clock,
      maxRequests: 2,
      windowMs: 60_000,
      maxTrackedActors: 3,
      invitationRow: row,
    });

    // actor_1 uses both of its allowed requests at t=0 -> saturated at count=2.
    for (let i = 0; i < 2; i += 1) {
      const res = await app.request(customerPath, {
        method: "POST",
        headers: { host: "agent.example.test", "x-test-user": "actor_1" },
      });
      expect(res.status).toBe(200);
    }

    // actor_2 uses 1 request at t=10s; actor_3 uses 1 request at t=20s -> map is at capacity (3).
    clock += 10_000;
    expect(
      (
        await app.request(customerPath, {
          method: "POST",
          headers: { host: "agent.example.test", "x-test-user": "actor_2" },
        })
      ).status,
    ).toBe(200);

    clock += 10_000;
    expect(
      (
        await app.request(customerPath, {
          method: "POST",
          headers: { host: "agent.example.test", "x-test-user": "actor_3" },
        })
      ).status,
    ).toBe(200);
    expect(copyInvitationLinkTrackedActorCount()).toBe(3);

    // New actors (actor_4, actor_5) arrive at t=25s while all 3 buckets are live -> refused 429,
    // map size never exceeds 3, and existing actors' counters are NOT evicted or reset.
    clock += 5_000;
    for (const newcomer of ["actor_4", "actor_5"]) {
      const overflow = await app.request(customerPath, {
        method: "POST",
        headers: { host: "agent.example.test", "x-test-user": newcomer },
      });
      expect(overflow.status).toBe(429);
      expect(overflow.headers.get("Retry-After")).toBe("35");
    }
    expect(copyInvitationLinkTrackedActorCount()).toBe(3);

    // actor_1's live bucket was NOT evicted -> still rate-limited at count=2!
    const actor1StillLimited = await app.request(customerPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_1" },
    });
    expect(actor1StillLimited.status).toBe(429);

    // actor_2's live bucket was NOT evicted -> gets its 2nd allowed request, then hits 429 on 3rd!
    const actor2Second = await app.request(customerPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_2" },
    });
    expect(actor2Second.status).toBe(200);
    const actor2Third = await app.request(customerPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_2" },
    });
    expect(actor2Third.status).toBe(429);

    // Advance past actor_1's 60s window (t=61s, while actor_2 at t=10s and actor_3 at t=20s remain live):
    // pruning frees actor_1's expired slot so actor_4 is now admitted cleanly!
    clock = 1_700_000_061_000;
    const actor4Recovered = await app.request(customerPath, {
      method: "POST",
      headers: { host: "agent.example.test", "x-test-user": "actor_4" },
    });
    expect(actor4Recovered.status).toBe(200);
    expect(copyInvitationLinkTrackedActorCount()).toBe(3);
  });

  it("registers invitation.link_copied as an audit-only action and never records the secret or email address", async () => {
    expect(AUDIT_ONLY_ACTIONS).toContain("invitation.link_copied");
    grantRole("ws_1", "user_inviter", "admin");
    const row = makeLiveRow();
    const { app, audits } = createGuardedTestApp({ invitationRow: row });

    const res = await app.request(customerPath, {
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
