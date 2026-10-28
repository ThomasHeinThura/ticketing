/**
 * P5 time and cost, timer (TC-6): start and read back after a "reload", one timer per person, the
 * server-side midnight split (profile zone, then instance zone, then UTC), the 12 hour cap, the
 * sweeper, and the review flag on a capped entry.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  runningTimerTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { runTimerSweeper } from "../../apps/api/src/scheduler/timer-sweeper";
import { resetTestDatabase } from "./helpers/database";
import {
  auditActionsOf,
  entryRows,
  setTimeFlags,
  type TimeWorld,
  timerRows,
  timeWorld,
} from "./helpers/p5-time";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
});
afterEach(() => {
  vi.useRealTimers();
});

type TimerState = {
  timer: null | { workItemId: string; startedAt: string; activityName: string };
  capMinutes: number;
};
type Stop = {
  capped: boolean;
  entries: Array<{
    date: string;
    minutes: number;
    needsReview: boolean;
    source: string;
  }>;
};

const start = (body: Record<string, unknown> = {}) =>
  w.agent(w.member.user, "/api/time-entries/timer/start", {
    method: "POST",
    body: { workspaceId: w.workspaceId, workItemId: w.itemA.id, ...body },
  });
const stop = (user = w.member.user, body: Record<string, unknown> = {}) =>
  w.agent(user, "/api/time-entries/timer/stop", {
    method: "POST",
    body: { workspaceId: w.workspaceId, ...body },
  });
const state = async () =>
  (await (
    await w.agent(
      w.member.user,
      `/api/time-entries/timer?workspaceId=${w.workspaceId}`,
    )
  ).json()) as TimerState;

async function setTimerStart(personId: string, startedAt: Date) {
  await db
    .update(runningTimerTable)
    .set({ startedAt })
    .where(eq(runningTimerTable.personId, personId));
}

describe("start, reload, stop", () => {
  it("survives a reload: the timer is read back from the server with its start instant", async () => {
    const response = await start({ description: "investigating" });
    expect(response.status, await response.clone().text()).toBe(200);
    const first = (await response.json()) as TimerState;
    expect(first.timer?.workItemId).toBe(w.itemA.id);
    expect(first.capMinutes).toBe(720);
    // A fresh read (a page reload) sees the same timer.
    const again = await state();
    expect(again.timer?.startedAt).toBe(first.timer?.startedAt);
    expect(again.timer?.activityName).toBe("Development");
    expect(await auditActionsOf(w.workspaceId)).toContain(
      "time_entry.timer_started",
    );
  });

  it("allows one running timer per person", async () => {
    expect((await start()).status).toBe(200);
    const second = await start();
    expect(second.status).toBe(409);
    expect(await second.text()).toContain("timer_already_running");
    expect(await timerRows(w.workspaceId)).toHaveLength(1);
  });

  it("stops into one entry of whole minutes and clears the timer", async () => {
    await start({ description: "start note" });
    await setTimerStart(w.member.personId, new Date(Date.now() - 47 * 60_000));
    const response = await stop(w.member.user, { description: "what I did" });
    expect(response.status, await response.clone().text()).toBe(200);
    const stopped = (await response.json()) as Stop;
    expect(stopped.capped).toBe(false);
    const minutes = stopped.entries.reduce((sum, e) => sum + e.minutes, 0);
    expect(minutes).toBeGreaterThanOrEqual(46);
    expect(minutes).toBeLessThanOrEqual(48);
    expect(stopped.entries.every((e) => Number.isInteger(e.minutes))).toBe(
      true,
    );
    expect((await state()).timer).toBeNull();
    const [row] = await entryRows(w.workspaceId);
    expect(row?.description).toBe("what I did");
    expect(row?.source).toBe("timer");
  });

  it("answers 404 when there is nothing to stop", async () => {
    expect((await stop()).status).toBe(404);
  });

  it("starts only against a work item the caller can reach", async () => {
    const response = await w.agent(
      w.member.user,
      "/api/time-entries/timer/start",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId, workItemId: w.itemB.id },
      },
    );
    expect(response.status).toBe(404);
    expect(await timerRows(w.workspaceId)).toHaveLength(0);
  });

  it("is refused for a viewer", async () => {
    const response = await w.agent(
      w.viewer.user,
      "/api/time-entries/timer/start",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId, workItemId: w.itemA.id },
      },
    );
    expect(response.status).toBe(403);
  });

  it("is gated by feature.time_tracking", async () => {
    await setTimeFlags(w.workspaceId, { time: false });
    expect((await start()).status).toBe(409);
  });
});

describe("server-side midnight split (owner decision D4)", () => {
  it("cuts a span crossing UTC midnight into two dated entries when no zone is set", async () => {
    await start();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-22T00:20:00Z"));
    await setTimerStart(w.member.personId, new Date("2026-10-21T23:30:00Z"));
    const response = await stop();
    expect(response.status, await response.clone().text()).toBe(200);
    const stopped = (await response.json()) as Stop;
    expect(stopped.entries.map((e) => [e.date, e.minutes])).toEqual([
      ["2026-10-21", 30],
      ["2026-10-22", 20],
    ]);
  });

  it("cuts at the profile timezone's midnight when the person has one", async () => {
    await db
      .update(schema.personTable)
      .set({ quietHoursTimezone: "Asia/Yangon" })
      .where(eq(schema.personTable.id, w.member.personId));
    await start();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T19:00:00Z"));
    await setTimerStart(w.member.personId, new Date("2026-10-21T17:00:00Z"));
    const stopped = (await (await stop()).json()) as Stop;
    // Yangon is UTC+6:30: local midnight falls at 17:30Z.
    expect(stopped.entries.map((e) => [e.date, e.minutes])).toEqual([
      ["2026-10-21", 30],
      ["2026-10-22", 90],
    ]);
  });

  it("falls back to the instance zone, then UTC, when the profile zone is invalid", async () => {
    await db
      .update(schema.personTable)
      .set({ quietHoursTimezone: "Not/AZone" })
      .where(eq(schema.personTable.id, w.member.personId));
    await db
      .update(schema.instanceSettingTable)
      .set({ timezone: "Asia/Yangon" });
    await start();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T19:00:00Z"));
    await setTimerStart(w.member.personId, new Date("2026-10-21T17:00:00Z"));
    const stopped = (await (await stop()).json()) as Stop;
    expect(stopped.entries.map((e) => e.minutes)).toEqual([30, 90]);
  });
});

describe("12 hour cap and the sweeper", () => {
  it("caps a stop after more than 12 hours and flags the entry for review", async () => {
    await start();
    await setTimerStart(
      w.member.personId,
      new Date(Date.now() - 20 * 3_600_000),
    );
    const stopped = (await (await stop()).json()) as Stop;
    expect(stopped.capped).toBe(true);
    expect(stopped.entries.reduce((sum, e) => sum + e.minutes, 0)).toBe(720);
    expect(stopped.entries.every((e) => e.needsReview)).toBe(true);
    expect(stopped.entries.every((e) => e.source === "timer_capped")).toBe(
      true,
    );
    expect(await auditActionsOf(w.workspaceId)).toContain(
      "time_entry.timer_capped",
    );
  });

  it("editing a capped entry answers the review prompt", async () => {
    await start();
    await setTimerStart(
      w.member.personId,
      new Date(Date.now() - 20 * 3_600_000),
    );
    const first = ((await (await stop()).json()) as Stop)
      .entries[0] as Stop["entries"][number] & { id: string };
    const pending = await w.agent(
      w.member.user,
      `/api/time-entries?workspaceId=${w.workspaceId}&needsReview=true`,
    );
    expect(
      ((await pending.json()) as { data: unknown[] }).data.length,
    ).toBeGreaterThan(0);
    const patched = await w.agent(
      w.member.user,
      `/api/time-entries/${first.id}`,
      {
        method: "PATCH",
        body: { minutes: 120 },
      },
    );
    expect(patched.status).toBe(200);
    const [row] = await db
      .select()
      .from(timeEntryTable)
      .where(eq(timeEntryTable.id, first.id));
    expect(row?.needsReview).toBe(false);
  });

  it("the sweeper stops only timers older than the cap, as a system actor", async () => {
    await start();
    await setTimerStart(
      w.member.personId,
      new Date(Date.now() - 13 * 3_600_000),
    );
    const other = await w.agent(w.other.user, "/api/time-entries/timer/start", {
      method: "POST",
      body: { workspaceId: w.workspaceId, workItemId: w.itemA.id },
    });
    expect(other.status).toBe(200);
    const outcome = await runTimerSweeper();
    expect(outcome.swept).toBe(1);
    const timers = await timerRows(w.workspaceId);
    expect(timers.map((t) => t.personId)).toEqual([w.other.personId]);
    const entries = await entryRows(w.workspaceId);
    expect(entries.reduce((sum, e) => sum + e.minutes, 0)).toBe(720);
    expect(
      entries.every((e) => e.needsReview && e.source === "timer_capped"),
    ).toBe(true);
    const audit = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "time_entry.timer_capped"));
    expect(audit[0]?.actorType).toBe("system");
    // A second run finds nothing to do.
    expect((await runTimerSweeper()).swept).toBe(0);
  });

  it("starting a new timer closes an expired one first instead of refusing", async () => {
    await start();
    await setTimerStart(
      w.member.personId,
      new Date(Date.now() - 14 * 3_600_000),
    );
    expect((await start()).status).toBe(200);
    expect(await timerRows(w.workspaceId)).toHaveLength(1);
    expect(
      (await entryRows(w.workspaceId)).reduce((sum, e) => sum + e.minutes, 0),
    ).toBe(720);
  });
});
