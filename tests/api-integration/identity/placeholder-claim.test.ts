import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../../apps/api/src/identity/client-secret";
import {
  claimVerifiedImportPlaceholder,
  reportPlaceholderClaimAuditWriteFailure,
} from "../../../apps/api/src/identity/placeholder-claim";
import { resetTestDatabase } from "../helpers/database";
import { createWorkspaceMember, requireRow } from "../helpers/fixtures";

type ClaimMethod = "email_otp" | "magic_link";

async function fixture(
  options: {
    email?: string;
    verified?: boolean;
    personActive?: boolean;
    side?: "staff" | "customer";
    claimed?: boolean;
    attachScimIdentity?: boolean;
  } = {},
) {
  const { user: owner, workspace } = await createWorkspaceMember({
    role: "owner",
  });
  const side = options.side ?? "staff";
  const personOrganisation =
    side === "customer"
      ? requireRow(
          await db
            .insert(schema.organisationTable)
            .values({
              key: `placeholder-customer-${randomUUID()}`,
              name: "Customer claim scope",
              isInternal: false,
              active: true,
              portalAccess: true,
            })
            .returning(),
          "placeholder customer organisation",
        )
      : { id: workspace.organisationId };
  const [ownerPerson] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, owner.id));
  if (!ownerPerson) throw new Error("placeholder import owner person missing");
  const email = options.email ?? "imported-author@example.test";
  const claimant = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `claimant-${randomUUID()}`,
        name: "Verified claimant",
        email,
        emailVerified: options.verified ?? true,
      })
      .returning(),
    "placeholder claimant user",
  );
  const [run] = await db
    .insert(schema.importRunTable)
    .values({
      workspaceId: workspace.id,
      projectId: null,
      pluginId: "import.mcp",
      sourceRef: `placeholder-source-${randomUUID()}`,
      startedBy: ownerPerson.id,
      state: "completed",
    })
    .returning();
  if (!run) throw new Error("placeholder import run fixture missing");

  const [placeholder] = await db
    .insert(schema.personTable)
    .values({
      organisationId: personOrganisation.id,
      side,
      displayName: "Imported author",
      active: options.personActive ?? true,
      isPlaceholder: true,
    })
    .returning();
  if (!placeholder) throw new Error("placeholder person fixture missing");
  await db.insert(schema.importPlaceholderClaimTable).values({
    personId: placeholder.id,
    importRunId: run.id,
    normalizedEmail: email.trim().toLowerCase(),
    ...(options.claimed ? { claimedAt: new Date() } : {}),
  });

  if (options.attachScimIdentity) {
    const connectionId = `claim-scim-${randomUUID()}`;
    const [connection] = await db
      .insert(schema.identityConnectionTable)
      .values({
        id: connectionId,
        providerType: "entra",
        portalScope: "agent",
        displayName: "SCIM claim fixture",
        issuer: "https://issuer.example.test",
        clientId: "client",
        clientSecret: encryptIdentityClientSecret(
          connectionId,
          "fixture-secret",
        ),
        redirectUri: "http://localhost:1337/callback",
        scopes: ["openid"],
        claimMapping: {},
        domainBindings: [],
        jitPolicy: {},
        maxRoleRank: 0,
      })
      .returning();
    if (!connection) throw new Error("SCIM connection fixture missing");
    await db.insert(schema.externalIdentityTable).values({
      identityConnectionId: connection.id,
      personId: placeholder.id,
      issuer: connection.issuer,
      subject: `subject-${randomUUID()}`,
      emailSnapshot: email,
      active: true,
      provisionedVia: "scim",
    });
  }

  return {
    claimant,
    workspace,
    run,
    placeholder,
    ownerPersonId: ownerPerson.id,
    input: {
      userId: claimant.id,
      verifiedEmail: email,
      side,
      organisationId: personOrganisation.id,
      method: "email_otp" as ClaimMethod,
    },
  };
}

describe("IP-30 imported placeholder claims", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it.each(["email_otp", "magic_link"] as const)(
    "links the one current verified same-tenant placeholder via %s and records a PII-free audit",
    async (method) => {
      const data = await fixture();
      const beforeGrants = await db
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.personId, data.placeholder.id));

      const result = await db.transaction((tx) =>
        claimVerifiedImportPlaceholder(tx, { ...data.input, method }),
      );

      expect(result).toMatchObject({
        kind: "claimed",
        personId: data.placeholder.id,
      });
      const [person] = await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.id, data.placeholder.id));
      const [claim] = await db
        .select()
        .from(schema.importPlaceholderClaimTable)
        .where(
          eq(schema.importPlaceholderClaimTable.personId, data.placeholder.id),
        );
      const afterGrants = await db
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.personId, data.placeholder.id));
      expect(person).toMatchObject({
        id: data.placeholder.id,
        userId: data.claimant.id,
        isPlaceholder: false,
        active: true,
        side: "staff",
        organisationId: data.workspace.organisationId,
      });
      expect(claim?.claimedAt).toBeInstanceOf(Date);
      expect(afterGrants).toEqual(beforeGrants);

      const [audit] = await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "identity.placeholder_claimed"),
            eq(schema.auditLogTable.entityId, data.placeholder.id),
          ),
        );
      expect(audit?.after).toMatchObject({
        personId: data.placeholder.id,
        importRunId: data.run.id,
        organisationId: data.workspace.organisationId,
        side: "staff",
        method,
        userId: data.claimant.id,
      });
      expect(
        JSON.stringify({ before: audit?.before, after: audit?.after }),
      ).not.toContain(data.claimant.email);
    },
  );

  it("returns none when the verified address has no import claim", async () => {
    const data = await fixture();
    await db
      .delete(schema.importPlaceholderClaimTable)
      .where(
        eq(schema.importPlaceholderClaimTable.personId, data.placeholder.id),
      );

    await expect(
      db.transaction((tx) => claimVerifiedImportPlaceholder(tx, data.input)),
    ).resolves.toEqual({ kind: "none" });
  });

  it("claims a customer placeholder into its own organisation from an internal workspace import", async () => {
    const data = await fixture({ side: "customer" });
    const result = await db.transaction((tx) =>
      claimVerifiedImportPlaceholder(tx, data.input),
    );

    expect(result).toMatchObject({
      kind: "claimed",
      personId: data.placeholder.id,
    });
    const [person] = await db
      .select({
        organisationId: schema.personTable.organisationId,
        side: schema.personTable.side,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, data.placeholder.id));
    expect(person).toMatchObject({
      organisationId: data.input.organisationId,
      side: "customer",
    });
  });

  it("commits the claim when its audit savepoint fails and exposes only an internal failure flag", async () => {
    const data = await fixture();
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, data.claimant.id));
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `placeholder_claim_audit_failure_${suffix}`;
    const triggerName = `${functionName}_trigger`;
    await db.execute(
      sql.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action = 'identity.placeholder_claimed' THEN
            RAISE EXCEPTION 'test audit failure';
          END IF;
          RETURN NEW;
        END
      $$`),
    );
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      ),
    );
    try {
      const result = await db.transaction((tx) =>
        claimVerifiedImportPlaceholder(tx, data.input),
      );
      if (result.kind !== "claimed")
        throw new Error("placeholder claim unexpectedly absent");
      expect(result).toEqual({
        kind: "claimed",
        personId: data.placeholder.id,
        auditFailure: true,
      });
      const [person] = await db
        .select({
          userId: schema.personTable.userId,
          isPlaceholder: schema.personTable.isPlaceholder,
        })
        .from(schema.personTable)
        .where(eq(schema.personTable.id, data.placeholder.id));
      expect(person).toEqual({
        userId: data.claimant.id,
        isPlaceholder: false,
      });

      await reportPlaceholderClaimAuditWriteFailure(
        result.auditFailure === true,
      );
      const [alert] = await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(alert).toBeDefined();
      expect(JSON.stringify(alert)).not.toContain(data.claimant.email);
    } finally {
      await db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_log`),
      );
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
    }
  });

  it.each([
    ["unverified account", { verified: false }],
    ["inactive placeholder", { personActive: false }],
    ["already claimed placeholder", { claimed: true }],
    ["SCIM-bound placeholder", { attachScimIdentity: true }],
  ])("denies %s without linking the person", async (_label, options) => {
    const data = await fixture(options);
    await expect(
      db.transaction((tx) => claimVerifiedImportPlaceholder(tx, data.input)),
    ).rejects.toThrow("Placeholder claim denied");
    const [person] = await db
      .select({
        userId: schema.personTable.userId,
        isPlaceholder: schema.personTable.isPlaceholder,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, data.placeholder.id));
    expect(person).toEqual({ userId: null, isPlaceholder: true });
  });

  it("denies mismatched proof email and another existing person identity", async () => {
    const data = await fixture();
    await expect(
      db.transaction((tx) =>
        claimVerifiedImportPlaceholder(tx, {
          ...data.input,
          verifiedEmail: "different@example.test",
        }),
      ),
    ).rejects.toThrow("Placeholder claim denied");

    await db.insert(schema.personTable).values({
      userId: data.claimant.id,
      organisationId: data.workspace.organisationId,
      side: "staff",
      isPlaceholder: false,
    });
    await expect(
      db.transaction((tx) => claimVerifiedImportPlaceholder(tx, data.input)),
    ).rejects.toThrow("Placeholder claim denied");
  });

  it("denies a valid but foreign organisation context", async () => {
    const data = await fixture();
    const [foreignOrganisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: `placeholder-foreign-${randomUUID()}`,
        name: "Foreign claim scope",
        isInternal: false,
        active: true,
      })
      .returning({ id: schema.organisationTable.id });
    if (!foreignOrganisation)
      throw new Error("foreign organisation fixture missing");

    await expect(
      db.transaction((tx) =>
        claimVerifiedImportPlaceholder(tx, {
          ...data.input,
          organisationId: foreignOrganisation.id,
        }),
      ),
    ).rejects.toThrow("Placeholder claim denied");
  });

  it("denies a staff placeholder under a customer-side verified context", async () => {
    const data = await fixture();
    const [customerOrganisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: `placeholder-side-${randomUUID()}`,
        name: "Customer side scope",
        isInternal: false,
        active: true,
        portalAccess: true,
      })
      .returning({ id: schema.organisationTable.id });
    if (!customerOrganisation)
      throw new Error("customer side organisation fixture missing");

    await expect(
      db.transaction((tx) =>
        claimVerifiedImportPlaceholder(tx, {
          ...data.input,
          side: "customer",
          organisationId: customerOrganisation.id,
        }),
      ),
    ).rejects.toThrow("Placeholder claim denied");
  });

  it("denies duplicate imported email candidates instead of picking one", async () => {
    const data = await fixture();
    const [second] = await db
      .insert(schema.personTable)
      .values({
        organisationId: data.workspace.organisationId,
        side: "staff",
        displayName: "Second imported author",
        active: true,
        isPlaceholder: true,
      })
      .returning();
    if (!second) throw new Error("second placeholder fixture missing");
    await db.insert(schema.importPlaceholderClaimTable).values({
      personId: second.id,
      importRunId: data.run.id,
      normalizedEmail: data.claimant.email,
    });

    await expect(
      db.transaction((tx) => claimVerifiedImportPlaceholder(tx, data.input)),
    ).rejects.toThrow("Placeholder claim denied");
  });

  it.each(["membership", "grant"] as const)(
    "refuses to claim a placeholder carrying pre-existing %s authority",
    async (authorityKind) => {
      const data = await fixture();
      const [ownerRole] = await db
        .select({ id: schema.roleTable.id })
        .from(schema.roleTable)
        .where(
          and(
            eq(schema.roleTable.scope, "workspace"),
            eq(schema.roleTable.workspaceId, data.workspace.id),
            eq(schema.roleTable.key, "owner"),
          ),
        )
        .limit(1);
      if (!ownerRole) throw new Error("canonical owner role fixture missing");
      const [membership] = await db
        .insert(schema.membershipTable)
        .values({
          personId: data.placeholder.id,
          scope: "workspace",
          scopeId: data.workspace.id,
          roleId: ownerRole.id,
          seesAll: true,
        })
        .returning();
      if (!membership)
        throw new Error("placeholder membership fixture missing");
      if (authorityKind === "grant") {
        await db.insert(schema.membershipGrantTable).values({
          membershipId: membership.id,
          personId: data.placeholder.id,
          scope: "workspace",
          scopeId: data.workspace.id,
          roleId: ownerRole.id,
          sourceKind: "direct",
          directOrigin: "admin",
          grantedByPersonId: data.ownerPersonId,
          seesAll: true,
        });
      }

      await expect(
        db.transaction((tx) => claimVerifiedImportPlaceholder(tx, data.input)),
      ).rejects.toThrow("Placeholder claim denied");
      const [person] = await db
        .select({
          userId: schema.personTable.userId,
          isPlaceholder: schema.personTable.isPlaceholder,
        })
        .from(schema.personTable)
        .where(eq(schema.personTable.id, data.placeholder.id));
      expect(person).toEqual({ userId: null, isPlaceholder: true });
    },
  );
});
