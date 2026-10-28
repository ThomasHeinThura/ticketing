import type { Notification, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { getDatabasePool, schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const CHANNEL = "taskdesk_inbox_created";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function notification(userId: string, title: string) {
  return {
    userId,
    type: "info",
    title,
    content: "trigger integration fixture",
  };
}

function payloadOf(message: Notification) {
  if (message.channel !== CHANNEL || typeof message.payload !== "string")
    throw new Error("Unexpected inbox notification channel or payload.");
  return JSON.parse(message.payload) as Record<string, unknown>;
}

describe("0185 notification inbox realtime trigger", () => {
  let listener: PoolClient | undefined;
  let received: Notification[] = [];
  let onNotification: (message: Notification) => void = () => undefined;

  beforeEach(async () => {
    await resetTestDatabase();
    received = [];
    listener = await getDatabasePool().connect();
    onNotification = (message) => received.push(message);
    listener.on("notification", onNotification);
    await listener.query(`LISTEN ${CHANNEL}`);
  });

  afterEach(async () => {
    if (!listener) return;
    listener.removeListener("notification", onNotification);
    try {
      await listener.query(`UNLISTEN ${CHANNEL}`);
    } finally {
      listener.release();
      listener = undefined;
    }
  });

  it("publishes the exact recipient-only hint only after the insert commits", async () => {
    const { user } = await createWorkspaceMember();
    const inserted = deferred();
    const commit = deferred();
    const transaction = db.transaction(async (tx) => {
      await tx
        .insert(schema.notificationTable)
        .values(notification(user.id, "commit-only"));
      inserted.resolve();
      await commit.promise;
    });

    await inserted.promise;
    await sleep(60);
    expect(received).toEqual([]);

    commit.resolve();
    await transaction;
    await expectNotificationCount(received, 1);
    expect(received).toHaveLength(1);
    const [message] = received;
    if (!message)
      throw new Error("Committed notification hint was not received.");
    expect(payloadOf(message)).toEqual({ userId: user.id });
  });

  it("does not publish a notification row that rolls back", async () => {
    const { user } = await createWorkspaceMember();
    const inserted = deferred();
    const rollback = deferred();
    const transaction = db.transaction(async (tx) => {
      await tx
        .insert(schema.notificationTable)
        .values(notification(user.id, "rollback-only"));
      inserted.resolve();
      await rollback.promise;
      throw new Error("rollback inbox trigger fixture");
    });

    await inserted.promise;
    await sleep(60);
    expect(received).toEqual([]);

    rollback.resolve();
    await expect(transaction).rejects.toThrow("rollback inbox trigger fixture");
    await sleep(80);
    expect(received).toEqual([]);
  });

  it("coalesces repeated rows per recipient and isolates distinct recipient payloads", async () => {
    const first = await createWorkspaceMember();
    const second = await createWorkspaceMember();

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.notificationTable)
        .values([
          notification(first.user.id, "first-a"),
          notification(first.user.id, "first-b"),
          notification(second.user.id, "second-a"),
        ]);
    });
    await expectNotificationCount(received, 2);
    await sleep(60);

    expect(received).toHaveLength(2);
    const payloads = received.map(payloadOf);
    expect(payloads).toEqual(
      expect.arrayContaining([
        { userId: first.user.id },
        { userId: second.user.id },
      ]),
    );
    for (const payload of payloads) {
      expect(Object.keys(payload)).toEqual(["userId"]);
      expect([first.user.id, second.user.id]).toContain(payload.userId);
    }
  });
});

async function expectNotificationCount(
  messages: Notification[],
  expected: number,
) {
  const deadline = Date.now() + 2_000;
  while (messages.length < expected && Date.now() < deadline) await sleep(10);
  expect(messages).toHaveLength(expected);
}
