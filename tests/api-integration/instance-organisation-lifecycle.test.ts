import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { customerInvitationDeliveryKeyring } from "../../apps/api/src/customer-invitation/delivery/keyring";
import db, { schema } from "../../apps/api/src/database";
import { customerInvitationDeliveryTable } from "../../apps/api/src/database/schema-customer-invitation-delivery";
import { createApp } from "../../apps/api/src/index";
import {
  loadOrganisationProfileForDeletion,
  softDeleteOrganisationInTransaction,
} from "../../apps/api/src/instance/organisation-lifecycle";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import {
  approvePendingDeletion,
  ensureAgentSession,
  type PendingDeletionBody,
} from "./helpers/pending-deletion";
import { makeApiKey } from "./helpers/reach-world";
import {
  mintStepUpToken,
  STEP_UP_TOKEN_HEADER,
  seedMockedSessionForStepUp,
} from "./helpers/step-up";

function request(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) {
  const r = withConfiguredAgentAuthority(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return app.request(r.input, r.init);
}

async function seedAdmin() {
  const member = await createWorkspaceMember({
    userName: "Organisation Admin",
  });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, member.user.id));
  await ensureStaffPersonForUser(member.user.id);
  mockAuthenticatedSession({ ...member.user, role: "admin" });
  return member;
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Customer One",
    key: "customer-one",
    emailDomains: ["example.test"],
    portalAccess: true,
    defaultCustomerVisibility: "organisation",
    quota: {
      maxProjects: 200,
      maxWorkItems: 500_000,
      maxStorageBytes: 21_474_836_480,
      maxPortalUsers: 500,
      maxApiRequestsPerMinute: 600,
      maxWebhooks: 10,
    },
    projectDefaults: [],
    requestTypeIds: [],
    ...overrides,
  };
}

async function createOrganisation(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown> = createBody(),
) {
  const response = await request(app, "/api/instance/organisations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return (await response.json()).data as {
    id: string;
    key: string;
    name: string;
    active: boolean;
    portalAccess: boolean;
    defaultCustomerVisibility: "private" | "organisation";
    emailDomains: string[];
    profileEtag: string;
    quota: {
      maxProjects: number;
      maxWorkItems: number;
      maxStorageBytes: number;
      maxPortalUsers: number;
      maxApiRequestsPerMinute: number;
      maxWebhooks: number;
    };
    projectDefaults: Array<{
      workspaceId: string;
      serviceCalendarId: string | null;
      slaPolicyId: string | null;
    }>;
  };
}

async function makeServedRequestType(workspaceId: string) {
  const workItemType = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `org-invite-task-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "customer request work item type",
  );
  const type = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId,
        key: `org-invite-request-${randomUUID()}`,
        name: "Report a problem",
        group: "Support",
        workItemTypeId: workItemType.id,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning(),
    "customer request type",
  );
  await db.insert(schema.requestTypeVersionTable).values({
    workspaceId,
    requestTypeId: type.id,
    number: 1,
    formSchema: { fields: [] },
    workItemTypeId: workItemType.id,
    autoAccept: false,
    defaultProjectId: null,
  });
  return type;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("God Mode organisation lifecycle", () => {
  it("requests deletion as a typed-name pending action without mutating the organisation", async () => {
    const admin = await seedAdmin();
    await ensureAgentSession(admin.user.id);
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );

    const response = await request(
      app,
      `/api/instance/organisations/${profile.id}`,
      {
        method: "DELETE",
        body: "{}",
      },
    );
    expect(response.status, await response.clone().text()).toBe(202);
    const pending = (await response.json()) as {
      pendingActionId: string;
      action: string;
      confirmation: string;
    };
    expect(pending).toMatchObject({
      action: "delete",
      confirmation: "typed_name_step_up",
    });
    expect(pending.pendingActionId).toEqual(expect.any(String));
    const stillActive = requireRow(
      await db
        .select({
          active: schema.organisationTable.active,
          deletedAt: schema.organisationTable.deletedAt,
        })
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.id, profile.id)),
      "unchanged requested organisation",
    );
    expect(stillActive).toMatchObject({ active: true, deletedAt: null });
    expect(
      await db
        .select({
          operationId: schema.organisationDeletionSnapshotTable.operationId,
        })
        .from(schema.organisationDeletionSnapshotTable)
        .where(
          eq(
            schema.organisationDeletionSnapshotTable.organisationId,
            profile.id,
          ),
        ),
    ).toEqual([]);

    const approved = await approvePendingDeletion(
      app,
      admin.user.id,
      pending as PendingDeletionBody,
      { typedName: profile.name },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect((await approved.json()).state).toBe("executed");
    expect(
      requireRow(
        await db
          .select({
            active: schema.organisationTable.active,
            deletedAt: schema.organisationTable.deletedAt,
            portalAccess: schema.organisationTable.portalAccess,
          })
          .from(schema.organisationTable)
          .where(eq(schema.organisationTable.id, profile.id)),
        "soft-deleted organisation after approval",
      ),
    ).toMatchObject({ active: false, portalAccess: false });
    expect(
      requireRow(
        await db
          .select({
            operationId: schema.organisationDeletionSnapshotTable.operationId,
          })
          .from(schema.organisationDeletionSnapshotTable)
          .where(
            eq(
              schema.organisationDeletionSnapshotTable.organisationId,
              profile.id,
            ),
          ),
        "organisation deletion snapshot",
      ).operationId,
    ).toBe(pending.pendingActionId);
  });

  it("denies organisation deletion to members, customer sessions, and API keys", async () => {
    const admin = await seedAdmin();
    await seedMockedSessionForStepUp(admin.user.id);
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );
    const path = `/api/instance/organisations/${profile.id}`;
    const body = "{}";

    const member = await createWorkspaceMember({ userName: "Non-admin" });
    mockAuthenticatedSession(member.user);
    expect((await request(app, path, { method: "DELETE", body })).status).toBe(
      403,
    );

    mockAuthenticatedSession(
      { ...admin.user, role: "admin" },
      { portal: "customer" },
    );
    expect([401, 403]).toContain(
      (await request(app, path, { method: "DELETE", body })).status,
    );

    const apiKey = await makeApiKey(admin.user.id, null);
    mockAnonymousSession();
    expect(
      (
        await request(app, path, {
          method: "DELETE",
          body,
          headers: { "x-api-key": apiKey },
        })
      ).status,
    ).toBe(403);
  });

  it("invalidates a pending deletion when the organisation profile changes", async () => {
    const admin = await seedAdmin();
    await ensureAgentSession(admin.user.id);
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );
    const response = await request(
      app,
      `/api/instance/organisations/${profile.id}`,
      {
        method: "DELETE",
        body: "{}",
      },
    );
    expect(response.status).toBe(202);
    const pending = (await response.json()) as PendingDeletionBody;

    const edited = await request(
      app,
      `/api/instance/organisations/${profile.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: "Customer One Changed",
          key: profile.key,
          emailDomains: [],
          portalAccess: profile.portalAccess,
          defaultCustomerVisibility: profile.defaultCustomerVisibility,
          quota: profile.quota,
          projectDefaults: profile.projectDefaults,
          expectedProfileEtag: profile.profileEtag,
        }),
      },
    );
    expect(edited.status).toBe(200);

    const challenge = await request(app, "/api/me/step-up/challenges", {
      method: "POST",
      body: JSON.stringify({
        kind: "pending_action",
        pendingActionId: pending.pendingActionId,
      }),
    });
    expect(challenge.status).toBe(403);
    expect(
      requireRow(
        await db
          .select({
            active: schema.organisationTable.active,
            deletedAt: schema.organisationTable.deletedAt,
          })
          .from(schema.organisationTable)
          .where(eq(schema.organisationTable.id, profile.id)),
        "still-active organisation after stale deletion approval",
      ),
    ).toMatchObject({ active: true, deletedAt: null });
  });

  it("restores only with a matching one-use proof and refuses replay", async () => {
    const admin = await seedAdmin();
    await seedMockedSessionForStepUp(admin.user.id);
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );
    const projects = await Promise.all(
      ["Unarchived", "Changed after delete", "Previously archived"].map(
        (name) =>
          createProjectFixture({
            workspaceId: admin.workspace.id,
            name: `Restore ${name} ${randomUUID()}`,
          }),
      ),
    );
    const [shouldRestore, changedAfterDelete, previouslyArchived] = projects;
    if (!shouldRestore || !changedAfterDelete || !previouslyArchived)
      throw new Error("project fixtures were not created");
    const priorArchiveAt = new Date("2026-01-03T00:00:00.000Z");
    await db
      .update(schema.projectTable)
      .set({ organisationId: profile.id })
      .where(
        or(
          eq(schema.projectTable.id, shouldRestore.project.id),
          eq(schema.projectTable.id, changedAfterDelete.project.id),
          eq(schema.projectTable.id, previouslyArchived.project.id),
        ),
      );
    await db
      .update(schema.projectTable)
      .set({ archivedAt: priorArchiveAt })
      .where(eq(schema.projectTable.id, previouslyArchived.project.id));
    const portalDisabled = await request(
      app,
      `/api/instance/organisations/${profile.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: profile.name,
          key: profile.key,
          emailDomains: profile.emailDomains,
          portalAccess: false,
          defaultCustomerVisibility: profile.defaultCustomerVisibility,
          quota: profile.quota,
          projectDefaults: profile.projectDefaults,
          expectedProfileEtag: profile.profileEtag,
        }),
      },
    );
    expect(portalDisabled.status).toBe(200);
    const disabledProfile = (await portalDisabled.json())
      .data as typeof profile;
    const suspended = await request(
      app,
      `/api/instance/organisations/${profile.id}/suspend`,
      {
        method: "POST",
        body: JSON.stringify({
          expectedProfileEtag: disabledProfile.profileEtag,
        }),
      },
    );
    expect(suspended.status).toBe(200);
    const operationId = `delete-${randomUUID()}`;
    const loaded = await db.transaction((tx) =>
      loadOrganisationProfileForDeletion(tx, profile.id),
    );
    if (!loaded) throw new Error("organisation profile missing");
    const deleted = await db.transaction((tx) =>
      softDeleteOrganisationInTransaction(tx, {
        organisationId: profile.id,
        expectedProfileEtag: loaded.profile.profileEtag,
        expectedGeneration: loaded.generation,
        operationId,
        actorUserId: admin.user.id,
        traceId: "organisation-lifecycle-integration",
      }),
    );
    expect(deleted.kind).toBe("deleted");
    if (deleted.kind !== "deleted")
      throw new Error("deletion did not complete");
    const laterArchiveAt = new Date("2026-04-05T00:00:00.000Z");
    await db
      .update(schema.projectTable)
      .set({ archivedAt: laterArchiveAt })
      .where(eq(schema.projectTable.id, changedAfterDelete.project.id));

    const cookie = `__Host-tdk_agent_session=token-${admin.user.id}`;
    const fields = {
      organisationId: profile.id,
      expectedOperationId: operationId,
      expectedGeneration: deleted.generation,
    };
    const noProof = await csrfRequest(
      app,
      `/api/instance/organisations/${profile.id}/restore`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          expectedOperationId: operationId,
          expectedGeneration: deleted.generation,
        }),
      },
      cookie,
    );
    expect(noProof.status, await noProof.clone().text()).toBe(403);

    const proof = await mintStepUpToken(
      app,
      cookie,
      "organisation_restore",
      fields,
    );
    expect(proof).toEqual(expect.any(String));
    if (!proof) throw new Error("restore step-up proof was not issued");
    const wrongOrganisation = await csrfRequest(
      app,
      `/api/instance/organisations/${randomUUID()}/restore`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          [STEP_UP_TOKEN_HEADER]: proof,
        },
        body: JSON.stringify({
          expectedOperationId: operationId,
          expectedGeneration: deleted.generation,
        }),
      },
      cookie,
    );
    expect(wrongOrganisation.status).toBe(404);

    for (const mismatch of [
      {
        expectedOperationId: `other-${operationId}`,
        expectedGeneration: deleted.generation,
      },
      {
        expectedOperationId: operationId,
        expectedGeneration: deleted.generation + 1,
      },
    ]) {
      const refused = await csrfRequest(
        app,
        `/api/instance/organisations/${profile.id}/restore`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            [STEP_UP_TOKEN_HEADER]: proof,
          },
          body: JSON.stringify(mismatch),
        },
        cookie,
      );
      expect(refused.status).toBe(409);
    }

    const restored = await csrfRequest(
      app,
      `/api/instance/organisations/${profile.id}/restore`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          [STEP_UP_TOKEN_HEADER]: proof,
        },
        body: JSON.stringify({
          expectedOperationId: operationId,
          expectedGeneration: deleted.generation,
        }),
      },
      cookie,
    );
    expect(restored.status).toBe(200);
    expect((await restored.json()).data).toMatchObject({
      id: profile.id,
      active: false,
      portalAccess: false,
    });
    const restoredProjects = await db
      .select({
        id: schema.projectTable.id,
        archivedAt: schema.projectTable.archivedAt,
        organisationDeletionOperationId:
          schema.projectTable.organisationDeletionOperationId,
      })
      .from(schema.projectTable)
      .where(
        or(
          eq(schema.projectTable.id, shouldRestore.project.id),
          eq(schema.projectTable.id, changedAfterDelete.project.id),
          eq(schema.projectTable.id, previouslyArchived.project.id),
        ),
      );
    expect(restoredProjects).toEqual(
      expect.arrayContaining([
        {
          id: shouldRestore.project.id,
          archivedAt: null,
          organisationDeletionOperationId: null,
        },
        {
          id: changedAfterDelete.project.id,
          archivedAt: laterArchiveAt,
          organisationDeletionOperationId: null,
        },
        {
          id: previouslyArchived.project.id,
          archivedAt: priorArchiveAt,
          organisationDeletionOperationId: null,
        },
      ]),
    );
    const replay = await csrfRequest(
      app,
      `/api/instance/organisations/${profile.id}/restore`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          [STEP_UP_TOKEN_HEADER]: proof,
        },
        body: JSON.stringify({
          expectedOperationId: operationId,
          expectedGeneration: deleted.generation,
        }),
      },
      cookie,
    );
    expect(replay.status).toBe(409);
  });

  it("rechecks current administrator authority before spending restore proof", async () => {
    const admin = await seedAdmin();
    await seedMockedSessionForStepUp(admin.user.id);
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );
    const operationId = `delete-${randomUUID()}`;
    const loaded = await db.transaction((tx) =>
      loadOrganisationProfileForDeletion(tx, profile.id),
    );
    if (!loaded) throw new Error("organisation profile missing");
    const deleted = await db.transaction((tx) =>
      softDeleteOrganisationInTransaction(tx, {
        organisationId: profile.id,
        expectedProfileEtag: loaded.profile.profileEtag,
        expectedGeneration: loaded.generation,
        operationId,
        actorUserId: admin.user.id,
        traceId: "organisation-lifecycle-admin-revocation",
      }),
    );
    if (deleted.kind !== "deleted")
      throw new Error("deletion did not complete");
    const cookie = `__Host-tdk_agent_session=token-${admin.user.id}`;
    const proof = await mintStepUpToken(app, cookie, "organisation_restore", {
      organisationId: profile.id,
      expectedOperationId: operationId,
      expectedGeneration: deleted.generation,
    });
    if (!proof) throw new Error("restore step-up proof was not issued");

    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, admin.user.id));
    const denied = await csrfRequest(
      app,
      `/api/instance/organisations/${profile.id}/restore`,
      {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          [STEP_UP_TOKEN_HEADER]: proof,
        },
        body: JSON.stringify({
          expectedOperationId: operationId,
          expectedGeneration: deleted.generation,
        }),
      },
      cookie,
    );
    expect(denied.status).toBe(403);
    expect(
      requireRow(
        await db
          .select({ deletedAt: schema.organisationTable.deletedAt })
          .from(schema.organisationTable)
          .where(eq(schema.organisationTable.id, profile.id)),
        "still-deleted organisation",
      ).deletedAt,
    ).not.toBeNull();
  });

  it("refuses restore after the recovery window without consuming its proof", async () => {
    const admin = await seedAdmin();
    await seedMockedSessionForStepUp(admin.user.id);
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );
    const operationId = `delete-${randomUUID()}`;
    const loaded = await db.transaction((tx) =>
      loadOrganisationProfileForDeletion(tx, profile.id),
    );
    if (!loaded) throw new Error("organisation profile missing");
    const deleted = await db.transaction((tx) =>
      softDeleteOrganisationInTransaction(tx, {
        organisationId: profile.id,
        expectedProfileEtag: loaded.profile.profileEtag,
        expectedGeneration: loaded.generation,
        operationId,
        actorUserId: admin.user.id,
        traceId: "organisation-lifecycle-expired-restore",
      }),
    );
    if (deleted.kind !== "deleted")
      throw new Error("deletion did not complete");

    const expiredDeletedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const expiredPurgeAfter = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.organisationTable)
        .set({ deletedAt: expiredDeletedAt, purgeAfter: expiredPurgeAfter })
        .where(eq(schema.organisationTable.id, profile.id));
      await tx
        .update(schema.organisationDeletionSnapshotTable)
        .set({ deletedAt: expiredDeletedAt, purgeAfter: expiredPurgeAfter })
        .where(
          eq(
            schema.organisationDeletionSnapshotTable.organisationId,
            profile.id,
          ),
        );
    });

    const cookie = `__Host-tdk_agent_session=token-${admin.user.id}`;
    const proof = await mintStepUpToken(app, cookie, "organisation_restore", {
      organisationId: profile.id,
      expectedOperationId: operationId,
      expectedGeneration: deleted.generation,
    });
    if (!proof) throw new Error("restore step-up proof was not issued");
    const path = `/api/instance/organisations/${profile.id}/restore`;
    const restoreRequest = () =>
      csrfRequest(
        app,
        path,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            [STEP_UP_TOKEN_HEADER]: proof,
          },
          body: JSON.stringify({
            expectedOperationId: operationId,
            expectedGeneration: deleted.generation,
          }),
        },
        cookie,
      );

    const expired = await restoreRequest();
    expect(expired.status).toBe(409);
    expect(
      requireRow(
        await db
          .select({ deletedAt: schema.organisationTable.deletedAt })
          .from(schema.organisationTable)
          .where(eq(schema.organisationTable.id, profile.id)),
        "still-deleted expired organisation",
      ).deletedAt,
    ).not.toBeNull();

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.organisationTable)
        .set({
          deletedAt: new Date(now.getTime() - 60_000),
          purgeAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        })
        .where(eq(schema.organisationTable.id, profile.id));
      await tx
        .update(schema.organisationDeletionSnapshotTable)
        .set({
          deletedAt: new Date(now.getTime() - 60_000),
          purgeAfter: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        })
        .where(
          eq(
            schema.organisationDeletionSnapshotTable.organisationId,
            profile.id,
          ),
        );
    });
    expect((await restoreRequest()).status).toBe(200);
  });

  it("refuses domain conflicts on restore without consuming its proof", async () => {
    const admin = await seedAdmin();
    await seedMockedSessionForStepUp(admin.user.id);
    const { app } = createApp();
    const deletedProfile = await createOrganisation(
      app,
      createBody({
        key: "domain-restore-source",
        emailDomains: ["restore.example.test"],
      }),
    );
    const loaded = await db.transaction((tx) =>
      loadOrganisationProfileForDeletion(tx, deletedProfile.id),
    );
    if (!loaded) throw new Error("organisation profile missing");
    const operationId = `delete-${randomUUID()}`;
    const deleted = await db.transaction((tx) =>
      softDeleteOrganisationInTransaction(tx, {
        organisationId: deletedProfile.id,
        expectedProfileEtag: loaded.profile.profileEtag,
        expectedGeneration: loaded.generation,
        operationId,
        actorUserId: admin.user.id,
        traceId: "organisation-lifecycle-domain-conflict",
      }),
    );
    if (deleted.kind !== "deleted")
      throw new Error("deletion did not complete");

    const competingProfile = await createOrganisation(
      app,
      createBody({
        key: "domain-restore-claimant",
        name: "Claimant organisation",
        emailDomains: ["restore.example.test"],
      }),
    );
    const cookie = `__Host-tdk_agent_session=token-${admin.user.id}`;
    const proof = await mintStepUpToken(app, cookie, "organisation_restore", {
      organisationId: deletedProfile.id,
      expectedOperationId: operationId,
      expectedGeneration: deleted.generation,
    });
    if (!proof) throw new Error("restore step-up proof was not issued");
    const path = `/api/instance/organisations/${deletedProfile.id}/restore`;
    const body = JSON.stringify({
      expectedOperationId: operationId,
      expectedGeneration: deleted.generation,
    });
    const restore = () =>
      csrfRequest(
        app,
        path,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            [STEP_UP_TOKEN_HEADER]: proof,
          },
          body,
        },
        cookie,
      );

    expect((await restore()).status).toBe(409);
    expect(
      requireRow(
        await db
          .select({ deletedAt: schema.organisationTable.deletedAt })
          .from(schema.organisationTable)
          .where(eq(schema.organisationTable.id, deletedProfile.id)),
        "still-deleted domain-conflicting organisation",
      ).deletedAt,
    ).not.toBeNull();

    const released = await request(
      app,
      `/api/instance/organisations/${competingProfile.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: competingProfile.name,
          key: competingProfile.key,
          emailDomains: [],
          portalAccess: competingProfile.portalAccess,
          defaultCustomerVisibility: competingProfile.defaultCustomerVisibility,
          quota: competingProfile.quota,
          projectDefaults: competingProfile.projectDefaults,
          expectedProfileEtag: competingProfile.profileEtag,
        }),
      },
    );
    expect(released.status).toBe(200);
    expect((await restore()).status).toBe(200);
  });

  it("creates and edits persisted profile, applies CAS, and revokes customer sessions", async () => {
    await seedAdmin();
    const { app } = createApp();
    const profile = await createOrganisation(app);
    expect(profile.emailDomains).toEqual(["example.test"]);
    expect(profile.quota.maxStorageBytes).toBe(21_474_836_480);
    const quota = requireRow(
      await db
        .select()
        .from(schema.organisationQuotaTable)
        .where(eq(schema.organisationQuotaTable.organisationId, profile.id)),
      "created organisation quota",
    );
    expect(quota.maxPortalUsers).toBe(500);

    const user = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: "customer-session-user",
          email: "contact@example.test",
          emailVerified: true,
          name: "Customer Contact",
        })
        .returning(),
      "customer session user",
    );
    await db.insert(schema.personTable).values({
      id: "customer-session-person",
      userId: user.id,
      organisationId: profile.id,
      side: "customer",
      displayName: "Customer Contact",
    });
    await db.insert(schema.sessionTable).values({
      id: "customer-live-session",
      token: "customer-live-token",
      userId: user.id,
      portal: "customer",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const updatedValues = {
      name: "Customer One Renamed",
      key: profile.key,
      emailDomains: ["EXAMPLE.TEST"],
      portalAccess: false,
      defaultCustomerVisibility: "private",
      quota: { ...profile.quota, maxProjects: 175 },
      projectDefaults: [],
    };
    const update = await request(
      app,
      `/api/instance/organisations/${profile.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...updatedValues,
          expectedProfileEtag: profile.profileEtag,
        }),
      },
    );
    expect(update.status).toBe(200);
    const saved = (await update.json()).data as typeof profile;
    expect(saved.name).toBe("Customer One Renamed");
    expect(saved.emailDomains).toEqual(["example.test"]);
    expect(saved.profileEtag).not.toBe(profile.profileEtag);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, user.id)),
    ).toEqual([]);

    const stale = await request(
      app,
      `/api/instance/organisations/${profile.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          ...updatedValues,
          name: "Stale Name",
          expectedProfileEtag: profile.profileEtag,
        }),
      },
    );
    expect(stale.status).toBe(409);
    expect((await stale.json()).message).toBe("organisation_profile_conflict");
    const persisted = requireRow(
      await db
        .select()
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.id, profile.id)),
      "persisted customer organisation",
    );
    expect(persisted.name).toBe("Customer One Renamed");
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.organisationId, profile.id),
          eq(schema.auditLogTable.action, "organisation.updated"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("suspends and restores with profile CAS, revoking sessions on suspension", async () => {
    await seedAdmin();
    const { app } = createApp();
    const profile = await createOrganisation(
      app,
      createBody({ emailDomains: [] }),
    );
    const user = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: "suspension-session-user",
          email: "member@example.test",
          emailVerified: true,
          name: "Customer Member",
        })
        .returning(),
      "suspension user",
    );
    await db.insert(schema.personTable).values({
      id: "suspension-session-person",
      userId: user.id,
      organisationId: profile.id,
      side: "customer",
      displayName: "Customer Member",
    });
    await db.insert(schema.sessionTable).values({
      id: "suspension-live-session",
      token: "suspension-live-token",
      userId: user.id,
      portal: "customer",
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const suspendedResponse = await request(
      app,
      `/api/instance/organisations/${profile.id}/suspend`,
      {
        method: "POST",
        body: JSON.stringify({ expectedProfileEtag: profile.profileEtag }),
      },
    );
    expect(suspendedResponse.status).toBe(200);
    const suspended = (await suspendedResponse.json()).data as typeof profile;
    expect(suspended.active).toBe(false);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, user.id)),
    ).toEqual([]);
    const staleUnsuspend = await request(
      app,
      `/api/instance/organisations/${profile.id}/unsuspend`,
      {
        method: "POST",
        body: JSON.stringify({ expectedProfileEtag: profile.profileEtag }),
      },
    );
    expect(staleUnsuspend.status).toBe(409);

    const restoredResponse = await request(
      app,
      `/api/instance/organisations/${profile.id}/unsuspend`,
      {
        method: "POST",
        body: JSON.stringify({ expectedProfileEtag: suspended.profileEtag }),
      },
    );
    expect(restoredResponse.status).toBe(200);
    expect((await restoredResponse.json()).data.active).toBe(true);
  });

  it("rejects non-admin and portal callers and rolls invalid creation back", async () => {
    const member = await createWorkspaceMember({ userName: "Regular Member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const denied = await request(app, "/api/instance/organisations", {
      method: "POST",
      body: JSON.stringify(createBody()),
    });
    expect(denied.status).toBe(403);

    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id));
    await ensureStaffPersonForUser(member.user.id);
    mockAuthenticatedSession(
      { ...member.user, role: "admin" },
      { portal: "customer" },
    );
    const portalDenied = await request(app, "/api/instance/organisations", {
      method: "POST",
      body: JSON.stringify(createBody({ key: "portal-denied" })),
    });
    expect(portalDenied.status).toBe(401);

    mockAuthenticatedSession({ ...member.user, role: "admin" });
    const invalid = await request(app, "/api/instance/organisations", {
      method: "POST",
      body: JSON.stringify(
        createBody({
          key: "invalid-catalogue",
          requestTypeIds: ["unknown-request-type"],
        }),
      ),
    });
    expect(invalid.status).toBe(422);
    expect(
      await db
        .select({ id: schema.organisationTable.id })
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.key, "invalid-catalogue")),
    ).toEqual([]);
  });

  it("serializes duplicate organisation domains with the IDP domain registry", async () => {
    await seedAdmin();
    const { app } = createApp();
    const [left, right] = await Promise.all([
      request(app, "/api/instance/organisations", {
        method: "POST",
        body: JSON.stringify(
          createBody({
            key: "domain-left",
            emailDomains: ["shared.example.test"],
          }),
        ),
      }),
      request(app, "/api/instance/organisations", {
        method: "POST",
        body: JSON.stringify(
          createBody({
            key: "domain-right",
            emailDomains: ["shared.example.test"],
          }),
        ),
      }),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 409]);
    const matches = await db
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.domain, ["shared.example.test"]));
    expect(matches).toHaveLength(1);
  });

  it("creates the initial-contact invitation in the CP23 queue without returning a credential", async () => {
    const admin = await seedAdmin();
    const type = await makeServedRequestType(admin.workspace.id);
    const { app } = createApp();
    const response = await request(app, "/api/instance/organisations", {
      method: "POST",
      body: JSON.stringify(
        createBody({
          emailDomains: [],
          requestTypeIds: [type.id],
          initialContact: {
            email: "initial.contact@example.test",
            workspaceId: admin.workspace.id,
          },
        }),
      ),
    });
    expect(response.status).toBe(201);
    const json = (await response.json()) as {
      data: {
        id: string;
        initialInvitation: {
          id: string;
          status: string;
          expiresAt: string;
        };
      };
    };
    expect(json.data.initialInvitation).toMatchObject({ status: "pending" });
    expect(JSON.stringify(json)).not.toContain("initial.contact@example.test");
    expect(JSON.stringify(json)).not.toContain("credential");
    const invitation = requireRow(
      await db
        .select()
        .from(schema.invitationTable)
        .where(eq(schema.invitationTable.id, json.data.initialInvitation.id)),
      "initial customer invitation",
    );
    expect(invitation).toMatchObject({
      organisationId: json.data.id,
      workspaceId: admin.workspace.id,
      scope: "customer",
      role: "customer",
      email: "initial.contact@example.test",
    });
    const delivery = requireRow(
      await db
        .select()
        .from(customerInvitationDeliveryTable)
        .where(
          eq(
            customerInvitationDeliveryTable.invitationId,
            json.data.initialInvitation.id,
          ),
        ),
      "initial customer invitation delivery",
    );
    expect(delivery).toMatchObject({ state: "queued", attempts: 0 });
    expect(delivery.envelope).toEqual(expect.any(String));
    expect(
      customerInvitationDeliveryKeyring.remainingMs(
        delivery.id,
        customerInvitationDeliveryKeyring.ownerId,
      ),
    ).toBeGreaterThan(0);
  });

  it("rolls back organisation creation when the initial-contact workspace is not served", async () => {
    const admin = await seedAdmin();
    const type = await makeServedRequestType(admin.workspace.id);
    const { app } = createApp();
    const response = await request(app, "/api/instance/organisations", {
      method: "POST",
      body: JSON.stringify(
        createBody({
          key: "invalid-initial-contact-workspace",
          emailDomains: [],
          requestTypeIds: [type.id],
          initialContact: {
            email: "initial.contact@example.test",
            workspaceId: "unserved-workspace",
          },
        }),
      ),
    });
    expect(response.status).toBe(422);
    expect(
      await db
        .select({ id: schema.organisationTable.id })
        .from(schema.organisationTable)
        .where(
          eq(schema.organisationTable.key, "invalid-initial-contact-workspace"),
        ),
    ).toEqual([]);
    expect(
      await db
        .select({ id: schema.invitationTable.id })
        .from(schema.invitationTable)
        .where(
          eq(schema.invitationTable.email, "initial.contact@example.test"),
        ),
    ).toEqual([]);
  });
});
