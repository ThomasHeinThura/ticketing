import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { decideOwnPendingAction } from "../../apps/api/src/pending-action/service";
import { expirePendingActions } from "../../apps/api/src/scheduler/pending-action-expire";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

process.env.PGOPTIONS = "-c timezone=Asia/Yangon";

beforeEach(async () => {
  await resetTestDatabase();
});

afterAll(() => {
  Reflect.deleteProperty(process.env, "PGOPTIONS");
});

async function makeRequester() {
  const { user, workspace } = await createWorkspaceMember();
  await ensureStaffPersonForUser(user.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id))
      .limit(1),
    "pending-action requester",
  );
  if (person.organisationId !== workspace.organisationId || !person.active) {
    throw new Error(
      "pending-action requester fixture requires active internal staff identity",
    );
  }
  return { person, workspace };
}

function pendingActionValues(
  expiresAt: Date,
  personId: string,
  workspace: Awaited<ReturnType<typeof makeRequester>>["workspace"],
  scopeWorkspaceId: string | null = workspace.id,
) {
  return {
    id: `pa-${randomUUID()}`,
    requestedByPersonId: personId,
    credentialType: "session" as const,
    credentialId: `session-${randomUUID()}`,
    origin: "web" as const,
    action: "delete" as const,
    targetType: "work_item",
    targetIds: [`WI-${randomUUID()}`],
    targetVersions: null,
    payload: { action: "delete" },
    routeKey: "DELETE /api/work-items/{key}",
    payloadHash: "a".repeat(64),
    payloadSummary: { key: "redacted" },
    workspaceId: scopeWorkspaceId,
    projectId: null,
    organisationId: workspace.organisationId,
    confirmationRequired: "click" as const,
    state: "pending" as const,
    expiresAt,
    traceId: `trace-${randomUUID()}`,
  };
}

async function insertPendingAction(
  expiresAt: Date,
  personId: string,
  workspace: Awaited<ReturnType<typeof makeRequester>>["workspace"],
  scopeWorkspaceId?: string | null,
) {
  const row = requireRow(
    await db
      .insert(schema.pendingActionTable)
      .values(
        pendingActionValues(expiresAt, personId, workspace, scopeWorkspaceId),
      )
      .returning(),
    "pending action",
  );
  return row;
}

async function makePendingAction(expiresAt: Date) {
  const requester = await makeRequester();
  const row = await insertPendingAction(
    expiresAt,
    requester.person.id,
    requester.workspace,
  );
  return { row, ...requester };
}

async function decisions(id: string) {
  return db
    .select()
    .from(schema.outboxTable)
    .where(
      and(
        eq(schema.outboxTable.kind, "pending_action.decided"),
        sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${id}`,
      ),
    );
}

async function decisionAudits(id: string) {
  return db
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "pending_action.decided"),
        eq(schema.auditLogTable.entityId, id),
      ),
    );
}

async function waitForBlockedBy(blockerPid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await db.execute<{ waiting: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND ${blockerPid} = ANY(pg_blocking_pids(pid))
      ) AS waiting
    `);
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No PostgreSQL session blocked by pid ${blockerPid}`);
}

describe("PA-8 pending-action expiry", () => {
  it("expires due and just-due rows, leaves future and terminal rows unchanged, and is repeat-safe", async () => {
    const due = await makePendingAction(new Date(Date.now() - 60_000));
    const boundary = await makePendingAction(new Date());
    const future = await makePendingAction(new Date(Date.now() + 60 * 60_000));
    const terminal = await makePendingAction(new Date(Date.now() - 60_000));
    await db
      .update(schema.pendingActionTable)
      .set({ state: "denied", decidedAt: new Date() })
      .where(eq(schema.pendingActionTable.id, terminal.row.id));

    const timezone = await db.execute<{ timezone: string }>(
      sql`SELECT current_setting('TimeZone') AS timezone`,
    );
    expect(timezone.rows[0]?.timezone).toBe("Asia/Yangon");

    const first = await expirePendingActions();
    const repeat = await expirePendingActions();
    expect(first.expired).toBe(2);
    expect(repeat.expired).toBe(0);

    const rows = await db
      .select({
        id: schema.pendingActionTable.id,
        state: schema.pendingActionTable.state,
      })
      .from(schema.pendingActionTable);
    expect(rows.find((row) => row.id === due.row.id)?.state).toBe("expired");
    expect(rows.find((row) => row.id === boundary.row.id)?.state).toBe(
      "expired",
    );
    expect(rows.find((row) => row.id === future.row.id)?.state).toBe("pending");
    expect(rows.find((row) => row.id === terminal.row.id)?.state).toBe(
      "denied",
    );
    expect(await decisions(due.row.id)).toHaveLength(1);
    expect(await decisions(boundary.row.id)).toHaveLength(1);
    expect(await decisions(future.row.id)).toHaveLength(0);

    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "pending_action.decided"),
          eq(schema.auditLogTable.entityId, due.row.id),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe("system");
    expect(audits[0]?.actorId).toBeNull();
  });

  it("commits state and event when the nested AU-14 audit append fails", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    const secondAction = await insertPendingAction(
      new Date(Date.now() - 60_000),
      action.person.id,
      action.workspace,
    );
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: `expiry-admin-${randomUUID()}`,
        name: "Expiry Admin",
        email: `expiry-admin-${randomUUID()}@example.test`,
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("expiry admin was not created");
    await ensureStaffPersonForUser(admin.id);
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION fail_pending_action_expiry_audit_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'pending_action.decided' THEN
          RAISE EXCEPTION 'test expiry audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_pending_action_expiry_audit_insert
      BEFORE INSERT ON audit_log FOR EACH ROW
      EXECUTE FUNCTION fail_pending_action_expiry_audit_insert();
    `),
    );
    try {
      const result = await expirePendingActions();
      expect(result).toMatchObject({ expired: 2, degraded: true });
      const [row] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, action.row.id));
      expect(row?.state).toBe("expired");
      expect(await decisions(action.row.id)).toHaveLength(1);
      expect(await decisions(secondAction.id)).toHaveLength(1);
      const alerts = await db
        .select({ eventData: schema.notificationTable.eventData })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "audit_write_failed"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.eventData).toMatchObject({
        operation: "pending_action_decision",
      });
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_expiry_audit_insert ON audit_log",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_pending_action_expiry_audit_insert()",
        ),
      );
    }
  });

  it("rolls back expiry state when its outbox insert fails", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION fail_pending_action_expiry_outbox_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = 'pending_action.decided' THEN
          RAISE EXCEPTION 'test expiry outbox failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_pending_action_expiry_outbox_insert
      BEFORE INSERT ON outbox FOR EACH ROW
      EXECUTE FUNCTION fail_pending_action_expiry_outbox_insert();
    `),
    );
    try {
      await expect(expirePendingActions()).rejects.toThrow(
        /Failed query: insert into "outbox"/,
      );
      const [row] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, action.row.id));
      expect(row?.state).toBe("pending");
      expect(await decisions(action.row.id)).toHaveLength(0);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS fail_pending_action_expiry_outbox_insert ON outbox",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS fail_pending_action_expiry_outbox_insert()",
        ),
      );
    }
  });

  it("lets a due requester cancellation lock win before the worker", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    let releaseLock: () => void = () => {};
    let lockAcquired: (pid: number) => void = (_pid) => {};
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const acquired = new Promise<number>((resolve) => {
      lockAcquired = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      const pidResult = await tx.execute<{ pid: number }>(
        sql`SELECT pg_backend_pid() AS pid`,
      );
      const pid = pidResult.rows[0]?.pid;
      if (pid === undefined) throw new Error("Missing lock holder pid");
      await tx.execute(
        sql`SELECT id FROM pending_action WHERE id = ${action.row.id} FOR UPDATE`,
      );
      lockAcquired(pid);
      await release;
    });
    const blockerPid = await acquired;
    const cancellation = decideOwnPendingAction({
      id: action.row.id,
      requesterPersonId: action.person.id,
      outcome: "cancelled",
    });
    try {
      await waitForBlockedBy(blockerPid);
    } finally {
      releaseLock();
    }
    await blocker;
    await expect(cancellation).resolves.toMatchObject({ state: "expired" });
    expect((await expirePendingActions()).expired).toBe(0);
    const [row] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, action.row.id));
    expect(row?.state).toBe("expired");
    expect(await decisions(action.row.id)).toHaveLength(1);
    expect(await decisionAudits(action.row.id)).toHaveLength(1);
  });

  it("returns 409 when the expiry worker locks and decides before requester cancellation", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION pause_pending_action_cancel_race()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.id = '${action.row.id.replaceAll("'", "''")}' THEN
            PERFORM pg_sleep(1);
          END IF;
          RETURN NEW;
        END $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER pause_pending_action_cancel_race
        BEFORE UPDATE ON pending_action FOR EACH ROW
        EXECUTE FUNCTION pause_pending_action_cancel_race()
      `),
    );
    let worker: Promise<{ expired: number }> | undefined;
    try {
      worker = expirePendingActions();
      const deadline = Date.now() + 5_000;
      let waitingInTrigger = false;
      while (Date.now() < deadline) {
        const activity = await db.execute<{ waiting: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event = 'PgSleep'
              AND query LIKE '%UPDATE pending_action%'
          ) AS waiting
        `);
        if (activity.rows[0]?.waiting) {
          waitingInTrigger = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waitingInTrigger).toBe(true);
      const cancellation = decideOwnPendingAction({
        id: action.row.id,
        requesterPersonId: action.person.id,
        outcome: "cancelled",
      }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      expect(worker).toBeDefined();
      expect(await worker).toMatchObject({ expired: 1 });
      const cancellationResult = await cancellation;
      expect(cancellationResult.ok).toBe(false);
      if (!cancellationResult.ok) {
        expect(cancellationResult.error).toMatchObject({
          status: 409,
          message: "pending_action_not_pending",
        });
      }
      const [row] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, action.row.id));
      expect(row?.state).toBe("expired");
      expect(await decisions(action.row.id)).toHaveLength(1);
      expect(await decisionAudits(action.row.id)).toHaveLength(1);
    } finally {
      if (worker) await worker.catch(() => undefined);
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS pause_pending_action_cancel_race ON pending_action",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS pause_pending_action_cancel_race()"),
      );
    }
  });

  it("allows a concurrent worker call to skip the held lease", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    const results = await Promise.all([
      expirePendingActions(),
      expirePendingActions(),
    ]);
    expect(results.reduce((sum, result) => sum + result.expired, 0)).toBe(1);
    expect(await decisions(action.row.id)).toHaveLength(1);
  });

  it("excludes over-cap unsupported future-scope rows and reports them while expiring the eligible sibling", async () => {
    const requester = await makeRequester();
    const unsupportedScopeRows = await db
      .insert(schema.pendingActionTable)
      .values(
        Array.from({ length: 1_001 }, () =>
          pendingActionValues(
            new Date(Date.now() - 120_000),
            requester.person.id,
            requester.workspace,
            null,
          ),
        ),
      )
      .returning({ id: schema.pendingActionTable.id });
    const valid = await insertPendingAction(
      new Date(Date.now() - 60_000),
      requester.person.id,
      requester.workspace,
    );

    const result = await expirePendingActions();
    expect(result).toMatchObject({ expired: 1, degraded: true });
    const [validRow] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, valid.id));
    expect(validRow?.state).toBe("expired");
    expect(await decisions(valid.id)).toHaveLength(1);

    const unsupportedRows = await db
      .select({
        id: schema.pendingActionTable.id,
        state: schema.pendingActionTable.state,
      })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.state, "pending"));
    const unsupportedIds = new Set(unsupportedScopeRows.map((row) => row.id));
    const matchingUnsupportedRows = unsupportedRows.filter((row) =>
      unsupportedIds.has(row.id),
    );
    expect(matchingUnsupportedRows).toHaveLength(1_001);
    expect(
      matchingUnsupportedRows.every((row) => row.state === "pending"),
    ).toBe(true);
    const events = await db
      .select({ payload: schema.outboxTable.payload })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "pending_action.decided"));
    const unsupportedEvents = events.filter((event) => {
      const body = (event.payload as { payload?: { pendingActionId?: string } })
        .payload;
      return body?.pendingActionId && unsupportedIds.has(body.pendingActionId);
    });
    expect(unsupportedEvents).toHaveLength(0);
    const repeat = await expirePendingActions();
    expect(repeat).toMatchObject({ expired: 0, degraded: true });
    expect(await decisions(valid.id)).toHaveLength(1);
    expect(await decisionAudits(valid.id)).toHaveLength(1);
  });

  it("caps eligible rows per run at 1,000 and resumes the next eligible row", async () => {
    const requester = await makeRequester();
    const rows = await db
      .insert(schema.pendingActionTable)
      .values(
        Array.from({ length: 1_001 }, (_, index) =>
          pendingActionValues(
            new Date(Date.now() - 120_000 + index),
            requester.person.id,
            requester.workspace,
          ),
        ),
      )
      .returning({ id: schema.pendingActionTable.id });

    const first = await expirePendingActions();
    expect(first).toMatchObject({ expired: 1_000, degraded: false });
    const firstStates = await db
      .select({
        id: schema.pendingActionTable.id,
        state: schema.pendingActionTable.state,
      })
      .from(schema.pendingActionTable);
    const byId = new Map(firstStates.map((row) => [row.id, row.state]));
    expect(rows.filter((row) => byId.get(row.id) === "expired")).toHaveLength(
      1_000,
    );
    expect(rows.filter((row) => byId.get(row.id) === "pending")).toHaveLength(
      1,
    );

    const second = await expirePendingActions();
    expect(second).toMatchObject({ expired: 1, degraded: false });
    const fixtureIds = new Set(rows.map((row) => row.id));
    const events = await db
      .select({ payload: schema.outboxTable.payload })
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "pending_action.decided"));
    const fixtureEvents = events.filter((event) => {
      const body = (event.payload as { payload?: { pendingActionId?: string } })
        .payload;
      return body?.pendingActionId && fixtureIds.has(body.pendingActionId);
    });
    expect(fixtureEvents).toHaveLength(1_001);
    const audits = await db
      .select({ entityId: schema.auditLogTable.entityId })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "pending_action.decided"));
    expect(
      audits.filter((audit) => fixtureIds.has(audit.entityId ?? "")),
    ).toHaveLength(1_001);
  });

  it("leaves due rows untouched while another replica holds the named lease", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    await db.insert(schema.jobLeaseTable).values({
      name: "pending-action-expire",
      owner: "other-replica",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await expirePendingActions();
    expect(result).toMatchObject({ expired: 0, degraded: false });
    const [row] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, action.row.id));
    expect(row?.state).toBe("pending");
    expect(await decisions(action.row.id)).toHaveLength(0);
  });

  it("takes over an expired lease and commits the matching row state and event", async () => {
    const action = await makePendingAction(new Date(Date.now() - 60_000));
    await db.insert(schema.jobLeaseTable).values({
      name: "pending-action-expire",
      owner: "expired-replica",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await expirePendingActions();
    expect(result.expired).toBe(1);
    const [row] = await db
      .select({ state: schema.pendingActionTable.state })
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, action.row.id));
    expect(row?.state).toBe("expired");
    expect(await decisions(action.row.id)).toHaveLength(1);
  });

  it("allows a new lease owner to process unlocked rows while the expired owner is still working", async () => {
    const requester = await makeRequester();
    const rows = await db
      .insert(schema.pendingActionTable)
      .values(
        Array.from({ length: 101 }, (_, index) =>
          pendingActionValues(
            new Date(Date.now() - 120_000 + index),
            requester.person.id,
            requester.workspace,
          ),
        ),
      )
      .returning({ id: schema.pendingActionTable.id });
    const blockedId = rows[0]?.id;
    const takeoverId = rows[100]?.id;
    if (!blockedId || !takeoverId) throw new Error("Missing overlap fixtures");

    await db.execute(
      sql.raw(`
        CREATE OR REPLACE FUNCTION pause_pending_action_expiry_overlap()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.id = '${blockedId.replaceAll("'", "''")}' THEN
            PERFORM pg_sleep(4);
          END IF;
          RETURN NEW;
        END $$
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER pause_pending_action_expiry_overlap
        BEFORE UPDATE ON pending_action FOR EACH ROW
        EXECUTE FUNCTION pause_pending_action_expiry_overlap()
      `),
    );

    let firstWorker: Promise<{ expired: number }> | undefined;
    try {
      firstWorker = expirePendingActions();
      const deadline = Date.now() + 5_000;
      let waitingInTrigger = false;
      while (Date.now() < deadline) {
        const activity = await db.execute<{ waiting: boolean }>(sql`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event = 'PgSleep'
              AND query LIKE '%UPDATE pending_action%'
          ) AS waiting
        `);
        if (activity.rows[0]?.waiting) {
          waitingInTrigger = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waitingInTrigger).toBe(true);

      await db.execute(
        sql.raw(`
          UPDATE job_lease
          SET expires_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC' - interval '1 second'
          WHERE name = 'pending-action-expire'
        `),
      );
      vi.resetModules();
      const { expirePendingActions: takeoverWorker } = await import(
        "../../apps/api/src/scheduler/pending-action-expire"
      );
      const takeover = await takeoverWorker();
      expect(takeover.expired).toBe(1);

      const [takeoverRow] = await db
        .select({ state: schema.pendingActionTable.state })
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, takeoverId));
      expect(takeoverRow?.state).toBe("expired");
      expect(await decisions(takeoverId)).toHaveLength(1);

      const firstResult = await firstWorker;
      expect(firstResult.expired).toBe(100);
      const eventRows = await db
        .select({ payload: schema.outboxTable.payload })
        .from(schema.outboxTable)
        .where(eq(schema.outboxTable.kind, "pending_action.decided"));
      const fixtureEvents = eventRows.filter((event) => {
        const body = (
          event.payload as { payload?: { pendingActionId?: string } }
        ).payload;
        return (
          body?.pendingActionId &&
          rows.some((row) => row.id === body.pendingActionId)
        );
      });
      expect(fixtureEvents).toHaveLength(101);
      for (const row of rows) expect(await decisions(row.id)).toHaveLength(1);
    } finally {
      if (firstWorker) await firstWorker.catch(() => undefined);
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS pause_pending_action_expiry_overlap ON pending_action",
        ),
      );
      await db.execute(
        sql.raw(
          "DROP FUNCTION IF EXISTS pause_pending_action_expiry_overlap()",
        ),
      );
    }
  });
});
