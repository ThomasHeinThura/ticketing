/**
 * P2 review fix lane A (workflow / transition / audit): P2R1-01, -03, -06, -07, -09, -10, -14,
 * -15, -16, -17 and the plausible P3/P4 items. Runs under `vitest.integration.config.ts` against
 * a dedicated `_test` PostgreSQL database (docs/testing.md).
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { scanApprovalReminders } from "../../apps/api/src/approval/reminder-scan";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import {
  approvalTable,
  auditLogTable,
  commentTable,
  notificationTable,
  outboxTable,
  slaEscalationTable,
  workItemSlaCacheTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { runScheduledTransitions } from "../../apps/api/src/scheduler/scheduled-transition";
import { scanWorkItemSla } from "../../apps/api/src/scheduler/sla-scan";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { projectWebhookEnvelope } from "../../apps/api/src/webhook/envelope";
import { executeSystemTransition } from "../../apps/api/src/work-item/controllers/transition-work-item";
import { withCreationTransaction } from "../../apps/api/src/work-item/create-preparation";
import { commentBodyText } from "../../apps/api/src/work-item/transition-note-document";
import {
  buildTenant,
  createApproval,
  decide,
  type Tenant,
  withdrawAs,
} from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { slaFixture } from "./helpers/sla-fixture";

const jsonHeaders = { "content-type": "application/json" };

function nth<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`fixture entry ${index} missing`);
  return value;
}

async function makeWorkItemType(
  workspaceId: string,
  workflowId: string | null,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Ticket",
        category: "service",
        workflowId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "type",
  );
}

async function makeState(
  workspaceId: string,
  projectId: string,
  options: { group: string; isDefault?: boolean },
) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: options.group,
        group: options.group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: options.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "state",
  );
  return { stateTemplate, state };
}

async function makeWorkflow(
  workspaceId: string,
  transitions: (Partial<typeof schema.workflowTransitionTable.$inferInsert> & {
    fromStateTemplateId: string | null;
    toStateTemplateId: string;
  })[],
) {
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({
        workspaceId,
        key: `wf-${randomUUID()}`,
        name: "Ticket workflow",
      })
      .returning(),
    "workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "version",
  );
  const inserted = await db
    .insert(schema.workflowTransitionTable)
    .values(
      transitions.map((t) => ({
        versionId: version.id,
        guards: [],
        effects: [],
        roleId: null,
        ...t,
      })),
    )
    .returning();
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  return { workflow, version, transitions: inserted };
}

async function setupProject() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  // The AU-14 notifier addresses instance administrators.
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, creator.id));
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantWorkItemProjectAccess(creator.id, project.id);
  return { creator, workspace, project };
}

async function createWorkItem(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  typeId: string,
) {
  const created = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ typeId, title: "Transition me" }),
  });
  expect(created.status, await created.clone().text()).toBeLessThan(300);
  return (await created.json()) as { key: string; id?: string };
}

function transitionRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(`/api/work-items/${key}/transition`, {
    method: "POST",
    headers: { ...jsonHeaders, ...headers },
    body: JSON.stringify(body),
  });
}

function hashApiKeyForTest(key: string) {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApiKeyFor(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "p2 lane a test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: JSON.stringify(permissions),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

async function itemByKey(key: string) {
  return requireRow(
    await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key))
      .limit(1),
    "work item",
  );
}

/** A two-state world: backlog -> `edges` target states, one work item in backlog. */
async function noteWorld(
  edges: Partial<typeof schema.workflowTransitionTable.$inferInsert>[],
  targetGroups: string[] = ["started"],
) {
  const { creator, workspace, project } = await setupProject();
  const backlog = await makeState(workspace.id, project.id, {
    group: "backlog",
    isDefault: true,
  });
  const targets = [] as Awaited<ReturnType<typeof makeState>>[];
  for (const group of targetGroups)
    targets.push(await makeState(workspace.id, project.id, { group }));
  const { workflow, transitions } = await makeWorkflow(
    workspace.id,
    edges.map((edge, index) => ({
      fromStateTemplateId: backlog.stateTemplate.id,
      toStateTemplateId: (targets[index] ?? nth(targets, 0)).stateTemplate.id,
      ...edge,
    })),
  );
  const type = await makeWorkItemType(workspace.id, workflow.id);
  mockAuthenticatedSession(creator);
  const { app } = createApp();
  const { key } = await createWorkItem(app, project.id, type.id);
  const item = await itemByKey(key);
  return {
    creator,
    workspace,
    project,
    backlog,
    targets,
    transitions,
    workflow,
    type,
    app,
    key,
    item,
  };
}

const FAIL_FUNCTION = "td_p2a_audit_probe_fail";

async function armAuditInsertFailure() {
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION ${FAIL_FUNCTION}() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'p2a probe: injected audit insert failure';
    END;
    $$ LANGUAGE plpgsql;
  `),
  );
  await db.execute(
    sql.raw(`
    CREATE TRIGGER ${FAIL_FUNCTION}
    BEFORE INSERT ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION ${FAIL_FUNCTION}();
  `),
  );
}

async function disarmAuditInsertFailure() {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${FAIL_FUNCTION} ON "audit_log"`),
  );
  await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${FAIL_FUNCTION}()`));
}

async function auditFailureNotifications(userId: string) {
  return db
    .select({ id: notificationTable.id })
    .from(notificationTable)
    .where(
      and(
        eq(notificationTable.userId, userId),
        eq(notificationTable.type, "audit_write_failed"),
      ),
    );
}

describe("P2R1-01/06/07: a transition note is a comment", () => {
  beforeEach(async () => {
    await disarmAuditInsertFailure();
    await resetTestDatabase();
  });

  it("stores the note in the comment document shape, linked to the transitioned activity", async () => {
    const w = await noteWorld([
      { noteVisibility: "public", notePolicy: "optional" },
    ]);
    const response = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
      note: "Fixed in build 42\nPlease retest",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [comment] = await db
      .select()
      .from(commentTable)
      .where(eq(commentTable.workItemId, w.item.id));
    expect(comment?.visibility).toBe("public");
    expect(comment?.activityId).not.toBeNull();
    expect(comment?.body).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Fixed in build 42" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Please retest" }],
        },
      ],
    });
  });

  it("refuses the whole transition when an API key lacks the comment capability for the note", async () => {
    const w = await noteWorld(
      [
        { noteVisibility: "internal", notePolicy: "optional" },
        { noteVisibility: "public", notePolicy: "optional" },
      ],
      ["started", "started"],
    );
    const transitionOnly = await createApiKeyFor(w.creator.id, {
      project: ["read"],
      work_item: ["read", "transition"],
    });
    const denied = await transitionRequest(
      w.app,
      w.key,
      {
        toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
        note: "internal note",
      },
      { "x-api-key": transitionOnly },
    );
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("Insufficient API key scope");
    // Nothing was applied: same state, no comment, no transitioned activity.
    expect((await itemByKey(w.key)).stateId).toBe(w.backlog.state.id);
    expect(
      await db
        .select()
        .from(commentTable)
        .where(eq(commentTable.workItemId, w.item.id)),
    ).toHaveLength(0);

    // A key holding only comment:create may write the PUBLIC note, never the internal one.
    const publicOnly = await createApiKeyFor(w.creator.id, {
      project: ["read"],
      work_item: ["read", "transition"],
      comment: ["create"],
    });
    const internalDenied = await transitionRequest(
      w.app,
      w.key,
      {
        toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
        note: "internal note",
      },
      { "x-api-key": publicOnly },
    );
    expect(internalDenied.status).toBe(403);
    expect((await itemByKey(w.key)).stateId).toBe(w.backlog.state.id);
    const publicAllowed = await transitionRequest(
      w.app,
      w.key,
      {
        toStateTemplateId: nth(w.targets, 1).stateTemplate.id,
        note: "public note",
      },
      { "x-api-key": publicOnly },
    );
    expect(publicAllowed.status, await publicAllowed.clone().text()).toBe(200);
    const comments = await db
      .select()
      .from(commentTable)
      .where(eq(commentTable.workItemId, w.item.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]?.visibility).toBe("public");
  });

  it("SLA-7: a public note by staff sets first_response_at, an internal note or the requester's own does not", async () => {
    const pub = await noteWorld([
      { noteVisibility: "public", notePolicy: "optional" },
    ]);
    expect(pub.item.firstResponseAt).toBeNull();
    const response = await transitionRequest(pub.app, pub.key, {
      toStateTemplateId: nth(pub.targets, 0).stateTemplate.id,
      note: "We are on it",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await itemByKey(pub.key);
    expect(after.firstResponseAt).not.toBeNull();
    const [comment] = await db
      .select()
      .from(commentTable)
      .where(eq(commentTable.workItemId, pub.item.id));
    expect(after.firstResponseAt?.getTime()).toBe(comment?.createdAt.getTime());

    await resetTestDatabase();
    const internal = await noteWorld([
      { noteVisibility: "internal", notePolicy: "optional" },
    ]);
    const internalResponse = await transitionRequest(
      internal.app,
      internal.key,
      {
        toStateTemplateId: nth(internal.targets, 0).stateTemplate.id,
        note: "private thought",
      },
    );
    expect(internalResponse.status).toBe(200);
    expect((await itemByKey(internal.key)).firstResponseAt).toBeNull();

    await resetTestDatabase();
    const own = await noteWorld([
      { noteVisibility: "public", notePolicy: "optional" },
    ]);
    const person = requireRow(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, own.creator.id))
        .limit(1),
      "creator person",
    );
    await db
      .update(schema.workItemTable)
      .set({ requesterId: person.id })
      .where(eq(schema.workItemTable.id, own.item.id));
    mockAuthenticatedSession(own.creator);
    const ownResponse = await transitionRequest(own.app, own.key, {
      toStateTemplateId: nth(own.targets, 0).stateTemplate.id,
      note: "I am the requester",
    });
    expect(ownResponse.status).toBe(200);
    expect((await itemByKey(own.key)).firstResponseAt).toBeNull();
  });

  it("a resolving public note counts as the first response before the SLA settles", async () => {
    const w = await noteWorld(
      [{ noteVisibility: "public", notePolicy: "required" }],
      ["completed"],
    );
    const response = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
      note: "Resolved",
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await itemByKey(w.key);
    expect(after.firstResponseAt).not.toBeNull();
    expect(after.resolvedAt).not.toBeNull();
  });
});

describe("P2R1-07: comment body text read-side fallback", () => {
  it("reads both the document shape and a legacy bare-string body", () => {
    expect(commentBodyText("legacy note\nline two")).toBe(
      "legacy note\nline two",
    );
    expect(
      commentBodyText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Fixed" }] },
          { type: "paragraph" },
          { type: "paragraph", content: [{ type: "text", text: "Retest" }] },
        ],
      }),
    ).toBe("Fixed\nRetest");
    expect(commentBodyText(null)).toBe("");
  });
});

describe("P2R1-17: transition notes never reach an external webhook unless public", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const envelope = (payload: Record<string, unknown>) => ({
    id: "evt_1",
    kind: "work_item.transitioned",
    occurredAt: "2026-10-27T00:00:00.000Z",
    actor: { type: "person", id: "p1", name: "Agent" },
    scope: {},
    payload: { key: "HELP-1", url: "/agent/work-items/HELP-1", ...payload },
  });
  const context = { instance: "https://td.example" };

  it("drops the note unless noteVisibility is public (an old payload fails closed)", () => {
    const body = (result: ReturnType<typeof projectWebhookEnvelope>) =>
      result.kind === "deliver" ? JSON.stringify(result.body) : "";
    expect(
      body(
        projectWebhookEnvelope(
          envelope({ note: "secret", noteVisibility: "internal" }),
          context,
        ),
      ),
    ).not.toContain("secret");
    expect(
      body(projectWebhookEnvelope(envelope({ note: "secret" }), context)),
    ).not.toContain("secret");
    expect(
      body(
        projectWebhookEnvelope(
          envelope({ note: "hello", noteVisibility: "public" }),
          context,
        ),
      ),
    ).toContain("hello");
  });

  it("the transition event itself carries the note only when the edge's note is public", async () => {
    const w = await noteWorld(
      [
        { noteVisibility: "internal", notePolicy: "optional" },
        { noteVisibility: "public", notePolicy: "optional" },
      ],
      ["started", "started"],
    );
    const internal = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
      note: "internal secret",
    });
    expect(internal.status, await internal.clone().text()).toBe(200);
    // Back to backlog is not offered; use a second item for the public edge.
    const second = await createWorkItem(w.app, w.project.id, w.type.id);
    const publicResponse = await transitionRequest(w.app, second.key, {
      toStateTemplateId: nth(w.targets, 1).stateTemplate.id,
      note: "public hello",
    });
    expect(publicResponse.status, await publicResponse.clone().text()).toBe(
      200,
    );
    const rows = await db
      .select()
      .from(outboxTable)
      .where(eq(outboxTable.kind, "work_item.transitioned"));
    const serialised = rows.map((row) => JSON.stringify(row.payload));
    expect(serialised.join("\n")).not.toContain("internal secret");
    expect(serialised.join("\n")).toContain("public hello");
  });
});

describe("P2R1-03/16: audit appends are AU-14 savepoints with request context", () => {
  beforeEach(async () => {
    await disarmAuditInsertFailure();
    await resetTestDatabase();
  });

  it("records ip-agnostic request context, the user agent, the request id and the API key on the transition audit row", async () => {
    const w = await noteWorld([{}]);
    const key = await createApiKeyFor(w.creator.id, {
      project: ["read"],
      work_item: ["read", "transition"],
    });
    const response = await transitionRequest(
      w.app,
      w.key,
      { toStateTemplateId: nth(w.targets, 0).stateTemplate.id },
      { "x-api-key": key, "user-agent": "p2-lane-a-agent/1.0" },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const [row] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "work_item.transitioned"))
      .orderBy(desc(auditLogTable.seq))
      .limit(1);
    expect(row?.userAgent).toBe("p2-lane-a-agent/1.0");
    expect(row?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(row?.apiKeyId).not.toBeNull();
    expect(row?.actorType).toBe("api_key");
  });

  it("commits the transition when the audit insert fails, and notifies administrators", async () => {
    const w = await noteWorld([
      { noteVisibility: "public", notePolicy: "optional" },
    ]);
    await armAuditInsertFailure();
    const response = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
      note: "still committed",
    });
    await disarmAuditInsertFailure();
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await itemByKey(w.key)).stateId).toBe(nth(w.targets, 0).state.id);
    expect(
      await db
        .select()
        .from(commentTable)
        .where(eq(commentTable.workItemId, w.item.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditLogTable)
        .where(eq(auditLogTable.action, "work_item.transitioned")),
    ).toHaveLength(0);
    expect(
      (await auditFailureNotifications(w.creator.id)).length,
    ).toBeGreaterThan(0);
  });

  it("commits a comment when the audit insert fails, and notifies administrators", async () => {
    const w = await noteWorld([{}]);
    await armAuditInsertFailure();
    const response = await w.app.request(`/api/work-items/${w.key}/comments`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        body: { type: "doc", content: [] },
        visibility: "internal",
      }),
    });
    await disarmAuditInsertFailure();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      await db
        .select()
        .from(commentTable)
        .where(eq(commentTable.workItemId, w.item.id)),
    ).toHaveLength(1);
    expect(
      (await auditFailureNotifications(w.creator.id)).length,
    ).toBeGreaterThan(0);
  });

  async function adminRequester(t: Tenant) {
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, t.requester.user.id));
  }

  it("approval request, decision and withdrawal commit when the audit insert fails", async () => {
    const t = await buildTenant("p2a-approval-audit");
    await adminRequester(t);
    await armAuditInsertFailure();
    try {
      const created = await createApproval(t);
      const rows = await db
        .select()
        .from(approvalTable)
        .where(eq(approvalTable.id, created.id));
      expect(rows[0]?.state).toBe("pending");

      const decided = await decide(t, t.approver, created.id, {
        action: "approve",
        note: "ok",
      });
      expect(decided.status, await decided.clone().text()).toBe(200);
      const [afterDecision] = await db
        .select()
        .from(approvalTable)
        .where(eq(approvalTable.id, created.id));
      expect(afterDecision?.state).toBe("approved");

      const second = await createApproval(t);
      const withdrawn = await withdrawAs(t, t.requester, second.id);
      expect(withdrawn.status, await withdrawn.clone().text()).toBe(200);
      const [afterWithdraw] = await db
        .select()
        .from(approvalTable)
        .where(eq(approvalTable.id, second.id));
      expect(afterWithdraw?.state).toBe("withdrawn");
    } finally {
      await disarmAuditInsertFailure();
    }
    expect(
      await db
        .select()
        .from(auditLogTable)
        .where(eq(auditLogTable.entityType, "approval")),
    ).toHaveLength(0);
    expect(
      (await auditFailureNotifications(t.requester.user.id)).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("an approval audit row records the user agent and request id", async () => {
    const t = await buildTenant("p2a-approval-ctx");
    mockAuthenticatedSession(t.requester.user);
    const response = await t.app.request(t.url, {
      method: "POST",
      headers: { ...jsonHeaders, "user-agent": "p2-lane-a-approval/1.0" },
      body: JSON.stringify({
        transitionId: t.gated.id,
        kind: "cab",
        approverId: t.approverPerson.id,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [row] = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.action, "approval.requested"))
      .limit(1);
    expect(row?.userAgent).toBe("p2-lane-a-approval/1.0");
    expect(row?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("the reminder scan expires every overdue approval despite audit failures, notifying once per run", async () => {
    const t = await buildTenant("p2a-scan-audit");
    await adminRequester(t);
    const first = await createApproval(t);
    const second = await createApproval(t);
    const now = Date.now();
    for (const approval of [first, second]) {
      await db
        .update(approvalTable)
        .set({
          createdAt: new Date(now - 3_600_000),
          expiresAt: new Date(now - 1000),
        })
        .where(eq(approvalTable.id, approval.id));
    }
    await armAuditInsertFailure();
    let outcome: Awaited<ReturnType<typeof scanApprovalReminders>>;
    try {
      outcome = await scanApprovalReminders();
    } finally {
      await disarmAuditInsertFailure();
    }
    expect(outcome.expired).toBe(2);
    const states = await db
      .select({ state: approvalTable.state })
      .from(approvalTable);
    expect(states.every((row) => row.state === "expired")).toBe(true);
    expect(await auditFailureNotifications(t.requester.user.id)).toHaveLength(
      1,
    );
  });
});

describe("P2R1-09: edge selection", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a person holding an ungated edge beside a gated one for the same pair can use the ungated edge", async () => {
    const w = await noteWorld([
      { requiresApproval: true, approvalPolicy: "any" },
      { requiresApproval: false },
    ]);
    // Both edges lead to the first target: build the second edge on the same pair.
    const [gated, ungated] = w.transitions;
    if (!gated || !ungated) throw new Error("fixture row missing");
    await db
      .update(schema.workflowTransitionTable)
      .set({ toStateTemplateId: nth(w.targets, 0).stateTemplate.id })
      .where(eq(schema.workflowTransitionTable.id, ungated.id));
    const response = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [activity] = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, w.item.id),
          eq(schema.activityTable.verb, "transitioned"),
        ),
      );
    expect(
      (activity?.payload as { transitionId?: string } | undefined)
        ?.transitionId,
    ).toBe(ungated.id);
    expect(gated.id).not.toBe(ungated.id);
  });

  it("two gated edges for the pair still block a person with the approval reason", async () => {
    const w = await noteWorld([
      { requiresApproval: true, approvalPolicy: "any" },
      { requiresApproval: true, approvalPolicy: "all" },
    ]);
    await db
      .update(schema.workflowTransitionTable)
      .set({ toStateTemplateId: nth(w.targets, 0).stateTemplate.id })
      .where(eq(schema.workflowTransitionTable.id, nth(w.transitions, 1).id));
    const response = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { blockedBy: { kind: string }[] };
    expect(body.blockedBy.map((reason) => reason.kind)).toContain("approval");
    expect((await itemByKey(w.key)).stateId).toBe(w.backlog.state.id);
  });

  it("a scheduled (system) hop still applies the most restrictive edge: a gate refuses it", async () => {
    const w = await noteWorld([
      { requiresApproval: true, approvalPolicy: "any" },
      { requiresApproval: false },
    ]);
    await db
      .update(schema.workflowTransitionTable)
      .set({ toStateTemplateId: nth(w.targets, 0).stateTemplate.id })
      .where(eq(schema.workflowTransitionTable.id, nth(w.transitions, 1).id));
    const outcome = await executeSystemTransition({
      kind: "scheduled",
      workItemId: w.item.id,
      fromStateId: w.backlog.state.id,
      toStateId: nth(w.targets, 0).state.id,
      claim: async () => true,
    });
    expect(outcome.kind).toBe("blocked");
    expect((await itemByKey(w.key)).stateId).toBe(w.backlog.state.id);
  });
});

describe("P2R1-14: unknown stored effect kinds are refused, never dropped", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it.each(["explode", "resolve_sla"])(
    "refuses a stored %s effect with 422 and applies nothing",
    async (kind) => {
      const w = await noteWorld([{ effects: [{ kind }] as never }]);
      const response = await transitionRequest(w.app, w.key, {
        toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
      });
      expect(response.status, await response.clone().text()).toBe(422);
      const body = (await response.json()) as {
        blockedBy: { kind: string; reasonCode: string }[];
      };
      expect(body.blockedBy).toEqual([
        { kind: "effect", reasonCode: "effect.unsupported_kind" },
      ]);
      expect((await itemByKey(w.key)).stateId).toBe(w.backlog.state.id);
    },
  );

  it("a sibling edge for the pair without the bad effect stays usable by a person", async () => {
    const w = await noteWorld([
      { effects: [{ kind: "explode" }] as never },
      { effects: [] },
    ]);
    await db
      .update(schema.workflowTransitionTable)
      .set({ toStateTemplateId: nth(w.targets, 0).stateTemplate.id })
      .where(eq(schema.workflowTransitionTable.id, nth(w.transitions, 1).id));
    const response = await transitionRequest(w.app, w.key, {
      toStateTemplateId: nth(w.targets, 0).stateTemplate.id,
    });
    expect(response.status, await response.clone().text()).toBe(200);
  });
});

describe("P2R1-10: a deadlock during a scheduled hop keeps the row pending", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("retains the pending row instead of cancelling it as left_state", async () => {
    const w = await noteWorld([{}]);
    const [row] = await db
      .insert(schema.scheduledTransitionTable)
      .values({
        projectId: w.project.id,
        workItemId: w.item.id,
        transitionId: nth(w.transitions, 0).id,
        fromStateId: w.backlog.state.id,
        toStateId: nth(w.targets, 0).state.id,
        dueAt: new Date(Date.now() - 60_000),
        state: "pending",
      })
      .returning();
    if (!row) throw new Error("fixture row missing");
    const outcome = await runScheduledTransitions((request) =>
      executeSystemTransition(
        request.kind === "scheduled"
          ? {
              ...request,
              claim: async () => {
                throw new Error("deadlock detected", {
                  cause: Object.assign(new Error("deadlock detected"), {
                    code: "40P01",
                  }),
                });
              },
            }
          : request,
      ),
    );
    expect(outcome.retained).toBe(1);
    expect(outcome.cancelled).toBe(0);
    const [after] = await db
      .select()
      .from(schema.scheduledTransitionTable)
      .where(eq(schema.scheduledTransitionTable.id, row.id));
    expect(after?.state).toBe("pending");
    expect((await itemByKey(w.key)).stateId).toBe(w.backlog.state.id);

    // The next tick, with no deadlock, fires it.
    const next = await runScheduledTransitions();
    expect(next.fired).toBe(1);
  });
});

describe("P2R1-15: publishing a published version is idempotent", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  function call(method: string, path: string, body?: unknown) {
    const { app } = createApp();
    return app.request(path, {
      method,
      headers: jsonHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("never overwrites published_at/by and never silently re-activates an older version", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const [a, b] = await db
      .insert(schema.stateTemplateTable)
      .values([
        {
          workspaceId: owner.workspace.id,
          key: "a",
          name: "A",
          group: "backlog",
        },
        {
          workspaceId: owner.workspace.id,
          key: "b",
          name: "B",
          group: "started",
        },
      ])
      .returning();
    if (!a || !b) throw new Error("fixture row missing");
    const edge = {
      fromStateTemplateId: a.id,
      toStateTemplateId: b.id,
      notePolicy: "none",
      noteVisibility: "internal",
    };
    const created = await call("POST", "/api/workflows", {
      workspaceId: owner.workspace.id,
      key: "flow",
      name: "Flow",
    });
    const workflow = (await created.json()) as { id: string };
    await call("POST", `/api/workflows/${workflow.id}/versions`, {
      transitions: [edge],
    });
    await call("POST", `/api/workflows/${workflow.id}/versions`, {
      transitions: [edge],
    });

    const first = await call(
      "POST",
      `/api/workflows/${workflow.id}/versions/1/publish`,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const stamped = (await first.json()) as { id: string; publishedAt: string };
    const second = await call(
      "POST",
      `/api/workflows/${workflow.id}/versions/2/publish`,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };

    // Re-publish version 1 (already published) while version 2 is active.
    const again = await call(
      "POST",
      `/api/workflows/${workflow.id}/versions/1/publish`,
    );
    expect(again.status, await again.clone().text()).toBe(200);
    const againBody = (await again.json()) as { publishedAt: string };
    expect(againBody.publishedAt).toBe(stamped.publishedAt);
    const [version1] = await db
      .select()
      .from(schema.workflowVersionTable)
      .where(eq(schema.workflowVersionTable.id, stamped.id));
    expect(version1?.publishedAt?.toISOString()).toBe(stamped.publishedAt);
    const [row] = await db
      .select({ activeVersionId: schema.workflowTable.activeVersionId })
      .from(schema.workflowTable)
      .where(eq(schema.workflowTable.id, workflow.id));
    expect(row?.activeVersionId).toBe(secondBody.id);
  });
});

describe("P2R1-P3: audit append inside a SERIALIZABLE creation retries on a stale chain head", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("retries the whole transaction when prev_hash collides with a concurrently committed row", async () => {
    await ensureInternalOrganisation();
    let attempts = 0;
    const result = await withCreationTransaction(async (tx) => {
      attempts += 1;
      // The snapshot is fixed by the first statement.
      await tx.execute(sql`SELECT 1`);
      if (attempts === 1) {
        // Another request commits an audit row after this transaction's snapshot.
        await appendAuditLog(db, {
          actorId: null,
          actorType: "system",
          action: "work_item.created",
          entityType: "work_item",
          entityId: `concurrent-${randomUUID()}`,
        });
      }
      await appendAuditLog(tx, {
        actorId: null,
        actorType: "system",
        action: "work_item.created",
        entityType: "work_item",
        entityId: `creation-${randomUUID()}`,
      });
      return "created";
    });
    expect(result).toBe("created");
    expect(attempts).toBe(2);
  });
});

/** A breached item whose project has two escalation stakeholders, so a walk stays active. */
async function escalationFixture() {
  const f = await slaFixture(130);
  for (const order of [1, 2]) {
    const staff = await createWorkspaceMember({ role: "member" });
    await grantWorkItemProjectAccess(staff.user.id, f.project.id);
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, staff.user.id))
        .limit(1),
      "stakeholder person",
    );
    await db.insert(schema.stakeholderTable).values({
      projectId: f.project.id,
      personId: person.id,
      role: "escalation",
      escalationOrder: order,
      escalationWaitMinutes: 30,
    });
  }
  return f;
}

describe("P2R1-P4: one active escalation walk per item and metric", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("supersedes the earlier walk when a metric flaps breached -> at_risk -> breached", async () => {
    const f = await escalationFixture();
    await scanWorkItemSla(f.item.id);
    // The metric recovers (a due date moved) and then breaches again within the interval.
    await db
      .update(workItemSlaCacheTable)
      .set({ state: "at_risk" })
      .where(eq(workItemSlaCacheTable.workItemId, f.item.id));
    await scanWorkItemSla(f.item.id);

    const walks = await db
      .select()
      .from(slaEscalationTable)
      .where(
        and(
          eq(slaEscalationTable.workItemId, f.item.id),
          eq(slaEscalationTable.metric, "resolution"),
        ),
      );
    expect(walks).toHaveLength(2);
    expect(walks.filter((walk) => walk.state === "active")).toHaveLength(1);
    expect(
      walks.filter((walk) => walk.stopReason === "superseded"),
    ).toHaveLength(1);
  });

  it("a redelivered breach event never stops its own walk", async () => {
    const f = await escalationFixture();
    await scanWorkItemSla(f.item.id);
    const [walk] = await db
      .select()
      .from(slaEscalationTable)
      .where(
        and(
          eq(slaEscalationTable.workItemId, f.item.id),
          eq(slaEscalationTable.metric, "resolution"),
        ),
      );
    if (!walk) throw new Error("fixture row missing");
    expect(walk?.state).toBe("active");
    // Redeliver the SAME breach (same trigger event id): the supersede must skip its own walk
    // and the idempotent insert adds nothing, so exactly one walk stays active.
    const { insertEscalationWalk, supersedeActiveEscalationWalks } =
      await import("../../apps/api/src/scheduler/sla-escalation.repository");
    await db.transaction(async (tx) => {
      await supersedeActiveEscalationWalks(
        tx,
        f.item.id,
        walk.metric,
        walk.triggerEventId,
      );
      await insertEscalationWalk(tx, {
        workspaceId: walk.workspaceId,
        projectId: walk.projectId,
        workItemId: f.item.id,
        metric: walk.metric,
        triggerEventId: walk.triggerEventId,
        stateIdAtStart: walk.stateIdAtStart,
        assigneeIdAtStart: walk.assigneeIdAtStart,
        lastOrder: walk.lastOrder,
        nextDueAt: new Date(Date.now() + 30 * 60_000),
        startedAt: new Date(),
      });
    });
    const walks = await db
      .select()
      .from(slaEscalationTable)
      .where(
        and(
          eq(slaEscalationTable.workItemId, f.item.id),
          eq(slaEscalationTable.metric, "resolution"),
        ),
      );
    expect(walks).toHaveLength(1);
    expect(walks[0]?.state).toBe("active");
  });
});
