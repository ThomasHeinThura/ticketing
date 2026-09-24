/**
 * Integration tests for the LOADER half of `resolveIdentity` — issue #8, Slice 1. The pure
 * mapper's exhaustive case coverage lives in `tests/api/permissions/resolve-identity.test.ts`;
 * this file only proves the loader reads the real schema correctly and stays within a
 * bounded, fixed query count regardless of how many rows a person has.
 *
 * Includes the loader-level cases from the Opus 5.5 security review of PR #315
 * (`docs/07-planning/security-reviews/315-resolve-identity.md`): S1 (a workspace role row
 * literally named `instance_admin`/`customer`, created over the real schema, not just a
 * fixture), S4 (a key credential missing its `apiKey` fact, or one whose `ownerUserId`
 * mismatches), S5 (a team row surviving `leave-workspace`'s `workspace_member` delete), S6
 * (a banned user, a suspended customer organisation).
 */
import { randomUUID } from "node:crypto";
import { defaultRolePayloads } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { seedInternalOrganisationAndStaffPersons } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

/** Backfills a `person` row (side: staff) for every `user` row that doesn't have one yet —
 * the same boot-time seed the real application runs. */
async function backfillStaffPersons() {
  await seedInternalOrganisationAndStaffPersons();
}

async function insertCustomerPerson(userId: string) {
  const organisation = await db
    .insert(schema.organisationTable)
    .values({
      key: `customer-org-${randomUUID()}`,
      name: "Customer Org",
      isInternal: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  const org = organisation[0];
  if (!org) throw new Error("failed to insert customer organisation");

  await db.insert(schema.personTable).values({
    userId,
    organisationId: org.id,
    side: "customer",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return org.id;
}

describe("resolveIdentity (loader) — a real member", () => {
  it("resolves a staff member's workspace role", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "admin" });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity).not.toBeNull();
    expect(identity?.side).toBe("staff");
    expect(identity?.memberships).toEqual([
      { scope: "workspace", scopeId: workspace.id, seesAll: false },
    ]);
    expect(identity?.authority[0]?.roleKey).toBe("admin");
  });
});

describe("resolveIdentity (loader) — a non-member", () => {
  it("resolves an identity with no memberships when the person has none", async () => {
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: `user-${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        emailVerified: true,
        name: "No Memberships",
      })
      .returning();
    if (!user) throw new Error("insert failed");
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity).not.toBeNull();
    expect(identity?.memberships).toEqual([]);
    expect(identity?.authority).toEqual([]);
  });
});

describe("resolveIdentity (loader) — a multi-workspace user, and bounded query count", () => {
  it("resolves every workspace's role in a fixed number of queries, not one per membership", async () => {
    const { user, workspace: firstWorkspace } = await createWorkspaceMember({
      role: "viewer",
    });
    const organisation = await db.query.organisationTable.findFirst({
      where: (organisationRow, { eq: eqOp }) =>
        eqOp(organisationRow.isInternal, true),
    });
    if (!organisation) throw new Error("no internal organisation seeded");

    // Add the same user to four more workspaces directly (cheaper than five full
    // createWorkspaceMember calls, and the point of this test is the query count, not
    // fixture variety).
    const extraWorkspaceIds: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const workspaceId = `workspace-${randomUUID()}`;
      await db.insert(schema.workspaceTable).values({
        id: workspaceId,
        createdAt: new Date(),
        name: `Extra Workspace ${i}`,
        slug: `extra-workspace-${randomUUID()}`,
        organisationId: organisation.id,
      });
      await db.insert(schema.workspaceUserTable).values({
        workspaceId,
        userId: user.id,
        role: "member",
        joinedAt: new Date(),
      });
      // Issue #318 (security): a genuine seeded row, mirroring what
      // `seed-default-workspace-roles.ts`/`create-workspace.ts` guarantee for real
      // workspaces -- without it this membership would no longer resolve to authority
      // (it would read as a custom row that merely shares the `member` name).
      await db.insert(schema.workspaceRoleTable).values({
        workspaceId,
        role: "member",
        permission: JSON.stringify(defaultRolePayloads.member),
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      extraWorkspaceIds.push(workspaceId);
    }
    await backfillStaffPersons();

    let selectCalls = 0;
    type SelectFn = typeof db.select;
    const realSelect: (...args: Parameters<SelectFn>) => ReturnType<SelectFn> =
      db.select.bind(db);
    const countingExecutor: Pick<typeof db, "select"> = {
      select: ((...args: Parameters<SelectFn>) => {
        selectCalls += 1;
        return realSelect(...args);
      }) as SelectFn,
    };

    const identity = await resolveIdentity(
      { userId: user.id, credential: "session" },
      countingExecutor,
    );

    expect(identity?.memberships).toHaveLength(5);
    expect(
      identity?.memberships.map((membership) => membership.scopeId).sort(),
    ).toEqual([firstWorkspace.id, ...extraWorkspaceIds].sort());

    // Exactly 4 queries: person+role, workspace_member (all rows), the issue #318
    // genuine-built-in-row check (`workspace_role` where `is_system` for every workspace
    // query 2 found, one `IN (...)`), and team_member (all rows) -- fixed regardless of
    // the 5 memberships above. Re-run with only 1 membership below and assert the SAME
    // count, which is what actually proves "no N+1" rather than merely "a small number
    // this time."
    const fiveMembershipQueryCount = selectCalls;

    const { user: soloUser } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();
    selectCalls = 0;
    await resolveIdentity(
      { userId: soloUser.id, credential: "session" },
      countingExecutor,
    );
    expect(selectCalls).toBe(fiveMembershipQueryCount);
    expect(selectCalls).toBe(4);
  });
});

describe("resolveIdentity (loader) — sees_all", () => {
  it("today always resolves seesAll: false (no populated source yet -- see KNOWN GAP 3)", async () => {
    const { user } = await createWorkspaceMember({ role: "manager" });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity?.memberships.every((m) => m.seesAll === false)).toBe(true);
    expect(identity?.reach).toEqual({ kind: "membership" });
  });
});

describe("resolveIdentity (loader) — API-key clamping", () => {
  it("clamps to an empty subset -- no persisted capability column exists yet", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "api_key",
      apiKey: { enabled: true, ownerUserId: user.id },
    });

    expect(identity?.keyCapabilities).toEqual([]);
  });

  it("refuses when the key's owner is deactivated", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, user.id));

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "api_key",
      apiKey: { enabled: true, ownerUserId: user.id },
    });

    expect(identity).toBeNull();
  });

  it("refuses when the key itself is disabled", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "api_key",
      apiKey: { enabled: false, ownerUserId: user.id },
    });

    expect(identity).toBeNull();
  });
});

describe("resolveIdentity (loader) — S4 (PR #315 review): the key fact is required and must be the caller's own", () => {
  it("refuses a key credential with no apiKey fact supplied", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "api_key",
    });

    expect(identity).toBeNull();
  });

  it("refuses when the apiKey fact's ownerUserId names a different real user", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    const { user: otherUser } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "api_key",
      apiKey: { enabled: true, ownerUserId: otherUser.id },
    });

    expect(identity).toBeNull();
  });
});

describe("resolveIdentity (loader) — a portal (customer) session", () => {
  it("holds the customer grant, never an agent role, and never gains agent authority", async () => {
    const userId = `user-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: userId,
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Customer Person",
    });
    const organisationId = await insertCustomerPerson(userId);

    const identity = await resolveIdentity({
      userId,
      credential: "session",
    });

    expect(identity?.side).toBe("customer");
    expect(identity?.portal).toBe("customer");
    expect(identity?.reach).toEqual({
      kind: "organisation",
      ids: [organisationId],
    });
    expect(identity?.authority).toEqual([
      expect.objectContaining({ roleKey: "customer", scope: "organisation" }),
    ]);
  });
});

describe("resolveIdentity (loader) — anonymous", () => {
  it("resolves to null for a user with no person row at all", async () => {
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: `user-${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        emailVerified: true,
        name: "Anonymous",
        isAnonymous: true,
      })
      .returning();
    if (!user) throw new Error("insert failed");
    // Deliberately do NOT backfill a person row -- this is what an anonymous session
    // (never provisioned) actually looks like.

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity).toBeNull();
  });
});

describe("resolveIdentity (loader) — a deactivated member", () => {
  it("resolves to null even though real membership and role rows exist", async () => {
    const { user } = await createWorkspaceMember({ role: "manager" });
    await backfillStaffPersons();
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, user.id));

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity).toBeNull();
  });
});

describe("resolveIdentity (loader) — instance admin", () => {
  it("grants reach 'all' and instance_admin authority for user.role === 'admin'", async () => {
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: `user-${randomUUID()}`,
        email: `${randomUUID()}@example.com`,
        emailVerified: true,
        name: "Instance Admin",
        role: "admin",
      })
      .returning();
    if (!user) throw new Error("insert failed");
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity?.reach).toEqual({ kind: "all" });
    expect(
      identity?.authority.some((grant) => grant.roleKey === "instance_admin"),
    ).toBe(true);
  });
});

describe("resolveIdentity (loader) — teams", () => {
  it("collects every team membership, deduplicated", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "lead" });
    await backfillStaffPersons();

    const teamId = `team-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Team A",
      workspaceId: workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `tm-${randomUUID()}`,
      teamId,
      userId: user.id,
      createdAt: new Date(),
    });

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity?.teamIds).toEqual([teamId]);
  });
});

describe("resolveIdentity (loader) — S5 (PR #315 review): a team surviving leave-workspace", () => {
  it("excludes a team once the workspace_member row is deleted, even though team_member remains", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "lead" });
    await backfillStaffPersons();

    const teamId = `team-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Team A",
      workspaceId: workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `tm-${randomUUID()}`,
      teamId,
      userId: user.id,
      createdAt: new Date(),
    });

    // Simulate leave-workspace.ts / remove-workspace-member.ts: only workspace_member is
    // deleted, team_member is untouched (probe 8 of the security review).
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, user.id));

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity?.teamIds).toEqual([]);
  });
});

describe("resolveIdentity (loader) — S1 (BLOCKING, PR #315 review): reserved built-in names as a real workspace_member.role row", () => {
  it("skips a workspace_member row whose role is literally 'instance_admin'", async () => {
    const { user } = await createWorkspaceMember({
      role: "instance_admin",
      seedDefaultRoleRow: false,
    });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity?.memberships).toEqual([]);
    expect(identity?.authority).toEqual([]);
  });

  it("skips a workspace_member row whose role is literally 'customer'", async () => {
    const { user } = await createWorkspaceMember({
      role: "customer",
      seedDefaultRoleRow: false,
    });
    await backfillStaffPersons();

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity?.side).toBe("staff");
    expect(identity?.memberships).toEqual([]);
    expect(identity?.authority).toEqual([]);
  });
});

describe("resolveIdentity (loader) — S6 (PR #315 review): a banned user", () => {
  it("resolves to null for a banned staff user with a real workspace role", async () => {
    const { user } = await createWorkspaceMember({ role: "owner" });
    await backfillStaffPersons();
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, user.id));

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });

    expect(identity).toBeNull();
  });
});

describe("resolveIdentity (loader) — S6 (PR #315 review): a suspended customer organisation", () => {
  it("resolves to null when the customer's organisation is inactive", async () => {
    const userId = `user-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: userId,
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Customer Person",
    });
    const organisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `customer-org-${randomUUID()}`,
        name: "Suspended Customer Org",
        isInternal: false,
        active: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const org = organisation[0];
    if (!org) throw new Error("failed to insert customer organisation");
    await db.insert(schema.personTable).values({
      userId,
      organisationId: org.id,
      side: "customer",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const identity = await resolveIdentity({
      userId,
      credential: "session",
    });

    expect(identity).toBeNull();
  });

  it("resolves to null when the customer's organisation has portal access disabled", async () => {
    const userId = `user-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: userId,
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Customer Person",
    });
    const organisation = await db
      .insert(schema.organisationTable)
      .values({
        key: `customer-org-${randomUUID()}`,
        name: "No Portal Access Org",
        isInternal: false,
        portalAccess: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    const org = organisation[0];
    if (!org) throw new Error("failed to insert customer organisation");
    await db.insert(schema.personTable).values({
      userId,
      organisationId: org.id,
      side: "customer",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const identity = await resolveIdentity({
      userId,
      credential: "session",
    });

    expect(identity).toBeNull();
  });

  it("refuses a customer identity presenting an api_key credential", async () => {
    const userId = `user-${randomUUID()}`;
    await db.insert(schema.userTable).values({
      id: userId,
      email: `${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Customer Person",
    });
    await insertCustomerPerson(userId);

    const identity = await resolveIdentity({
      userId,
      credential: "api_key",
      apiKey: { enabled: true, ownerUserId: userId },
    });

    expect(identity).toBeNull();
  });
});
