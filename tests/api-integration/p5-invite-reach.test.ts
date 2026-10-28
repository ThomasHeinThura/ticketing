/**
 * Customer invitations, denial and separation (CP-20, CP-21, CP-23, CP-25): who may call each
 * route, that a customer-scope invitation can never be a staff invitation, that no staff path can
 * see or accept one, that a role other than `customer` is refused and stored nowhere, and that the
 * agent and portal surfaces stay apart.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createCustomerUser,
  type InviteWorld,
  insertOrganisation,
  inviteWorld,
  JSON_HEADERS,
} from "./helpers/p5-invite";

const auditText = (rows: unknown) =>
  JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));

let w: InviteWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await inviteWorld();
});

async function invitationCount() {
  return (await db.select().from(schema.invitationTable)).length;
}

describe("agent routes: capability, tenant isolation and sessions", () => {
  const routes = (w: InviteWorld) => [
    {
      method: "GET",
      path: `/api/workspace/${w.workspaceId}/customer-organisations`,
    },
    { method: "GET", path: w.base() },
    { method: "POST", path: w.base(), body: { email: "someone@example.test" } },
    {
      method: "POST",
      path: `${w.base()}/does-not-exist/resend`,
    },
  ];

  it("refuses a member without member:invite on every route and writes nothing", async () => {
    for (const route of routes(w)) {
      const response = await w.call(w.member.user, route.path, {
        method: route.method,
        ...(route.body ? { body: route.body } : {}),
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
    }
    expect(await invitationCount()).toBe(0);
  });

  it("refuses another tenant's owner on this workspace and writes nothing", async () => {
    for (const route of routes(w)) {
      const response = await w.call(w.foreign.user, route.path, {
        method: route.method,
        ...(route.body ? { body: route.body } : {}),
      });
      expect([403, 404], `${route.method} ${route.path}`).toContain(
        response.status,
      );
    }
    expect(await invitationCount()).toBe(0);
  });

  it("answers 401 without a session", async () => {
    mockAnonymousSession();
    for (const route of routes(w)) {
      const response = await w.app.request(route.path, {
        method: route.method,
        headers: JSON_HEADERS,
        ...(route.body ? { body: JSON.stringify(route.body) } : {}),
      });
      expect(response.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("does not serve a customer-portal session on any agent route", async () => {
    const customer = await createCustomerUser({
      organisationId: w.org.id,
      person: true,
    });
    await grantCustomerOrganisationMembership(
      w.org.id,
      customer.personId as string,
    );
    for (const route of routes(w)) {
      const response = await w.portal(customer.user, route.path, {
        method: route.method,
        ...(route.body ? { body: route.body } : {}),
      });
      expect(
        response.status,
        `${route.method} ${route.path}`,
      ).toBeGreaterThanOrEqual(400);
    }
    expect(await invitationCount()).toBe(0);
  });

  it("refuses another workspace's own path for an organisation it does not serve and writes nothing", async () => {
    const own = `/api/workspace/${w.foreign.workspace.id}`;
    const list = await w.call(w.foreign.user, `${own}/customer-organisations`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain(w.org.id);
    for (const [method, path, body] of [
      ["GET", w.base(w.org.id, w.foreign.workspace.id), undefined],
      [
        "POST",
        w.base(w.org.id, w.foreign.workspace.id),
        { email: "intruder@example.test" },
      ],
      [
        "POST",
        `${w.base(w.org.id, w.foreign.workspace.id)}/x/resend`,
        undefined,
      ],
    ] as const) {
      const response = await w.call(w.foreign.user, path, {
        method,
        ...(body ? { body } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    expect(await invitationCount()).toBe(0);
  });

  it("does not serve an organisation whose only project is archived or deleted", async () => {
    const unbound = await insertOrganisation("Unbound");
    const { createProjectFixture } = await import("./helpers/fixtures");
    const { project } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: unbound.id, archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect((await w.call(w.owner.user, w.base(unbound.id))).status).toBe(404);
    const created = await w.call(w.owner.user, w.base(unbound.id), {
      method: "POST",
      body: { email: "x@example.test" },
    });
    expect(created.status).toBe(404);
    expect(await invitationCount()).toBe(0);
  });

  it("answers 404 for an organisation that does not exist, is internal or is deleted", async () => {
    const [internal] = await db
      .select()
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true));
    if (!internal) throw new Error("internal organisation missing");
    const deleted = await insertOrganisation("Deleted");
    await db
      .update(schema.organisationTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.organisationTable.id, deleted.id));
    for (const id of ["no-such-org", internal.id, deleted.id]) {
      const create = await w.call(w.owner.user, w.base(id), {
        method: "POST",
        body: { email: "x@example.test" },
      });
      expect(create.status, id).toBe(404);
      expect((await w.call(w.owner.user, w.base(id))).status, id).toBe(404);
    }
    expect(await invitationCount()).toBe(0);
  });

  it("lists only live customer organisations", async () => {
    const response = await w.call(
      w.owner.user,
      `/api/workspace/${w.workspaceId}/customer-organisations`,
    );
    const body = (await response.json()) as {
      organisations: { id: string }[];
    };
    const ids = body.organisations.map((organisation) => organisation.id);
    expect(ids).toEqual(expect.arrayContaining([w.org.id, w.otherOrg.id]));
  });
});

describe("a customer invitation can never grant a staff role (CP-13, CP-21)", () => {
  it.each([
    ["admin", { role: "admin" }],
    ["owner", { role: "owner" }],
    ["instance:admin", { role: "instance:admin" }],
    ["a custom role", { role: "my-custom-role" }],
    ["a team", { teamId: "team-1" }],
    ["a staff scope", { scope: "staff" }],
    ["a workspace grant", { workspaceRole: "admin" }],
  ])(
    "refuses a body naming %s with 422, stores nothing and audits the refusal",
    async (_name, extra) => {
      const response = await w.call(w.owner.user, w.base(), {
        method: "POST",
        body: { email: "invitee@example.test", ...extra },
      });
      expect(response.status).toBe(422);
      expect(await invitationCount()).toBe(0);
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "permission.denied"));
      expect(audit.length).toBeGreaterThan(0);
      expect(auditText(audit)).toContain("role_refused_at_write");
      expect(auditText(audit)).not.toContain("invitee@example.test");
    },
  );

  it("accepts the literal customer role", async () => {
    const response = await w.call(w.owner.user, w.base(), {
      method: "POST",
      body: { email: "ok@example.test", role: "customer" },
    });
    expect(response.status).toBe(201);
    const [row] = await db.select().from(schema.invitationTable);
    expect(row).toMatchObject({ scope: "customer", role: "customer" });
  });

  it("is enforced by the database too: no row can pair a customer scope with a staff role", async () => {
    const base = {
      workspaceId: w.workspaceId,
      email: "db@example.test",
      expiresAt: new Date(Date.now() + 1000),
      inviterId: w.owner.user.id,
    };
    await expect(
      db.insert(schema.invitationTable).values({
        ...base,
        scope: "customer",
        organisationId: w.org.id,
        role: "admin",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.invitationTable).values({
        ...base,
        scope: "customer",
        organisationId: null,
        role: "customer",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.invitationTable).values({
        ...base,
        scope: "staff",
        organisationId: w.org.id,
        role: "member",
      }),
    ).rejects.toThrow();
    expect(await invitationCount()).toBe(0);
  });

  it("refuses at accept a row that was edited into a staff role after it was written", async () => {
    const sent = await w.invite("edited@example.test");
    const customer = await createCustomerUser({
      organisationId: w.org.id,
      email: "edited@example.test",
      person: true,
    });
    await grantCustomerOrganisationMembership(
      w.org.id,
      customer.personId as string,
    );
    // The constraint blocks the edit, so drop it for this test to model a row that was
    // imported or migrated past the write-time check.
    await db.execute(
      (await import("drizzle-orm"))
        .sql`ALTER TABLE invitation DROP CONSTRAINT invitation_scope_shape`,
    );
    try {
      await db
        .update(schema.invitationTable)
        .set({ role: "admin" })
        .where(eq(schema.invitationTable.id, sent.id));
      const response = await w.portal(
        customer.user,
        `/api/portal/invitations/${sent.id}/accept`,
        { method: "POST", body: { credential: sent.credential } },
      );
      expect(response.status).toBe(404);
      expect((await w.rowOf(sent.id))?.status).toBe("pending");
      expect((await w.rowOf(sent.id))?.acceptedPersonId).toBeNull();
      expect(auditText(await db.select().from(schema.auditLogTable))).toContain(
        "role_refused",
      );
    } finally {
      await db
        .update(schema.invitationTable)
        .set({ role: "customer" })
        .where(eq(schema.invitationTable.id, sent.id));
      await db.execute(
        (await import("drizzle-orm"))
          .sql`ALTER TABLE invitation ADD CONSTRAINT invitation_scope_shape CHECK ((scope = 'staff' AND organisation_id IS NULL AND credential_hash IS NULL) OR (scope = 'customer' AND organisation_id IS NOT NULL AND role = 'customer' AND team_id IS NULL))`,
      );
    }
  });
});

describe("no staff path can see or accept a customer invitation (CP-21)", () => {
  async function staffUserWithEmail(email: string) {
    const { createWorkspaceMember } = await import("./helpers/fixtures");
    const staff = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ email })
      .where(eq(schema.userTable.id, staff.user.id));
    return staff;
  }

  it("the staff accept route answers the generic not-found and changes nothing", async () => {
    const sent = await w.invite("staffmatch@example.test");
    const staff = await staffUserWithEmail("staffmatch@example.test");
    const response = await w.call(
      staff.user,
      `/api/invitation/${sent.id}/accept`,
      { method: "POST" },
    );
    expect(response.status).toBe(404);
    const row = await w.rowOf(sent.id);
    expect(row?.status).toBe("pending");
    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, staff.user.id));
    expect(members.every((m) => m.workspaceId !== w.workspaceId)).toBe(true);
  });

  it("audits the staff accept attempt as a wrong-portal refusal", async () => {
    const sent = await w.invite("wrongportal@example.test");
    const staff = await staffUserWithEmail("wrongportal@example.test");
    await w.call(staff.user, `/api/invitation/${sent.id}/accept`, {
      method: "POST",
    });
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "permission.denied"));
    expect(auditText(audit)).toContain("wrong_portal");
    expect(auditText(audit)).not.toContain(sent.credential);
  });

  it("the staff reject route cannot cancel it", async () => {
    const sent = await w.invite("staffreject@example.test");
    const staff = await staffUserWithEmail("staffreject@example.test");
    const response = await w.call(
      staff.user,
      `/api/invitation/${sent.id}/reject`,
      { method: "POST" },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });

  it("the recipient's pending list, the public lookup and the workspace list leave it out", async () => {
    const sent = await w.invite("listed@example.test");
    const staff = await staffUserWithEmail("listed@example.test");
    const pending = await w.call(staff.user, "/api/invitation/pending");
    expect(JSON.stringify(await pending.json())).not.toContain(sent.id);
    mockAnonymousSession();
    const publicLookup = await w.app.request(
      `/api/invitation/public/${sent.id}`,
      { headers: JSON_HEADERS },
    );
    const lookupBody = JSON.stringify(await publicLookup.json());
    expect(lookupBody).not.toContain("listed@example.test");
    expect(lookupBody).toContain('"valid":false');
    const list = await w.call(
      w.owner.user,
      `/api/workspace/${w.workspaceId}/invitations`,
    );
    if (list.status === 200)
      expect(JSON.stringify(await list.json())).not.toContain(sent.id);
  });

  it("keeps public invitation preview public and applies the configured anonymous ceiling", async () => {
    await db
      .update(schema.instanceSettingTable)
      .set({ anonymousRateLimitWindowMs: 60_000, anonymousRateLimitMax: 1 })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const created = await w.call(
      w.owner.user,
      `/api/workspace/${w.workspaceId}/invitations`,
      {
        method: "POST",
        body: {
          email: "rate-limited-preview@example.test",
          role: "member",
        },
      },
    );
    expect(created.status).toBe(200);
    const sent = (await created.json()) as { id: string };
    mockAnonymousSession();
    const path = `/api/invitation/public/${sent.id}`;
    const first = await w.app.request(path, { headers: JSON_HEADERS });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ valid: true });

    const limited = await w.app.request(path, { headers: JSON_HEADERS });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^[1-9][0-9]*$/u);
  });

  it("does not open agent-side registration for the invited address", async () => {
    await w.invite("register@example.test");
    const { findPendingInvitation } = await import(
      "../../apps/api/src/utils/registration.repository"
    );
    expect(
      await findPendingInvitation({
        email: "register@example.test",
        now: new Date(),
      }),
    ).toBeUndefined();
  });

  it("a customer invitation does not count as a pending staff invitation for the address", async () => {
    await w.invite("both@example.test");
    const response = await w.call(
      w.owner.user,
      `/api/workspace/${w.workspaceId}/invitations`,
      { method: "POST", body: { email: "both@example.test", role: "member" } },
    );
    expect(response.status).toBe(200);
  });
});

describe("portal accept route: portal host, customer session only", () => {
  it("is not served to a staff session or an anonymous caller", async () => {
    const sent = await w.invite("who@example.test");
    const path = `/api/portal/invitations/${sent.id}/accept`;
    const body = { credential: sent.credential };
    expect(
      (await w.call(w.owner.user, path, { method: "POST", body })).status,
    ).toBeGreaterThanOrEqual(400);
    mockAnonymousSession();
    expect(
      (
        await w.app.request(path, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });

  it("is not reachable on the agent host by a portal session", async () => {
    const sent = await w.invite("agenthost@example.test");
    const customer = await createCustomerUser({
      organisationId: w.org.id,
      email: "agenthost@example.test",
      person: true,
    });
    await grantCustomerOrganisationMembership(
      w.org.id,
      customer.personId as string,
    );
    mockAuthenticatedSession(customer.user, { portal: "customer" });
    const response = await w.app.request(
      `/api/portal/invitations/${sent.id}/accept`,
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ credential: sent.credential }),
      },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await w.rowOf(sent.id))?.status).toBe("pending");
  });
});

describe("a caller reaches only the organisations it reaches (CP-20)", () => {
  async function rosteredOn(organisationId: string, role: "lead" | "owner") {
    const { addMember } = await import("./helpers/reach-world");
    const { grantProjectRole } = await import("./helpers/fixtures");
    const { ensureAgentSession } = await import("./helpers/pending-deletion");
    const [project] = await db
      .select({ id: schema.projectTable.id })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.organisationId, organisationId));
    if (!project) throw new Error("no project for organisation");
    const caller = await addMember(w.workspaceId, role);
    await grantProjectRole(caller.user.id, project.id, ["project:read"]);
    await ensureAgentSession(caller.user.id);
    return caller;
  }

  const missing = async (response: Response) => ({
    status: response.status,
    body: await response.text(),
  });

  it("lists only the organisations of the projects the caller is rostered on", async () => {
    const lead = await rosteredOn(w.org.id, "lead");
    const body = await w.json<{ organisations: { id: string }[] }>(
      await w.call(
        lead.user,
        `/api/workspace/${w.workspaceId}/customer-organisations`,
      ),
    );
    expect(body.organisations.map((o) => o.id)).toEqual([w.org.id]);
  });

  it("serves its own organisation: list, create and resend", async () => {
    const lead = await rosteredOn(w.org.id, "lead");
    const created = await w.json<{ id: string }>(
      await w.call(lead.user, w.base(w.org.id), {
        method: "POST",
        body: { email: "ownorg@example.test" },
      }),
      201,
    );
    const list = await w.json<{ invitations: { id: string }[] }>(
      await w.call(lead.user, w.base(w.org.id)),
    );
    expect(list.invitations.map((i) => i.id)).toEqual([created.id]);
    await db
      .update(schema.invitationTable)
      .set({ lastSentAt: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.invitationTable.id, created.id));
    expect(
      (
        await w.call(lead.user, `${w.base(w.org.id)}/${created.id}/resend`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
  });

  it("answers 404, byte-identical to a missing organisation, for another organisation on list, create and resend, and stores nothing", async () => {
    const sentToOther = await w.invite("secret@example.test", w.otherOrg.id);
    const lead = await rosteredOn(w.org.id, "lead");
    const before = (await db.select().from(schema.invitationTable)).length;

    const list = await missing(await w.call(lead.user, w.base(w.otherOrg.id)));
    const listGhost = await missing(await w.call(lead.user, w.base("ghost")));
    expect(list).toEqual(listGhost);
    expect(list.status).toBe(404);
    expect(list.body).not.toContain("secret@example.test");

    const create = await missing(
      await w.call(lead.user, w.base(w.otherOrg.id), {
        method: "POST",
        body: { email: "intruder@example.test" },
      }),
    );
    const createGhost = await missing(
      await w.call(lead.user, w.base("ghost"), {
        method: "POST",
        body: { email: "intruder@example.test" },
      }),
    );
    expect(create).toEqual(createGhost);
    expect(create.status).toBe(404);

    const resend = await missing(
      await w.call(
        lead.user,
        `${w.base(w.otherOrg.id)}/${sentToOther.id}/resend`,
        { method: "POST" },
      ),
    );
    const resendGhost = await missing(
      await w.call(lead.user, `${w.base(w.org.id)}/ghost/resend`, {
        method: "POST",
      }),
    );
    expect(resend).toEqual(resendGhost);
    expect(resend.status).toBe(404);

    expect((await db.select().from(schema.invitationTable)).length).toBe(
      before,
    );
  });

  it("answers 404 on revoke for another organisation's invitation and accepts it for its own", async () => {
    const { approvePendingDeletion } = await import(
      "./helpers/pending-deletion"
    );
    const other = await w.invite("revoke-other@example.test", w.otherOrg.id);
    const own = await w.invite("revoke-own@example.test", w.org.id);
    // Only an owner passes the legacy invitation:cancel check, so the revoker is an owner with no
    // workspace-wide reach, rostered on organisation A's project only.
    const admin = await rosteredOn(w.org.id, "owner");
    const refused = await w.call(admin.user, `/api/invitation/${other.id}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(404);
    expect((await w.rowOf(other.id))?.status).toBe("pending");
    const request = await w.call(admin.user, `/api/invitation/${own.id}`, {
      method: "DELETE",
    });
    expect(request.status).toBe(202);
    const approved = await approvePendingDeletion(
      w.app,
      admin.user.id,
      (await request.json()) as never,
    );
    expect(approved.status).toBe(200);
    expect((await w.rowOf(own.id))?.status).toBe("canceled");
    expect((await w.rowOf(other.id))?.status).toBe("pending");
  });

  it("reaches an organisation served only by a request type through that type's default project", async () => {
    const { addMember } = await import("./helpers/reach-world");
    const { grantProjectRole, createProjectFixture } = await import(
      "./helpers/fixtures"
    );
    const now = new Date();
    const [witype] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: w.workspaceId,
        key: `type-${now.getTime()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const rtOrg = await insertOrganisation("Request-type org");
    const { project } = await createProjectFixture({
      workspaceId: w.workspaceId,
    });
    const [type] = await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: w.workspaceId,
        key: `rt-${rtOrg.id}`,
        name: "Request",
        group: "General",
        workItemTypeId: witype?.id as string,
        defaultProjectId: project.id,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning();
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: rtOrg.id,
      requestTypeId: type?.id as string,
    });
    const inside = await addMember(w.workspaceId, "lead");
    await grantProjectRole(inside.user.id, project.id, ["project:read"]);
    const outside = await rosteredOn(w.org.id, "lead");
    expect((await w.call(inside.user, w.base(rtOrg.id))).status).toBe(200);
    expect((await w.call(outside.user, w.base(rtOrg.id))).status).toBe(404);
    expect((await w.call(inside.user, w.base(w.org.id))).status).toBe(404);
  });

  it("serves every organisation to the owner, who holds workspace-wide reach", async () => {
    for (const id of [w.org.id, w.otherOrg.id])
      expect((await w.call(w.owner.user, w.base(id))).status).toBe(200);
    const body = await w.json<{ organisations: { id: string }[] }>(
      await w.call(
        w.owner.user,
        `/api/workspace/${w.workspaceId}/customer-organisations`,
      ),
    );
    expect(body.organisations.map((o) => o.id).sort()).toEqual(
      [w.org.id, w.otherOrg.id].sort(),
    );
  });

  it("serves every organisation to a workspace sees-all member", async () => {
    const { addMember } = await import("./helpers/reach-world");
    const lead = await addMember(w.workspaceId, "lead");
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, lead.user.id));
    const { grantSeesAll } = await import("./helpers/project-reach-world");
    await grantSeesAll(w.workspaceId, person?.id as string);
    for (const id of [w.org.id, w.otherOrg.id])
      expect((await w.call(lead.user, w.base(id))).status).toBe(200);
  });
});
