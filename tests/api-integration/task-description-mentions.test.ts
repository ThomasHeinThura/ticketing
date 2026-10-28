/**
 * P0R1-03: description @mentions notify through the same transactional, event-linked path as
 * comment mentions -- one outbox event per edit, a notification keyed on (event, person), and
 * never a customer or a person without project reach.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  json,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

const mention = (id: string) =>
  `<taskdesk-mention id="${id}">@x</taskdesk-mention>`;
const mentions = (taskId: string) =>
  db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.resourceId, taskId),
        eq(schema.notificationTable.type, "task_mention"),
      ),
    );

describe("API integration: task description mentions", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("notifies reachable staff through the outbox event, never customers or users without reach", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const s = await seedLegacy(world, world.projectMember.user.id);
    mockAuthenticatedSession(world.projectMember.user);
    // A customer-side person holding project reach is still never notified of a mention.
    await db
      .update(schema.personTable)
      .set({ side: "customer" })
      .where(eq(schema.personTable.userId, world.customerWithRole.user.id));

    const res = await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: [
        mention(world.readerLead.user.id),
        mention(world.outsiderLead.user.id),
        mention(world.customerWithRole.user.id),
        mention(world.projectMember.user.id),
      ].join(" "),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const rows = await mentions(s.taskId);
    expect(rows.map((row) => row.userId)).toEqual([world.readerLead.user.id]);
    const [row] = rows;
    expect(row?.eventId).toMatch(/^evt_/);
    expect(row?.kind).toBe("task.description_changed");
    const outbox = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.eventId, row?.eventId ?? ""));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.kind).toBe("task.description_changed");
  });

  it("does not re-notify an existing mention and keeps one row per event and person", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const s = await seedLegacy(world, world.projectMember.user.id);
    mockAuthenticatedSession(world.projectMember.user);
    const first = `${mention(world.readerLead.user.id)} first`;
    await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: first,
    });
    expect(await mentions(s.taskId)).toHaveLength(1);

    // Same text again is a no-op; an edit that keeps the mention adds no second notification.
    await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: first,
    });
    await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: `${first} edited`,
    });
    expect(await mentions(s.taskId)).toHaveLength(1);
  });

  it("a deactivated mentioned person is skipped and the edit still commits", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    const s = await seedLegacy(world, world.projectMember.user.id);
    mockAuthenticatedSession(world.projectMember.user);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, world.readerLead.user.id));
    const res = await json(app, "PUT", `/api/task/description/${s.taskId}`, {
      description: mention(world.readerLead.user.id),
    });
    expect(res.status).toBe(200);
    expect(await mentions(s.taskId)).toHaveLength(0);
  });
});
