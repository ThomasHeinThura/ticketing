/**
 * S4 — the NATIVE workspace create route reproduces the inherited create
 * contract. Issue #6, retrofit plan §3 (S4 row) and §2.5 (the contract).
 *
 * THE EQUIVALENCE OBLIGATION IS NINE, NOT FOUR. This file is the S1 oracle's
 * create assertions RE-POINTED at `POST /api/workspace`: the same NINE
 * observable effects — EIGHT first-order plus ONE one-hop durable consequence
 * — asserted the same way, on DATABASE STATE rather than on a response shape.
 *
 * It does not replace the S1 oracle and does not touch it. The oracle keeps
 * driving the still-mounted plugin (S4 ships dark; the client is repointed at
 * S3/S8a, not here), so after this batch BOTH paths are pinned to the same
 * nine effects — which is exactly what makes the eventual cutover checkable.
 *
 * Effect 9 is asserted as EVENTUAL via a bounded poll, never as synchronous
 * pre-response persistence (§2.5, "Timing is NOT contractual").
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notificationWork = vi.hoisted(() => {
  const pending = new Set<Promise<unknown>>();
  const pendingKinds = new Map<Promise<unknown>, string>();
  const failures: unknown[] = [];
  const timeline: string[] = [];
  const handlers = new Map<string, number>();
  const completions = new Map<string, number>();
  let deliveryUserGate: Promise<void> | undefined;
  let releaseDeliveryUserGate: (() => void) | undefined;
  let deliveryUserEntered: (() => void) | undefined;
  let deliveryUserEnteredPromise: Promise<void> | undefined;

  async function pauseAfterDeliveryUserQueryIfGated() {
    if (!deliveryUserGate) return;
    timeline.push("delivery:user-query-entered");
    deliveryUserEntered?.();
    await deliveryUserGate;
  }

  function track<T>(kind: string, promise: Promise<T>): Promise<T> {
    handlers.set(kind, (handlers.get(kind) ?? 0) + 1);
    timeline.push(`${kind}:start`);
    pending.add(promise);
    pendingKinds.set(promise, kind);
    void promise.then(
      () => {
        completions.set(kind, (completions.get(kind) ?? 0) + 1);
        timeline.push(`${kind}:complete`);
        pending.delete(promise);
        pendingKinds.delete(promise);
      },
      (error: unknown) => {
        failures.push(error);
        pending.delete(promise);
        pendingKinds.delete(promise);
      },
    );
    return promise;
  }

  return {
    track,
    async join() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
      if (failures.length > 0) throw failures[0];
    },
    handlerCount: (kind: string) => handlers.get(kind) ?? 0,
    completionCount: (kind: string) => completions.get(kind) ?? 0,
    timeline: () => [...timeline],
    mark: (event: string) => timeline.push(event),
    activeCount: (kind: string) =>
      [...pendingKinds.values()].filter((pendingKind) => pendingKind === kind)
        .length,
    gateDeliveryUser() {
      deliveryUserGate = new Promise<void>((resolve) => {
        releaseDeliveryUserGate = resolve;
      });
      deliveryUserEnteredPromise = new Promise<void>((resolve) => {
        deliveryUserEntered = resolve;
      });
    },
    pauseAfterDeliveryUserQueryIfGated,
    waitForDeliveryUserQuery() {
      if (!deliveryUserEnteredPromise) {
        throw new Error("delivery user gate was not initialized");
      }
      return deliveryUserEnteredPromise;
    },
    releaseDeliveryUser() {
      releaseDeliveryUserGate?.();
      deliveryUserGate = undefined;
      releaseDeliveryUserGate = undefined;
      deliveryUserEntered = undefined;
      deliveryUserEnteredPromise = undefined;
    },
  };
});

vi.mock("../../apps/api/src/events", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../apps/api/src/events")>();
  return {
    ...actual,
    subscribeToEvent: (
      eventType: string,
      handler: (data: unknown) => Promise<void>,
    ) =>
      actual.subscribeToEvent(eventType, (data: unknown) => {
        if (
          eventType !== "workspace.created" &&
          eventType !== "notification.created"
        ) {
          return handler(data);
        }
        return notificationWork.track(eventType, handler(data));
      }),
  };
});

vi.mock(
  "../../apps/api/src/notification-preferences/delivery",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/notification-preferences/delivery")
      >();
    return {
      ...actual,
      deliverNotification: (
        ...args: Parameters<typeof actual.deliverNotification>
      ) =>
        notificationWork.track(
          "deliverNotification",
          actual.deliverNotification(...args),
        ),
    };
  },
);

vi.mock(
  "../../apps/api/src/notification-preferences/delivery.repository",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/notification-preferences/delivery.repository")
      >();
    return {
      ...actual,
      findDeliveryUser: async (
        ...args: Parameters<typeof actual.findDeliveryUser>
      ) => {
        const result = await actual.findDeliveryUser(...args);
        await notificationWork.pauseAfterDeliveryUserQueryIfGated();
        return result;
      },
    };
  },
);

import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type RecordedEvent = { type: string; data: unknown };
const recordedEvents: RecordedEvent[] = [];
let eventSubscribersInitialized = false;

async function quiesceThenReset(options?: {
  onResetDelegated?: () => void;
  onLockUnavailable?: (details: { attempt: number; error: unknown }) => void;
}) {
  await notificationWork.join();
  options?.onResetDelegated?.();
  notificationWork.mark("reset:delegated");
  await resetTestDatabase({ onLockUnavailable: options?.onLockUnavailable });
  notificationWork.mark("reset:complete");
}

function initEventSubscribers() {
  if (eventSubscribersInitialized) return;
  eventSubscribersInitialized = true;
  // Subscribe to the real event bus, exactly as the S1 oracle does, rather
  // than mocking publishEvent — a mock would characterize the stand-in.
  subscribeToEvent("workspace.created", async (data) => {
    recordedEvents.push({ type: "workspace.created", data });
  });
}

beforeEach(async () => {
  await quiesceThenReset();
  recordedEvents.length = 0;
  initEventSubscribers();
});

afterEach(async () => {
  await notificationWork.join();
});

describe("S4 native create: the NINE-effect contract (A2-P1..A2-P4)", () => {
  // A2-P1. One test on purpose, for the same reason the S1 oracle gives:
  // split apart, an implementation could pass the headline assertions while
  // silently ceasing to write one of the others.
  it("A2-P1 writes all NINE contract effects — workspace, owner workspace_member, three seeded workspace_role rows, workspace.created, a default team, its team_member, the creating session's active_organization_id and active_team_id, plus the eventual workspace_created notification", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    // (7)+(8) BEFORE. Capture the creating session as a ROW, so the
    // assertions afterwards are about THIS persisted session and cannot be
    // satisfied by minting a fresh one that happens to carry the workspace.
    const sessionsBefore = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id));
    expect(sessionsBefore).toHaveLength(1);
    const creatingSessionId = sessionsBefore[0]?.id;
    if (!creatingSessionId) throw new Error("expected one creating session");
    expect(sessionsBefore[0]?.activeOrganizationId).toBeNull();
    expect(sessionsBefore[0]?.activeTeamId).toBeNull();

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string; slug: string };

    // (1) the workspace row
    const workspaceRows = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(workspaceRows).toHaveLength(1);
    expect(workspaceRows[0]?.name).toBe("Acme Inc");
    // R8: slug is NOT NULL UNIQUE and the plugin was its only generator.
    expect(workspaceRows[0]?.slug).toBeTruthy();

    // (2) the owner workspace_member row
    const memberRows = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.workspaceId, workspace.id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.userId).toBe(owner.user.id);
    expect(memberRows[0]?.role).toBe("owner");
    expect(memberRows[0]?.joinedAt).toBeInstanceOf(Date);

    // (3) three seeded workspace_role rows, and NO owner row (R5) — owner
    // authority stays entirely in the compiled-in static role.
    const roleRows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(roleRows).toHaveLength(3);
    expect(new Set(roleRows.map((r) => r.role))).toEqual(
      new Set(["viewer", "member", "admin"]),
    );
    expect(roleRows.some((r) => r.role === "owner")).toBe(false);

    // (4) the workspace.created event, PAYLOAD included: effect 9 is produced
    // from exactly these fields, so a handler that published with a missing
    // ownerId would silently stop producing the notification while still
    // "publishing workspace.created".
    const createdEvents = recordedEvents.filter(
      (e) =>
        e.type === "workspace.created" &&
        (e.data as { workspaceId?: string }).workspaceId === workspace.id,
    );
    expect(createdEvents).toHaveLength(1);
    const createdPayload = createdEvents[0]?.data as {
      workspaceId?: string;
      workspaceName?: string;
      ownerId?: string;
    };
    expect(createdPayload.workspaceId).toBe(workspace.id);
    expect(createdPayload.workspaceName).toBe("Acme Inc");
    expect(createdPayload.ownerId).toBe(owner.user.id);

    // (5)+(6) the default team and its team_member, in the SAME request.
    const teamRows = await db
      .select()
      .from(schema.teamTable)
      .where(eq(schema.teamTable.workspaceId, workspace.id));
    expect(teamRows).toHaveLength(1);
    const team = teamRows[0];
    if (!team) throw new Error("expected a default team row");
    expect(team.name).toBe("Acme Inc");

    const teamMemberRows = await db
      .select()
      .from(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.teamId, team.id));
    expect(teamMemberRows).toHaveLength(1);
    expect(teamMemberRows[0]?.userId).toBe(owner.user.id);

    // (7)+(8) AFTER, on the SAME session row re-read by its captured id.
    const sessionsAfter = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, creatingSessionId));
    expect(sessionsAfter).toHaveLength(1);
    expect(sessionsAfter[0]?.activeOrganizationId).toBe(workspace.id);
    expect(sessionsAfter[0]?.activeTeamId).toBe(team.id);

    // (9) the one-hop durable consequence, asserted as EVENTUAL.
    const findNotification = () =>
      db
        .select()
        .from(schema.notificationTable)
        .where(
          and(
            eq(schema.notificationTable.userId, owner.user.id),
            eq(schema.notificationTable.type, "workspace_created"),
            eq(schema.notificationTable.resourceId, workspace.id),
          ),
        );
    const notificationDeadline = Date.now() + 5_000;
    let notifications = await findNotification();
    while (notifications.length === 0 && Date.now() < notificationDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      notifications = await findNotification();
    }
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.resourceType).toBe("workspace");
    expect(
      (notifications[0]?.eventData as { workspaceName?: string } | null)
        ?.workspaceName,
    ).toBe("Acme Inc");
  });

  it("A2-P2 rejects a name that fails checkWorkspaceName before any row is written", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const response = await createWorkspaceNative(app, owner.cookie, {
      name: "Visit http://evil.example.com now",
    });
    expect(response.status).toBe(400);

    const workspaces = await db.select().from(schema.workspaceTable);
    expect(workspaces).toHaveLength(0);
  });

  it("A2-P3 generates and dedupes a slug when none is supplied (R8)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const first = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string; slug: string };
    expect(firstBody.slug).toBe("acme-inc");

    // Same name again: the plugin required the caller to supply a unique
    // slug; the native route must not 500 on the UNIQUE constraint.
    const second = await createWorkspaceNative(app, owner.cookie, {
      name: "Acme Inc",
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string; slug: string };
    expect(secondBody.slug).not.toBe(firstBody.slug);
    expect(secondBody.slug.startsWith("acme-inc")).toBe(true);

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(2);
  });

  it("A2-P4 returns 409 — not 500 — when an explicitly supplied slug is taken, and writes nothing", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const slug = `taken-${randomUUID().slice(0, 8)}`;
    const first = await createWorkspaceNative(app, owner.cookie, {
      name: "First",
      slug,
    });
    expect(first.status).toBe(200);

    const second = await createWorkspaceNative(app, owner.cookie, {
      name: "Second",
      slug,
    });
    expect(second.status).toBe(409);

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(1);
    // No orphaned member/role/team rows from the refused attempt.
    expect(await db.select().from(schema.workspaceUserTable)).toHaveLength(1);
    expect(await db.select().from(schema.workspaceRoleTable)).toHaveLength(3);
    expect(await db.select().from(schema.teamTable)).toHaveLength(1);
  });

  it("A2-P4b survives a real slug race — concurrent creates of the same name all succeed with distinct slugs", async () => {
    // The generated slug is chosen by a read, so two creates in flight at
    // once can both pick it. The read cannot be made atomic; the UNIQUE
    // constraint is what decides, and losing that race must produce another
    // workspace rather than a 500. This drives it concurrently rather than
    // asserting the retry path by inspection.
    const { app } = createApp();
    const owner = await signUpUser(app);

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        createWorkspaceNative(app, owner.cookie, { name: "Race Condition" }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(12).fill(200));

    const rows = await db.select().from(schema.workspaceTable);
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(12);
    for (const row of rows) {
      expect(row.slug.startsWith("race-condition")).toBe(true);
    }

    // Every one of them is complete: a create that lost the race and retried
    // must still have seeded its roles and its team.
    for (const row of rows) {
      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.workspaceId, row.id));
      expect(roleRows).toHaveLength(3);
      const teamRows = await db
        .select()
        .from(schema.teamTable)
        .where(eq(schema.teamTable.workspaceId, row.id));
      expect(teamRows).toHaveLength(1);
    }
  });

  it("A2-P5 writes description and logo, the two columns only the plugin wrote (R8)", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "With Extras",
      description: "A described workspace",
      logo: "https://cdn.example.com/logo.png",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const [row] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(row?.description).toBe("A described workspace");
    expect(row?.logo).toBe("https://cdn.example.com/logo.png");
  });

  it("joins the real workspace subscriber and detached delivery before resetting its database", async () => {
    const connectionString = process.env.TASKDESK_DATABASE_URL;
    if (!connectionString) throw new Error("expected test database URL");
    const observer = new Client({ connectionString, statement_timeout: 2_000 });
    const blocker = new Client({ connectionString, statement_timeout: 2_000 });
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `taskdesk_test_807_${suffix}`;
    const triggerName = `taskdesk_test_807_${suffix}`;
    const advisoryKey1 = Number.parseInt(suffix.slice(0, 7), 16);
    const advisoryKey2 = Number.parseInt(suffix.slice(7, 14), 16);
    let blockerConnected = false;
    let observerConnected = false;
    let advisoryLockHeld = false;
    let functionCreated = false;
    let triggerCreated = false;
    let requestPromise: Promise<Response> | undefined;
    let resetPromise: Promise<void> | undefined;
    let ownerId: string | undefined;
    let workspaceId: string | undefined;
    let resetDelegated = false;
    let lockUnavailableAttempts = 0;
    let primaryError: unknown;
    let cleanupError: unknown;

    const waitFor = async (
      description: string,
      condition: () => Promise<boolean>,
    ) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for ${description}`);
    };

    try {
      await observer.connect();
      observerConnected = true;
      await blocker.connect();
      blockerConnected = true;
      await blocker.query("SELECT pg_advisory_lock($1, $2)", [
        advisoryKey1,
        advisoryKey2,
      ]);
      advisoryLockHeld = true;
      await blocker.query(`
        CREATE FUNCTION public.${functionName}()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(${advisoryKey1}, ${advisoryKey2});
          RETURN NEW;
        END;
        $$
      `);
      functionCreated = true;
      await blocker.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON public.notification
        FOR EACH ROW EXECUTE FUNCTION public.${functionName}()
      `);
      triggerCreated = true;

      notificationWork.gateDeliveryUser();
      const timelineStart = notificationWork.timeline().length;
      const workspaceSubscriberBaseline =
        notificationWork.completionCount("workspace.created");
      const { app } = createApp();
      const owner = await signUpUser(app);
      ownerId = owner.user.id;
      requestPromise = createWorkspaceNative(app, owner.cookie, {
        name: "Notification fixture lifetime regression",
      });
      const response = await requestPromise;
      expect(response.status).toBe(200);
      workspaceId = ((await response.json()) as { id: string }).id;
      notificationWork.mark("http:complete");

      await waitFor(
        "the actual notification insert to hold its table lock",
        async () => {
          const result = await observer.query(`
          SELECT a.pid
          FROM pg_stat_activity AS a
          JOIN pg_locks AS l ON l.pid = a.pid
          WHERE a.datname = current_database()
            AND a.pid <> pg_backend_pid()
            AND a.state = 'active'
            AND a.query ILIKE '%insert%notification%'
            AND l.locktype = 'relation'
            AND l.relation = to_regclass('public.notification')
            AND l.mode = 'RowExclusiveLock'
            AND l.granted
        `);
          return (
            result.rows.length > 0 &&
            notificationWork.activeCount("workspace.created") > 0
          );
        },
      );
      expect(
        notificationWork.handlerCount("workspace.created"),
      ).toBeGreaterThan(0);

      resetPromise = quiesceThenReset({
        onResetDelegated: () => {
          resetDelegated = true;
        },
        onLockUnavailable: () => {
          lockUnavailableAttempts += 1;
        },
      });
      // Keep an early reset rejection handled while both controlled barriers
      // are still held; the awaited promise below preserves the failure.
      void resetPromise.catch(() => undefined);
      await Promise.resolve();
      expect(resetDelegated).toBe(false);

      notificationWork.mark("insert:barrier-released");
      await blocker.query("SELECT pg_advisory_unlock($1, $2)", [
        advisoryKey1,
        advisoryKey2,
      ]);
      advisoryLockHeld = false;

      await notificationWork.waitForDeliveryUserQuery();
      await waitFor(
        "the actual workspace subscriber to settle",
        async () =>
          notificationWork.completionCount("workspace.created") >
          workspaceSubscriberBaseline,
      );
      expect(notificationWork.activeCount("workspace.created")).toBe(0);
      expect(notificationWork.activeCount("notification.created")).toBe(0);
      expect(
        notificationWork.activeCount("deliverNotification"),
      ).toBeGreaterThan(0);
      expect(resetDelegated).toBe(false);

      notificationWork.mark("delivery:barrier-released");
      notificationWork.releaseDeliveryUser();
      await resetPromise;
      expect(resetDelegated).toBe(true);
      expect(lockUnavailableAttempts).toBe(0);
      const timeline = notificationWork.timeline().slice(timelineStart);
      const eventIndex = (event: string) => {
        const index = timeline.indexOf(event);
        expect(
          index,
          `expected timeline event ${event}`,
        ).toBeGreaterThanOrEqual(0);
        return index;
      };
      expect(eventIndex("http:complete")).toBeLessThan(
        eventIndex("insert:barrier-released"),
      );
      expect(eventIndex("insert:barrier-released")).toBeLessThan(
        eventIndex("notification.created:start"),
      );
      expect(eventIndex("notification.created:start")).toBeLessThan(
        eventIndex("delivery:user-query-entered"),
      );
      expect(eventIndex("workspace.created:complete")).toBeLessThan(
        eventIndex("reset:delegated"),
      );
      expect(eventIndex("deliverNotification:complete")).toBeLessThan(
        eventIndex("reset:delegated"),
      );
      expect(eventIndex("reset:delegated")).toBeLessThan(
        eventIndex("reset:complete"),
      );
      if (!ownerId || !workspaceId) {
        throw new Error(
          "workspace identity missing after successful create response",
        );
      }
      expect(
        await db
          .select()
          .from(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, workspaceId)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(schema.notificationTable)
          .where(
            and(
              eq(schema.notificationTable.userId, ownerId),
              eq(schema.notificationTable.resourceId, workspaceId),
            ),
          ),
      ).toHaveLength(0);
    } catch (error) {
      primaryError = error;
    } finally {
      notificationWork.releaseDeliveryUser();
      if (advisoryLockHeld && blockerConnected) {
        try {
          await blocker.query("SELECT pg_advisory_unlock($1, $2)", [
            advisoryKey1,
            advisoryKey2,
          ]);
          advisoryLockHeld = false;
        } catch (error) {
          cleanupError ??= error;
          try {
            await blocker.end();
            blockerConnected = false;
            advisoryLockHeld = false;
          } catch (closeError) {
            cleanupError ??= closeError;
          }
        }
      }
      for (const pending of [requestPromise, resetPromise]) {
        if (!pending) continue;
        try {
          await pending;
        } catch (error) {
          cleanupError ??= error;
        }
      }
      try {
        await notificationWork.join();
      } catch (error) {
        cleanupError ??= error;
      }
      const ddlClient = blockerConnected
        ? blocker
        : observerConnected
          ? observer
          : undefined;
      if (triggerCreated && ddlClient) {
        try {
          await ddlClient.query(
            `DROP TRIGGER ${triggerName} ON public.notification`,
          );
          triggerCreated = false;
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (functionCreated && ddlClient) {
        try {
          await ddlClient.query(`DROP FUNCTION public.${functionName}()`);
          functionCreated = false;
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (blockerConnected) {
        try {
          await blocker.end();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (observerConnected) {
        try {
          await observer.end();
        } catch (error) {
          cleanupError ??= error;
        }
      }
      if (triggerCreated || functionCreated || advisoryLockHeld) {
        cleanupError ??= new Error(
          "notification regression could not remove all owned PostgreSQL state",
        );
      }
    }
    if (primaryError && cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        "notification regression failed and cleanup also failed",
      );
    }
    if (primaryError) throw primaryError;
    if (cleanupError) throw cleanupError;
  }, 30_000);
});
