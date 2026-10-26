import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAuditChain } from "../../apps/api/src/audit/verify-audit-chain";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  loadOrganisationProfileForDeletion,
  softDeleteOrganisationInTransaction,
} from "../../apps/api/src/instance/organisation-lifecycle";
import { inspectHardPurgeTarget } from "../../apps/api/src/instance/purge-target";
import { approveClickDeletion } from "../../apps/api/src/pending-action/click-deletion-executor";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import * as storage from "../../apps/api/src/storage";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { workItemWorld } from "./helpers/p4-closeout";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

type App = ReturnType<typeof createApp>["app"];
const json = { "content-type": "application/json" };
const AUDIT_FAILURE_TRIGGER = "td_hard_purge_audit_failure";

async function armHardPurgeAuditFailure() {
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION ${AUDIT_FAILURE_TRIGGER}() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'hard_purge.executed' THEN
          RAISE EXCEPTION 'synthetic hard purge audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${AUDIT_FAILURE_TRIGGER}
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION ${AUDIT_FAILURE_TRIGGER}();
    `),
  );
}

async function disarmHardPurgeAuditFailure() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${AUDIT_FAILURE_TRIGGER} ON audit_log`),
  );
  await db.execute(
    sql.raw(`DROP FUNCTION IF EXISTS ${AUDIT_FAILURE_TRIGGER}()`),
  );
}

function agentRequest(app: App, input: string, init?: RequestInit) {
  const request = withConfiguredAgentAuthority(input, init);
  return app.request(request.input, request.init);
}

async function fixture() {
  const member = await createWorkspaceMember({ role: "owner" });
  const admin = requireRow(
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id))
      .returning(),
    "instance admin",
  );
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.id)),
    "instance admin person",
  );
  const now = new Date();
  await db.insert(schema.sessionTable).values({
    id: `session-${admin.id}`,
    token: randomUUID(),
    userId: admin.id,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.accountTable).values({
    id: `${admin.id}-account`,
    accountId: admin.id,
    providerId: "credential",
    userId: admin.id,
    password: await bcrypt.hash("purge-test-password", 4),
  });
  const project = (
    await createProjectFixture({ workspaceId: member.workspace.id })
  ).project;
  const items = await workItemWorld(member.workspace.id, project.id);
  const workItem = await items.makeItem("Purge candidate");
  await db
    .update(schema.workItemTable)
    .set({
      deletedAt: new Date(),
    })
    .where(eq(schema.workItemTable.id, workItem.id));
  mockAuthenticatedSession(admin);
  return {
    admin,
    person,
    member,
    project,
    workItem,
    items,
    app: createApp().app,
  };
}

async function createApiKey(userId: string) {
  const rawKey = `taskdesk_purge_${randomUUID()}`;
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: createHash("sha256").update(rawKey).digest().toString("base64url"),
    name: "hard purge session-only test",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return rawKey;
}

async function requestPurge(
  app: App,
  targetType: "work_item" | "project" | "organisation",
  targetId: string,
  headers: HeadersInit = json,
) {
  return agentRequest(app, "/api/instance/purge", {
    method: "POST",
    headers,
    body: JSON.stringify({ targetType, targetId }),
  });
}

async function prepareOrganisationPurge(
  w: Awaited<ReturnType<typeof fixture>>,
) {
  const organisation = requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `purge-${randomUUID().slice(0, 12)}`,
        name: `Purge Customer ${randomUUID().slice(0, 8)}`,
        domain: [],
      })
      .returning(),
    "organisation purge target",
  );
  const project = (
    await createProjectFixture({ workspaceId: w.member.workspace.id })
  ).project;
  await db
    .update(schema.projectTable)
    .set({ organisationId: organisation.id })
    .where(eq(schema.projectTable.id, project.id));
  const world = await workItemWorld(w.member.workspace.id, project.id);
  const workItem = await world.makeItem("Organisation purge item");
  const deletion = await db.transaction(async (tx) => {
    const current = await loadOrganisationProfileForDeletion(
      tx,
      organisation.id,
    );
    if (!current) throw new Error("organisation purge target missing");
    return softDeleteOrganisationInTransaction(tx, {
      organisationId: organisation.id,
      expectedProfileEtag: current.profile.profileEtag,
      expectedGeneration: current.generation,
      operationId: `delete-${randomUUID()}`,
      actorUserId: w.admin.id,
      traceId: `trace-${randomUUID()}`,
    });
  });
  if (deletion.kind !== "deleted")
    throw new Error(`organisation soft delete failed: ${deletion.kind}`);
  return { organisation, project, workItem, deletion };
}

async function pendingActionToken(app: App, pendingActionId: string) {
  const challengeResponse = await agentRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({ kind: "pending_action", pendingActionId }),
    },
  );
  expect(challengeResponse.status, await challengeResponse.clone().text()).toBe(
    200,
  );
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proof = await agentRequest(app, "/api/me/step-up", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      kind: "pending_action",
      pendingActionId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "password",
      password: "purge-test-password",
    }),
  });
  expect(proof.status, await proof.clone().text()).toBe(200);
  return ((await proof.json()) as { token: string }).token;
}

async function approvePurge(
  app: App,
  pendingActionId: string,
  typedName: string,
  token?: string,
) {
  const headers = new Headers(json);
  if (token) headers.set("x-taskdesk-step-up-token", token);
  return agentRequest(
    app,
    `/api/me/pending-actions/${pendingActionId}/approve`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ typedName }),
    },
  );
}

beforeEach(async () => resetTestDatabase());
afterEach(async () => {
  await disarmHardPurgeAuditFailure();
  vi.restoreAllMocks();
});

describe("PA-13 instance hard purge", () => {
  it("returns 202 without mutation, then typed-name step-up approval purges and audits", async () => {
    const w = await fixture();
    const requested = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(requested.status, await requested.clone().text()).toBe(202);
    const body = (await requested.json()) as {
      pendingActionId: string;
      action: string;
      confirmation: string;
      summary: { name: string };
    };
    expect(body).toMatchObject({
      action: "purge",
      confirmation: "typed_name_step_up",
      summary: { name: w.workItem.key },
    });
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(1);
    const [pending] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, body.pendingActionId));
    expect(pending).toMatchObject({
      action: "purge",
      targetType: "work_item",
      targetIds: [w.workItem.id],
      workspaceId: w.member.workspace.id,
      projectId: null,
      confirmationRequired: "typed_name_step_up",
      state: "pending",
    });

    const token = await pendingActionToken(w.app, body.pendingActionId);
    const approved = await approvePurge(
      w.app,
      body.pendingActionId,
      w.workItem.key,
      token,
    );
    const approvalRow = await db.query.pendingActionTable.findFirst({
      where: eq(schema.pendingActionTable.id, body.pendingActionId),
    });
    expect(
      approved.status,
      `${await approved.clone().text()} (${approvalRow?.error ?? "no error code"})`,
    ).toBe(200);
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(0);
    const [completed] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, body.pendingActionId));
    expect(completed?.state).toBe("executed");
    const purgeAudits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "hard_purge.executed"),
          eq(schema.auditLogTable.entityId, w.workItem.id),
        ),
      );
    expect(purgeAudits).toHaveLength(1);
    expect(purgeAudits[0]?.after).toMatchObject({
      targetType: "work_item",
      targetId: w.workItem.id,
      workItems: 1,
      comments: 0,
      attachments: 0,
      storageObjectCount: 0,
      legalHold: "none",
      retention: "soft_deleted",
    });
  });

  it("requires exact-name step-up and purges only org projects in a shared workspace", async () => {
    const w = await fixture();
    const target = await prepareOrganisationPurge(w);
    const initialTargetCheck = await inspectHardPurgeTarget(db, {
      targetType: "organisation",
      targetId: target.organisation.id,
    });
    expect(initialTargetCheck.status).toBe("eligible");
    const attachment = requireRow(
      await db
        .insert(schema.attachmentTable)
        .values({
          workspaceId: w.member.workspace.id,
          organisationId: target.organisation.id,
          workItemId: target.workItem.id,
          objectKey: `org-purge/${randomUUID()}.bin`,
          filename: "customer.bin",
          mimeType: "application/octet-stream",
          size: 9,
          uploadedBy: w.person.id,
        })
        .returning(),
      "organisation purge attachment",
    );
    const requested = await requestPurge(
      w.app,
      "organisation",
      target.organisation.id,
    );
    expect(requested.status, await requested.clone().text()).toBe(202);
    const body = (await requested.json()) as {
      pendingActionId: string;
      confirmation: string;
      summary: { name: string; impact?: Record<string, number> };
    };
    expect(body.confirmation).toBe("typed_name_step_up");
    expect(body.summary.name).toBe(target.organisation.name);
    expect(body.summary.impact).toEqual({
      organisations: 1,
      projects: 1,
      people: 0,
      workItems: 1,
      comments: 0,
      submissions: 0,
      attachments: 1,
      storageObjectsQueued: 1,
    });
    const [pending] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, body.pendingActionId));
    expect(pending).toMatchObject({
      action: "purge",
      targetType: "organisation",
      targetIds: [target.organisation.id],
      workspaceId: null,
      projectId: null,
      organisationId: target.organisation.id,
      state: "pending",
    });
    expect(pending?.targetVersions).toEqual({
      [target.organisation.id]: JSON.stringify({
        operationId:
          target.deletion.kind === "deleted"
            ? (
                await db.query.organisationDeletionSnapshotTable.findFirst({
                  where: eq(
                    schema.organisationDeletionSnapshotTable.organisationId,
                    target.organisation.id,
                  ),
                })
              )?.operationId
            : undefined,
        generation:
          target.deletion.kind === "deleted"
            ? target.deletion.generation
            : undefined,
      }),
    });
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, target.project.id)),
    ).toHaveLength(1);

    const token = await pendingActionToken(w.app, body.pendingActionId);
    const approved = await approvePurge(
      w.app,
      body.pendingActionId,
      target.organisation.name,
      token,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(
      await db
        .select({ id: schema.organisationTable.id })
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.id, target.organisation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, target.project.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, w.project.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, w.member.workspace.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, w.admin.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.attachmentTable.id })
        .from(schema.attachmentTable)
        .where(eq(schema.attachmentTable.id, attachment.id)),
    ).toHaveLength(0);
    const [queuedObject] = await db
      .execute<{ object_key: string }>(
        sql`SELECT object_key FROM attachment_object_gc WHERE object_key = ${attachment.objectKey}`,
      )
      .then((result) => result.rows);
    expect(queuedObject?.object_key).toBe(attachment.objectKey);
    const remove = vi
      .spyOn(storage, "deleteStorageObject")
      .mockRejectedValueOnce(new Error("temporary storage outage"));
    const { collectQueuedAttachmentObjects } = await import(
      "../../apps/api/src/scheduler/attachment-cleanup"
    );
    const failedCleanup = await collectQueuedAttachmentObjects();
    expect(failedCleanup).toMatchObject({ retained: 1, degraded: true });
    const [retry] = await db
      .execute<{ attempts: number }>(
        sql`SELECT attempts FROM attachment_object_gc WHERE object_key = ${attachment.objectKey}`,
      )
      .then((result) => result.rows);
    expect(retry?.attempts).toBe(1);
    remove.mockResolvedValue(undefined);
    expect(await collectQueuedAttachmentObjects()).toMatchObject({
      deleted: 1,
      degraded: false,
    });

    const tombstones = await db
      .select({
        action: schema.auditLogTable.action,
        organisationId: schema.auditLogTable.organisationId,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, target.organisation.id));
    expect(tombstones.length).toBeGreaterThan(0);
    expect(tombstones.every((row) => row.organisationId === null)).toBe(true);
    expect(await verifyAuditChain(db)).toMatchObject({ ok: true });
  });

  it("retention purges an expired deletion without another approval and respects legal hold", async () => {
    const w = await fixture();
    const target = await prepareOrganisationPurge(w);
    const past = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.organisationTable)
      .set({ deletedAt: past, purgeAfter: past })
      .where(eq(schema.organisationTable.id, target.organisation.id));
    await db
      .update(schema.organisationDeletionSnapshotTable)
      .set({ deletedAt: past, purgeAfter: past })
      .where(
        eq(
          schema.organisationDeletionSnapshotTable.organisationId,
          target.organisation.id,
        ),
      );
    const outcome = await purgeSoftDeletedRows();
    expect(outcome.organisationsPurged ?? 0).toBe(1);
    expect(
      await db
        .select({ id: schema.organisationTable.id })
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.id, target.organisation.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.pendingActionTable.id })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.action, "purge")),
    ).toHaveLength(0);

    const held = await prepareOrganisationPurge(w);
    await db
      .update(schema.organisationTable)
      .set({ deletedAt: past, purgeAfter: past })
      .where(eq(schema.organisationTable.id, held.organisation.id));
    await db
      .update(schema.organisationDeletionSnapshotTable)
      .set({ deletedAt: past, purgeAfter: past })
      .where(
        eq(
          schema.organisationDeletionSnapshotTable.organisationId,
          held.organisation.id,
        ),
      );
    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: held.organisation.id,
      placedBy: w.person.id,
      reason: "retention purge test",
    });
    const heldOutcome = await purgeSoftDeletedRows();
    expect(heldOutcome.organisationsPurged ?? 0).toBe(0);
    expect(heldOutcome.skipped).toBe(1);
    expect(
      await db
        .select({ id: schema.organisationTable.id })
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.id, held.organisation.id)),
    ).toHaveLength(1);
  });

  it("refuses non-admin requests, live targets, and targets under legal hold", async () => {
    const w = await fixture();
    const ordinary = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(ordinary.user);
    const denied = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(denied.status).toBe(403);

    mockAuthenticatedSession(w.admin);
    const live = await w.items.makeItem("Live candidate");
    const liveResponse = await requestPurge(w.app, "work_item", live.id);
    expect(liveResponse.status).toBe(409);
    expect(await liveResponse.text()).toContain("hard_purge_refused");

    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: w.member.workspace.organisationId,
      placedBy: "integration-test",
      reason: "PA-13 test hold",
    });
    const held = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(held.status).toBe(409);
    expect(await held.text()).toContain("hard_purge_refused");
    expect(
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.action, "purge")),
    ).toHaveLength(0);
  });

  it("accepts only an agent browser session, refusing portal, API-key, and impersonated requests", async () => {
    const w = await fixture();

    mockAuthenticatedSession(w.admin, { portal: "customer" });
    const portal = await requestPurge(w.app, "work_item", w.workItem.id);
    expect([401, 403]).toContain(portal.status);

    mockAuthenticatedSession(w.admin);
    const apiKey = await createApiKey(w.admin.id);
    const keyed = await requestPurge(w.app, "work_item", w.workItem.id, {
      ...json,
      "x-api-key": apiKey,
    });
    expect(keyed.status).toBe(403);
    expect(await keyed.text()).toContain("session_required");

    mockAuthenticatedSession(w.admin, { impersonatedBy: "instance-owner" });
    const impersonated = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(impersonated.status).toBe(403);
    expect(await impersonated.text()).toContain("impersonation");
    expect(
      await db
        .select({ id: schema.pendingActionTable.id })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.action, "purge")),
    ).toHaveLength(0);
  });

  it("purges a soft-deleted project only after its exact-name step-up approval", async () => {
    const w = await fixture();
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, w.project.id));

    const requested = await requestPurge(w.app, "project", w.project.id);
    expect(requested.status, await requested.clone().text()).toBe(202);
    const body = (await requested.json()) as {
      pendingActionId: string;
      summary: { name: string };
    };
    expect(body.summary.name).toBe(w.project.name);
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, w.project.id)),
    ).toHaveLength(1);

    const token = await pendingActionToken(w.app, body.pendingActionId);
    const approved = await approvePurge(
      w.app,
      body.pendingActionId,
      w.project.name,
      token,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, w.project.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "hard_purge.executed"),
            eq(schema.auditLogTable.entityId, w.project.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it("keeps the purge pending for a wrong name or missing step-up proof", async () => {
    const w = await fixture();
    const requested = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(requested.status).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    const token = await pendingActionToken(w.app, pendingActionId);

    const wrongName = await approvePurge(
      w.app,
      pendingActionId,
      `${w.workItem.key}-wrong`,
      token,
    );
    expect(wrongName.status).toBe(400);
    expect(await wrongName.text()).toContain("confirmation_mismatch");

    const missingProof = await approvePurge(
      w.app,
      pendingActionId,
      w.workItem.key,
    );
    expect(missingProof.status).toBe(403);
    expect(await missingProof.text()).toContain("step_up_required");
    const [stillPending] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(stillPending?.state).toBe("pending");

    const approved = await approvePurge(
      w.app,
      pendingActionId,
      w.workItem.key,
      token,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
  });

  it("invalidates approval if a legal hold is placed after the request", async () => {
    const w = await fixture();
    const requested = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(requested.status).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: w.member.workspace.organisationId,
      placedBy: "integration-test",
      reason: "PA-13 post-request hold test",
    });
    const token = await pendingActionToken(w.app, pendingActionId);
    const approved = await approvePurge(
      w.app,
      pendingActionId,
      w.workItem.key,
      token,
    );
    expect(approved.status).toBe(409);
    expect(await approved.text()).toContain("pending_action_target_changed");
    expect(
      await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(1);
    const [invalidated] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(invalidated?.state).toBe("invalidated");
  });

  it("invalidates approval if the target leaves the soft-delete retention state", async () => {
    const w = await fixture();
    const requested = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(requested.status).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: null })
      .where(eq(schema.workItemTable.id, w.workItem.id));
    const token = await pendingActionToken(w.app, pendingActionId);
    const approved = await approvePurge(
      w.app,
      pendingActionId,
      w.workItem.key,
      token,
    );
    expect(approved.status).toBe(409);
    expect(await approved.text()).toContain("pending_action_target_changed");
    expect(
      await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(1);
    const [invalidated] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(invalidated?.state).toBe("invalidated");
  });

  it("does not accept an ordinary delete executor or a substituted target", async () => {
    const w = await fixture();
    const requested = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(requested.status).toBe(202);
    const body = (await requested.json()) as { pendingActionId: string };
    const directApproval = approveClickDeletion(
      {
        id: body.pendingActionId,
        requesterPersonId: w.person.id,
        userId: w.admin.id,
        sessionId: `session-${w.admin.id}`,
        traceId: randomUUID(),
      },
      {
        targetType: "work_item",
        routeKey: "POST /api/instance/purge",
        execute: async () => undefined,
      },
    );
    await expect(directApproval).rejects.toThrow(
      "pending_action_kind_unsupported",
    );

    const otherItem = await w.items.makeItem("Substitution candidate");
    await db
      .update(schema.pendingActionTable)
      .set({ targetIds: [otherItem.id] })
      .where(eq(schema.pendingActionTable.id, body.pendingActionId));
    const token = await pendingActionToken(w.app, body.pendingActionId);
    const substituted = await approvePurge(
      w.app,
      body.pendingActionId,
      w.workItem.key,
      token,
    );
    expect(substituted.status).toBe(409);
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, otherItem.id)),
    ).toHaveLength(1);
    const [invalidated] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, body.pendingActionId));
    expect(invalidated?.state).toBe("invalidated");
  });

  it("rolls back the purge when its complete audit record cannot be written", async () => {
    const w = await fixture();
    const requested = await requestPurge(w.app, "work_item", w.workItem.id);
    expect(requested.status).toBe(202);
    const { pendingActionId } = (await requested.json()) as {
      pendingActionId: string;
    };
    const token = await pendingActionToken(w.app, pendingActionId);
    await armHardPurgeAuditFailure();

    const approved = await approvePurge(
      w.app,
      pendingActionId,
      w.workItem.key,
      token,
    );
    expect(approved.status).toBe(500);
    expect(await approved.text()).toContain("pending_action_failed");
    expect(
      await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, w.workItem.id)),
    ).toHaveLength(1);
    const [failed] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pendingActionId));
    expect(failed?.state).toBe("failed");
    expect(
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "hard_purge.executed"),
            eq(schema.auditLogTable.entityId, w.workItem.id),
          ),
        ),
    ).toHaveLength(0);
  });
});
