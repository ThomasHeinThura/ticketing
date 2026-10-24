/**
 * P5 time and cost, entries: logging (TC-1..TC-3), the backdating window (TC-4), own versus any
 * (TC-5), deletion through the pending-action flow, reach, tenant isolation and the feature gate.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  timeActivityTable,
  timeEntryTable,
} from "../../apps/api/src/database/schema-p5-time";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import {
  auditActionsOf,
  entryRows,
  isoDaysAgo,
  setProjectTimeFlag,
  setTimeFlags,
  type TimeWorld,
  timeWorld,
} from "./helpers/p5-time";
import {
  approvePendingDeletion,
  ensureAgentSession,
  type PendingDeletionBody,
} from "./helpers/pending-deletion";

let w: TimeWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await timeWorld();
});

type Entry = {
  id: string;
  minutes: number;
  billable: boolean;
  personId: string;
  activityName: string;
  workItemKey: string | null;
  rate?: {
    rateMinor: number | null;
    currency: string | null;
    costMinor: number | null;
  };
};

async function log(
  user: Parameters<TimeWorld["logTime"]>[0],
  overrides: Record<string, unknown> = {},
  workItemId?: string,
) {
  const response = await w.logTime(user, overrides, workItemId);
  const text = await response.clone().text();
  return {
    response,
    text,
    entry: response.ok ? ((await response.json()) as Entry) : null,
  };
}

describe("logging time (TC-1..TC-3)", () => {
  it("records integer minutes against the caller, with the activity and project billable default", async () => {
    const { response, entry } = await log(w.member.user);
    expect(response.status).toBe(201);
    expect(entry?.minutes).toBe(90);
    expect(Number.isInteger(entry?.minutes)).toBe(true);
    expect(entry?.personId).toBe(w.member.personId);
    expect(entry?.activityName).toBe("Development");
    expect(entry?.workItemKey).toBe(w.itemA.key);
    expect(entry?.billable).toBe(true);
    expect(await auditActionsOf(w.workspaceId)).toContain("time_entry.created");
  });

  it("defaults billable from the project and lets the caller override it", async () => {
    await db
      .update(schema.projectTable)
      .set({ defaultBillable: false })
      .where(eq(schema.projectTable.id, w.projectA.id));
    expect((await log(w.member.user)).entry?.billable).toBe(false);
    expect((await log(w.member.user, { billable: true })).entry?.billable).toBe(
      true,
    );
  });

  it("rejects fractional, zero and over-a-day minutes, a missing activity and a foreign activity", async () => {
    for (const minutes of [0.5, 0, -5, 1441]) {
      expect((await log(w.member.user, { minutes })).response.status).toBe(400);
    }
    expect(
      (await log(w.member.user, { activityId: undefined })).response.status,
    ).toBe(400);
    const stranger = await createWorkspaceMember({ role: "owner" });
    const [foreign] = await db
      .insert(timeActivityTable)
      .values({ workspaceId: stranger.workspace.id, name: "Elsewhere" })
      .returning();
    const { response } = await log(w.member.user, {
      activityId: foreign?.id ?? "missing",
    });
    expect(response.status).toBe(422);
    expect(
      (await log(w.member.user, { activityId: "no-such-activity" })).response
        .status,
    ).toBe(422);
  });

  it("logs for someone else only with time_entry:update_any", async () => {
    const forOther = { personId: w.other.personId };
    expect((await log(w.member.user, forOther)).response.status).toBe(403);
    const { response, entry } = await log(w.owner.user, forOther);
    expect(response.status).toBe(201);
    expect(entry?.personId).toBe(w.other.personId);
  });

  it("refuses a viewer (no time_entry:create)", async () => {
    expect((await log(w.viewer.user)).response.status).toBe(403);
    expect(await entryRows(w.workspaceId)).toHaveLength(0);
  });

  it("is gated by feature.time_tracking", async () => {
    await setTimeFlags(w.workspaceId, { time: false });
    const { response, text } = await log(w.member.user);
    expect(response.status).toBe(409);
    expect(text).toContain("feature_disabled");
  });
});

describe("a project-level switch inside a workspace that has the feature on", () => {
  it("refuses logging, a timer and moving an entry onto a project with time tracking off", async () => {
    const { entry } = await log(w.member.user);
    await setProjectTimeFlag(w.projectA.id, "feature.time_tracking", false);
    const refused = await log(w.member.user);
    expect(refused.response.status).toBe(409);
    expect(refused.text).toContain("feature_disabled");
    const timer = await w.agent(
      w.member.user,
      "/api/time-entries/timer/start",
      {
        method: "POST",
        body: { workspaceId: w.workspaceId, workItemId: w.itemA.id },
      },
    );
    expect(timer.status).toBe(409);
    // Another project in the same workspace is unaffected, and a move onto the off project is refused.
    const ownerEntry = await log(w.owner.user, {}, w.itemB.id);
    const move = await w.agent(
      w.owner.user,
      `/api/time-entries/${ownerEntry.entry?.id}`,
      {
        method: "PATCH",
        body: { workItemId: w.itemA.id },
      },
    );
    expect(move.status).toBe(409);
    expect(await entryRows(w.workspaceId)).toHaveLength(2);
    void entry;
  });
});

describe("time settings (TC-3, TC-4)", () => {
  const patch = (user: Parameters<TimeWorld["agent"]>[0], body: unknown) =>
    w.agent(user, "/api/time-settings", { method: "PATCH", body });

  it("lets a settings manager change the backdating limit and the project billable default", async () => {
    const changed = await patch(w.owner.user, {
      workspaceId: w.workspaceId,
      backdateLimitDays: 5,
      project: { id: w.projectA.id, defaultBillable: false },
    });
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(await w.json(changed)).toMatchObject({
      backdateLimitDays: 5,
      project: { id: w.projectA.id, defaultBillable: false },
    });
    expect(
      (await log(w.member.user, { date: isoDaysAgo(5) })).entry?.billable,
    ).toBe(false);
    expect(
      (await log(w.member.user, { date: isoDaysAgo(6) })).response.status,
    ).toBe(422);
    expect(await auditActionsOf(w.workspaceId)).toContain(
      "time_settings.updated",
    );
  });

  it("shows the settings to anyone who logs time and refuses changes without workspace:manage_settings", async () => {
    const read = await w.agent(
      w.member.user,
      `/api/time-settings?workspaceId=${w.workspaceId}&projectId=${w.projectA.id}`,
    );
    expect(await w.json(read)).toMatchObject({
      backdateLimitDays: 30,
      canManage: false,
      project: { id: w.projectA.id, defaultBillable: true },
    });
    const refused = await patch(w.member.user, {
      workspaceId: w.workspaceId,
      backdateLimitDays: 1,
    });
    expect(refused.status).toBe(403);
    expect(
      (
        await w.json(
          await w.agent(
            w.owner.user,
            `/api/time-settings?workspaceId=${w.workspaceId}`,
          ),
        )
      ).backdateLimitDays,
    ).toBe(30);
  });

  it("refuses a limit out of range, an empty change and a project the caller cannot reach", async () => {
    expect(
      (
        await patch(w.owner.user, {
          workspaceId: w.workspaceId,
          backdateLimitDays: -1,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await patch(w.owner.user, {
          workspaceId: w.workspaceId,
          backdateLimitDays: 4000,
        })
      ).status,
    ).toBe(400);
    expect(
      (await patch(w.owner.user, { workspaceId: w.workspaceId })).status,
    ).toBe(400);
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const foreign = await patch(stranger.user, {
      workspaceId: stranger.workspace.id,
      project: { id: w.projectA.id, defaultBillable: false },
    });
    expect(foreign.status).toBe(404);
  });
});

describe("the backdating window (TC-4)", () => {
  it("refuses a date older than the workspace limit without time_entry:log_backdated", async () => {
    const { response, text } = await log(w.member.user, {
      date: isoDaysAgo(40),
    });
    expect(response.status).toBe(422);
    expect(text).toContain("date_too_old");
    expect(
      (await log(w.member.user, { date: isoDaysAgo(25) })).response.status,
    ).toBe(201);
  });

  it("lets a holder of time_entry:log_backdated go further back", async () => {
    expect(
      (await log(w.lead.user, { date: isoDaysAgo(200) })).response.status,
    ).toBe(201);
  });

  it("honours a per-workspace limit", async () => {
    await db
      .update(schema.workspaceTable)
      .set({ timeEntryBackdateLimitDays: 2 })
      .where(eq(schema.workspaceTable.id, w.workspaceId));
    expect(
      (await log(w.member.user, { date: isoDaysAgo(2) })).response.status,
    ).toBe(201);
    expect(
      (await log(w.member.user, { date: isoDaysAgo(3) })).response.status,
    ).toBe(422);
  });

  it("refuses the future for everyone", async () => {
    const future = new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect((await log(w.member.user, { date: future })).response.status).toBe(
      422,
    );
    expect((await log(w.lead.user, { date: future })).response.status).toBe(
      422,
    );
  });
});

describe("own versus any (TC-5)", () => {
  it("lets a person edit their own entry and not anyone else's", async () => {
    const { entry } = await log(w.member.user);
    const patch = (user: Parameters<TimeWorld["agent"]>[0], body: unknown) =>
      w.agent(user, `/api/time-entries/${entry?.id}`, {
        method: "PATCH",
        body,
      });
    const own = await patch(w.member.user, {
      minutes: 45,
      description: "fixed",
    });
    expect(own.status).toBe(200);
    expect(((await own.json()) as Entry).minutes).toBe(45);
    expect((await patch(w.other.user, { minutes: 10 })).status).toBe(403);
    expect((await patch(w.owner.user, { minutes: 20 })).status).toBe(200);
    const [row] = await db
      .select()
      .from(timeEntryTable)
      .where(eq(timeEntryTable.id, entry?.id ?? ""));
    expect(row?.minutes).toBe(20);
  });

  it("closes entries older than the backdating window to editing, for everyone without log_backdated", async () => {
    const { entry } = await log(w.member.user);
    await db
      .update(timeEntryTable)
      .set({ date: isoDaysAgo(60) })
      .where(eq(timeEntryTable.id, entry?.id ?? ""));
    const patch = (user: Parameters<TimeWorld["agent"]>[0]) =>
      w.agent(user, `/api/time-entries/${entry?.id}`, {
        method: "PATCH",
        body: { minutes: 15 },
      });
    const refused = await patch(w.member.user);
    expect(refused.status).toBe(422);
    expect(await refused.text()).toContain("date_too_old");
    expect((await patch(w.owner.user)).status).toBe(200);
  });

  it("shows a person their own entries only, and read_any holders everyone's", async () => {
    await log(w.member.user, { minutes: 30 });
    await log(w.other.user, { minutes: 60 });
    const list = async (user: Parameters<TimeWorld["agent"]>[0], query = "") =>
      w.agent(user, `/api/time-entries?workspaceId=${w.workspaceId}${query}`);
    const mine = (await (await list(w.member.user)).json()) as {
      data: Entry[];
      totalMinutes: number;
    };
    expect(mine.data.map((e) => e.personId)).toEqual([w.member.personId]);
    expect(mine.totalMinutes).toBe(30);
    expect(
      (await list(w.member.user, `&person=${w.other.personId}`)).status,
    ).toBe(403);
    expect((await list(w.member.user, "&person=all")).status).toBe(403);
    const all = (await (await list(w.lead.user, "&person=all")).json()) as {
      data: Entry[];
    };
    expect(all.data).toHaveLength(2);
    expect(
      (await list(w.lead.user, `&person=${w.other.personId}`)).status,
    ).toBe(200);
  });

  it("filters by date range and work item", async () => {
    await log(w.member.user, { date: isoDaysAgo(5), minutes: 10 });
    await log(w.member.user, { date: isoDaysAgo(1), minutes: 20 });
    await log(w.member.user, { minutes: 30 }, w.childItem.id);
    const body = async (query: string) =>
      (await (
        await w.agent(
          w.member.user,
          `/api/time-entries?workspaceId=${w.workspaceId}${query}`,
        )
      ).json()) as { data: Entry[]; totalMinutes: number };
    expect((await body(`&from=${isoDaysAgo(2)}`)).totalMinutes).toBe(50);
    expect((await body(`&workItemId=${w.childItem.id}`)).totalMinutes).toBe(30);
  });
});

describe("deleting an entry goes through a pending action", () => {
  async function requestDelete(
    user: Parameters<TimeWorld["agent"]>[0],
    id: string,
  ) {
    await ensureAgentSession(user.id);
    return w.agent(user, `/api/time-entries/${id}`, { method: "DELETE" });
  }

  it("answers 202, keeps the entry until the requester approves, then removes it", async () => {
    const { entry } = await log(w.member.user);
    const response = await requestDelete(w.member.user, entry?.id ?? "");
    expect(response.status, await response.clone().text()).toBe(202);
    const pending = (await response.json()) as PendingDeletionBody;
    expect(await entryRows(w.workspaceId)).toHaveLength(1);
    const approved = await approvePendingDeletion(
      w.app,
      w.member.user.id,
      pending,
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(await entryRows(w.workspaceId)).toHaveLength(0);
    expect(await auditActionsOf(w.workspaceId)).toContain("time_entry.deleted");
  });

  for (const scope of ["person", "organisation"] as const) {
    it(`an open ${scope} hold refuses the approved deletion with 409 legal_hold and keeps the entry`, async () => {
      const { entry } = await log(w.member.user);
      const pending = (await (
        await requestDelete(w.member.user, entry?.id ?? "")
      ).json()) as PendingDeletionBody;
      const [hold] = await db
        .insert(schema.legalHoldTable)
        .values({
          scope,
          scopeId:
            scope === "person"
              ? w.member.personId
              : ((
                  await db
                    .select({ id: schema.workspaceTable.organisationId })
                    .from(schema.workspaceTable)
                    .where(eq(schema.workspaceTable.id, w.workspaceId))
                )[0]?.id ?? ""),
          placedBy: "compliance-officer",
          reason: "litigation",
        })
        .returning();
      const refused = await approvePendingDeletion(
        w.app,
        w.member.user.id,
        pending,
      );
      expect(refused.status, await refused.clone().text()).toBe(409);
      expect(await refused.text()).toContain("legal_hold");
      expect(await entryRows(w.workspaceId)).toHaveLength(1);
      // The same hold also refuses a fresh request up front.
      const upFront = await requestDelete(w.member.user, entry?.id ?? "");
      expect(upFront.status).toBe(409);
      expect(await upFront.text()).toContain("legal_hold");
      await db
        .update(schema.legalHoldTable)
        .set({ liftedAt: new Date(), liftedBy: "compliance-officer" })
        .where(eq(schema.legalHoldTable.id, hold?.id ?? ""));
      // The refused approval left the action pending; it goes through once the hold is lifted.
      const approved = await approvePendingDeletion(
        w.app,
        w.member.user.id,
        pending,
      );
      expect(approved.status, await approved.clone().text()).toBe(200);
      expect(await entryRows(w.workspaceId)).toHaveLength(0);
    });
  }

  it("refuses to delete someone else's entry without delete_any", async () => {
    const { entry } = await log(w.member.user);
    expect((await requestDelete(w.other.user, entry?.id ?? "")).status).toBe(
      403,
    );
    expect((await requestDelete(w.owner.user, entry?.id ?? "")).status).toBe(
      202,
    );
    expect(await entryRows(w.workspaceId)).toHaveLength(1);
  });
});

describe("reach and tenant isolation", () => {
  it("never lets someone log against, or see time on, a project they cannot reach", async () => {
    expect((await log(w.member.user, {}, w.itemB.id)).response.status).toBe(
      404,
    );
    const ownerEntry = await log(w.owner.user, {}, w.itemB.id);
    expect(ownerEntry.response.status).toBe(201);
    const list = (await (
      await w.agent(
        w.lead.user,
        `/api/time-entries?workspaceId=${w.workspaceId}&person=all`,
      )
    ).json()) as { data: Entry[] };
    expect(list.data).toHaveLength(0);
    expect(
      (
        await w.agent(
          w.lead.user,
          `/api/time-entries/${ownerEntry.entry?.id}`,
          {
            method: "PATCH",
            body: { minutes: 5 },
          },
        )
      ).status,
    ).toBe(404);
  });

  it("answers 404, not 403, for another workspace's entry", async () => {
    const { entry } = await log(w.member.user);
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const patch = await w.agent(
      stranger.user,
      `/api/time-entries/${entry?.id}`,
      {
        method: "PATCH",
        body: { minutes: 1 },
      },
    );
    expect(patch.status).toBe(404);
    const del = await w.agent(stranger.user, `/api/time-entries/${entry?.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    expect((await entryRows(w.workspaceId))[0]?.minutes).toBe(90);
  });

  it("refuses another workspace's id on list and create", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const list = await w.agent(
      stranger.user,
      `/api/time-entries?workspaceId=${w.workspaceId}`,
    );
    expect([403, 404]).toContain(list.status);
    const create = await w.agent(stranger.user, "/api/time-entries", {
      method: "POST",
      body: {
        workspaceId: w.workspaceId,
        workItemId: w.itemA.id,
        date: isoDaysAgo(0),
        minutes: 10,
        activityId: w.dev.id,
      },
    });
    expect([403, 404]).toContain(create.status);
    expect(await entryRows(w.workspaceId)).toHaveLength(0);
  });

  it("does not let a work item of another workspace be logged against through your own", async () => {
    const stranger = await createWorkspaceMember({ role: "owner" });
    await setTimeFlags(stranger.workspace.id);
    const create = await w.agent(stranger.user, "/api/time-entries", {
      method: "POST",
      body: {
        workspaceId: stranger.workspace.id,
        workItemId: w.itemA.id,
        date: isoDaysAgo(0),
        minutes: 10,
        activityId: w.dev.id,
      },
    });
    expect(create.status).toBe(404);
  });
});

describe("a deleted work item keeps its time against the project", () => {
  it("nulls the work item and retains the entry", async () => {
    const { entry } = await log(w.member.user, {}, w.childItem.id);
    await db
      .delete(schema.workItemTable)
      .where(eq(schema.workItemTable.id, w.childItem.id));
    const [row] = await db
      .select()
      .from(timeEntryTable)
      .where(eq(timeEntryTable.id, entry?.id ?? ""));
    expect(row?.workItemId).toBeNull();
    expect(row?.projectId).toBe(w.projectA.id);
  });
});
