/**
 * TC-20..TC-22: per-person available hours (API, permissions, tenant isolation), utilisation and
 * capacity reports that use them with a documented team-capacity fallback, the reach rule for who
 * a capacity row may list (R6-06), the own-time restriction of the cost-to-deliver budget
 * subqueries (R6-05) and capacity staying out of assignment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { availableHoursTable } from "../../apps/api/src/database/schema-p5-time";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resolveWindow } from "../../apps/api/src/report/logic";
import { reportByKey } from "../../apps/api/src/report/registry";
import { runReport } from "../../apps/api/src/report/run";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, grantProjectRole } from "./helpers/fixtures";
import { makeTeam } from "./helpers/p4-closeout";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";
import { isoDaysAgo, setTimeFlags } from "./helpers/p5-time";

let w: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await reportsWorld();
  // Project routes evaluate the project role, which overrides the workspace role for that project.
  await grantProjectRole(w.owner.user.id, w.projectA.id, [
    "time_entry:manage_rates",
  ]);
});

type User = Parameters<ReportsWorld["agent"]>[0];
type Hours = {
  data: Array<{
    id: string;
    personId: string;
    minutesPerWeek: number;
    effectiveFrom: string;
  }>;
  canManage: boolean;
  people: Array<{ personId: string; name: string }>;
  callerPersonId: string;
};

function setHours(
  user: User,
  personId: string,
  minutesPerWeek: number,
  effectiveFrom: string,
  workspaceId = w.workspaceId,
) {
  return w.agent(user, "/api/available-hours", {
    method: "POST",
    body: { workspaceId, personId, minutesPerWeek, effectiveFrom },
  });
}
async function readHours(user: User, query = "", workspaceId = w.workspaceId) {
  const response = await w.agent(
    user,
    `/api/available-hours?workspaceId=${workspaceId}${query}`,
  );
  const text = await response.clone().text();
  let body = {} as Hours;
  try {
    body = JSON.parse(text) as Hours;
  } catch {
    // A refusal is plain text.
  }
  return { response, body };
}

describe("available hours API (TC-20)", () => {
  it("lets a settings manager set hours with effective dates and read everyone's", async () => {
    expect(
      (await setHours(w.owner.user, w.member.personId, 2400, "2026-01-01"))
        .status,
    ).toBe(201);
    expect(
      (await setHours(w.owner.user, w.member.personId, 1200, "2026-06-01"))
        .status,
    ).toBe(201);
    await setHours(w.owner.user, w.other.personId, 1800, "2026-01-01");
    const { body } = await readHours(w.owner.user);
    expect(body.canManage).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.people.length).toBeGreaterThan(2);
    const one = await readHours(w.owner.user, `&personId=${w.member.personId}`);
    expect(one.body.data.map((row) => row.effectiveFrom)).toEqual([
      "2026-06-01",
      "2026-01-01",
    ]);
  });

  it("refuses a second row on the same date, a foreign person and an out-of-range value", async () => {
    await setHours(w.owner.user, w.member.personId, 2400, "2026-01-01");
    expect(
      (await setHours(w.owner.user, w.member.personId, 600, "2026-01-01"))
        .status,
    ).toBe(409);
    expect(
      (await setHours(w.owner.user, w.member.personId, 20_000, "2026-02-01"))
        .status,
    ).toBe(400);
    expect(
      (await setHours(w.owner.user, w.member.personId, 24.5, "2026-02-01"))
        .status,
    ).toBe(400);
    const foreign = await createWorkspaceMember({ role: "owner" });
    const foreignPerson = (
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, foreign.user.id))
    )[0];
    expect(
      (
        await setHours(
          w.owner.user,
          foreignPerson?.id ?? "missing",
          600,
          "2026-02-01",
        )
      ).status,
    ).toBe(404);
  });

  it("gives a member only their own rows and refuses everyone else's and every write", async () => {
    await setHours(w.owner.user, w.member.personId, 2400, "2026-01-01");
    await setHours(w.owner.user, w.other.personId, 1800, "2026-01-01");
    const own = await readHours(w.member.user);
    expect(own.body.canManage).toBe(false);
    expect(own.body.data.map((row) => row.personId)).toEqual([
      w.member.personId,
    ]);
    expect(own.body.people).toEqual([]);
    expect(
      (await readHours(w.member.user, `&personId=${w.other.personId}`)).response
        .status,
    ).toBe(403);
    for (const user of [w.member.user, w.lead.user, w.viewer.user])
      expect(
        (await setHours(user, w.member.personId, 100, "2026-03-01")).status,
      ).toBe(403);
    // time_entry:read_any (the lead) may read another person's row but still not write.
    expect(
      (await readHours(w.lead.user, `&personId=${w.other.personId}`)).response
        .status,
    ).toBe(200);
  });

  it("never crosses tenants and is switched off with time tracking", async () => {
    await setHours(w.owner.user, w.member.personId, 2400, "2026-01-01");
    expect((await readHours(w.stranger.user)).response.status).toBe(403);
    expect(
      (await readHours(w.stranger.user, "", w.stranger.workspace.id)).body.data,
    ).toEqual([]);
    expect(
      (
        await setHours(
          w.stranger.user,
          w.member.personId,
          100,
          "2026-03-01",
          w.stranger.workspace.id,
        )
      ).status,
    ).toBe(404);
    await setTimeFlags(w.workspaceId, { time: false });
    expect((await readHours(w.owner.user)).response.status).toBe(409);
    expect(
      (await setHours(w.owner.user, w.member.personId, 100, "2026-03-01"))
        .status,
    ).toBe(409);
  });
});

async function logFor(
  personId: string,
  date: string,
  minutes: number,
  workItemId = w.itemA.id,
) {
  const response = await w.logTime(
    w.owner.user,
    { date, minutes, personId },
    workItemId,
  );
  expect(response.status, await response.clone().text()).toBe(201);
}

describe("utilisation and capacity reports use available hours (TC-21, TC-22)", () => {
  const WINDOW = "&window=custom&from=2026-01-05&to=2026-01-18";

  it("divides logged hours by the person's own available hours, following the effective dates", async () => {
    await setHours(w.owner.user, w.member.personId, 2400, "2025-12-01");
    await setHours(w.owner.user, w.member.personId, 1200, "2026-01-12");
    await logFor(w.member.personId, "2026-01-06", 360);
    const { body } = await w.report(w.owner.user, "utilisation", WINDOW);
    const row = body.rows.find((entry) => entry.available === 60);
    // 7 days at 40 h/week plus 7 days at 20 h/week = 60 h; 6 h logged = 10%.
    expect(row?.logged).toBe(6);
    expect(row?.utilisation).toBe(10);
    expect(body.notes).not.toContain("assumes_eight_hour_day");
    expect(body.notes).not.toContain("available_hours_fallback");
  });

  it("prefers available hours over team capacity and falls back to the team with a note", async () => {
    const team = await makeTeam(w.workspaceId, [
      w.member.user.id,
      w.other.user.id,
    ]);
    await db
      .update(schema.teamTable)
      .set({ capacityDaysPerWeek: "5" })
      .where(eq(schema.teamTable.id, team.id));
    await setHours(w.owner.user, w.member.personId, 1200, "2025-12-01");
    await logFor(w.member.personId, "2026-01-06", 60);
    await logFor(w.other.personId, "2026-01-06", 120);
    const { body } = await w.report(w.owner.user, "utilisation", WINDOW);
    const available = body.rows.map((row) => row.available).sort();
    // member: own 20 h/week x 2 weeks = 40 h; other: team 5 days x 8 h x 2 weeks = 80 h.
    expect(available).toEqual([40, 80]);
    expect(body.notes).toContain("assumes_eight_hour_day");
    expect(body.notes).toContain("available_hours_fallback");
  });

  it("says when neither available hours nor team capacity exist and never divides by zero", async () => {
    await logFor(w.member.personId, "2026-01-06", 60);
    const { body } = await w.report(w.owner.user, "utilisation", WINDOW);
    const row = body.rows[0];
    expect(row?.available).toBeNull();
    // No denominator: the cell carries its sample rule, never a number or a division by zero.
    expect(typeof row?.utilisation).not.toBe("number");
    expect(body.notes).toContain("no_capacity_set");
    await setHours(w.owner.user, w.member.personId, 0, "2025-12-01");
    const zero = await w.report(w.owner.user, "utilisation", WINDOW);
    expect(zero.response.status).toBe(200);
    expect(typeof zero.body.rows[0]?.utilisation).not.toBe("number");
  });

  it("builds team capacity from each member's available hours, scaled by allocation", async () => {
    const team = await makeTeam(w.workspaceId, [
      w.member.user.id,
      w.other.user.id,
    ]);
    await db
      .update(schema.teamMemberTable)
      .set({ allocationPct: 50 })
      .where(eq(schema.teamMemberTable.userId, w.other.user.id));
    await setHours(w.owner.user, w.member.personId, 2400, "2025-12-01");
    await setHours(w.owner.user, w.other.personId, 2400, "2025-12-01");
    await logFor(w.member.personId, "2026-01-06", 120);
    const { body } = await w.report(w.owner.user, "capacity", WINDOW);
    const row = body.rows.find((entry) => entry.team === team.name);
    // 2 weeks x (40 h + 40 h x 50%) = 120 h.
    expect(row?.capacity).toBe(120);
    expect(row?.logged).toBe(2);
    expect(body.notes).not.toContain("available_hours_fallback");
  });

  it("does not reveal another member's individual hours to a caller without time_entry:read_any (R7-04)", async () => {
    const team = await makeTeam(w.workspaceId, [
      w.member.user.id,
      w.other.user.id,
    ]);
    await db
      .update(schema.teamTable)
      .set({ capacityDaysPerWeek: "5" })
      .where(eq(schema.teamTable.id, team.id));
    // The other member's own figure (20 h/week) is individual data; the team fallback is 40 h/week.
    await setHours(w.owner.user, w.other.personId, 1200, "2025-12-01");
    const rowOf = async (user: User) =>
      (await w.report(user, "capacity", WINDOW)).body.rows.find(
        (entry) => entry.team === team.name,
      );
    // read_any holder: member falls back (80 h) + other's own 40 h = 120 h.
    expect((await rowOf(w.owner.user))?.capacity).toBe(120);
    // The member (no read_any) sees the documented fallback for the other person: 80 h + 80 h.
    expect((await rowOf(w.member.user))?.capacity).toBe(160);
  });

  it("limits a caller without time_entry:read_any to their own row", async () => {
    await setHours(w.owner.user, w.member.personId, 2400, "2025-12-01");
    await setHours(w.owner.user, w.other.personId, 2400, "2025-12-01");
    const { body } = await w.report(w.member.user, "utilisation", WINDOW);
    expect(body.rows.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(body.rows)).not.toContain("Unknown");
  });
});

describe("who a capacity row may list (R6-06)", () => {
  const WINDOW = "&window=custom&from=2026-01-05&to=2026-01-18";

  it("hides people and teams outside the caller's reach until a reachable project is owned by their team", async () => {
    const team = await makeTeam(w.workspaceId, [
      w.member.user.id,
      w.other.user.id,
    ]);
    await db
      .update(schema.teamTable)
      .set({ capacityDaysPerWeek: "5" })
      .where(eq(schema.teamTable.id, team.id));
    await setHours(w.owner.user, w.member.personId, 2400, "2025-12-01");
    const rowsOf = async (user: User, key: string) =>
      (await w.report(user, key, WINDOW)).body.rows;
    // The lead reads anyone's time but does not belong to the team and the team owns nothing
    // the lead reaches: neither the team nor its members appear.
    expect(await rowsOf(w.lead.user, "utilisation")).toHaveLength(0);
    expect(
      (await rowsOf(w.lead.user, "capacity")).map((row) => row.team),
    ).not.toContain(team.name);
    // report:read_all (the owner) lists the team and both members.
    expect(await rowsOf(w.owner.user, "utilisation")).toHaveLength(2);
    expect(
      (await rowsOf(w.owner.user, "capacity")).map((row) => row.team),
    ).toContain(team.name);
    // The team owns project A, which the lead reaches: now it is visible.
    await db
      .update(schema.projectTable)
      .set({ ownerTeamId: team.id })
      .where(eq(schema.projectTable.id, w.projectA.id));
    expect(await rowsOf(w.lead.user, "utilisation")).toHaveLength(2);
    expect(
      (await rowsOf(w.lead.user, "capacity")).map((row) => row.team),
    ).toContain(team.name);
  });

  it("lists a team the caller belongs to", async () => {
    const team = await makeTeam(w.workspaceId, [
      w.lead.user.id,
      w.other.user.id,
    ]);
    await db
      .update(schema.teamTable)
      .set({ capacityDaysPerWeek: "4" })
      .where(eq(schema.teamTable.id, team.id));
    const rows = (await w.report(w.lead.user, "capacity", WINDOW)).body.rows;
    expect(rows.map((row) => row.team)).toContain(team.name);
  });
});

describe("cost to deliver budget subqueries respect own-time (R6-05)", () => {
  it("counts only the caller's own time and cost entries when they may not read anyone's", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(60), 6000, "EUR");
    await w.addRate(w.other.personId, isoDaysAgo(60), 6000, "EUR");
    await w.agent(w.owner.user, `/api/projects/${w.projectA.id}/budgets`, {
      method: "POST",
      body: {
        name: "Q4",
        plannedAmountMinor: 100_000,
        currency: "EUR",
        periodStart: isoDaysAgo(30),
        periodEnd: isoDaysAgo(-30),
      },
    });
    for (const user of [w.member.user, w.other.user])
      expect(
        (await w.logTime(user, { date: isoDaysAgo(1), minutes: 60 })).status,
      ).toBe(201);
    const type = (await (
      await w.agent(w.owner.user, "/api/cost-types", {
        method: "POST",
        body: {
          workspaceId: w.workspaceId,
          name: "Licence",
          unit: "seat",
          defaultRateMinor: 1000,
          currency: "EUR",
        },
      })
    ).json()) as { id: string };
    const cost = await w.agent(
      w.owner.user,
      `/api/projects/${w.projectA.id}/costs`,
      {
        method: "POST",
        body: {
          costTypeId: type.id,
          date: isoDaysAgo(0),
          units: 3,
          personId: w.other.personId,
        },
      },
    );
    expect(cost.status, await cost.clone().text()).toBe(201);
    const identity = await resolveIdentity({
      userId: w.member.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("identity missing");
    const definition = reportByKey("cost_to_deliver");
    if (!definition) throw new Error("report missing");
    const window = resolveWindow({ window: "30" }, new Date());
    if (!window.ok) throw new Error("window");
    const run = (readAnyTime: boolean) =>
      runReport({
        def: definition,
        workspaceId: w.workspaceId,
        identity,
        caps: { readAll: true, showRates: true, readAnyTime },
        window: window.window,
        filters: {},
        snapshots: false,
      });
    const own = await run(false);
    const everyone = await run(true);
    const row = (body: Awaited<ReturnType<typeof run>>) =>
      body.rows.find((entry) => entry.budget === "Q4");
    // Own: the member's 60 minutes only (6000), none of the other person's time or cost entry.
    expect(row(own)?.actual).toBe(6000);
    expect(row(own)?.hours).toBe(1);
    // Everyone: both people's time (12000) plus the cost entry (3000).
    expect(row(everyone)?.actual).toBe(15_000);
    expect(row(everyone)?.hours).toBe(2);
  });

  it("matches the budget view to the minor unit (same per-entry rounding, cost entries included)", async () => {
    await w.addRate(w.member.personId, isoDaysAgo(60), 90, "EUR");
    await w.agent(w.owner.user, `/api/projects/${w.projectA.id}/budgets`, {
      method: "POST",
      body: {
        name: "Round",
        plannedAmountMinor: 100_000,
        currency: "EUR",
        periodStart: isoDaysAgo(30),
        periodEnd: isoDaysAgo(-30),
      },
    });
    for (const minutes of [1, 1, 1])
      await w.logTime(w.member.user, { date: isoDaysAgo(1), minutes });
    const budget = (await (
      await w.agent(w.owner.user, `/api/projects/${w.projectA.id}/budget`)
    ).json()) as { data: Array<{ name: string; actualMinor: number }> };
    const reported = await w.report(
      w.owner.user,
      "cost_to_deliver",
      "&window=30",
    );
    const row = reported.body.rows.find((entry) => entry.budget === "Round");
    // One minute at 90 per hour is 1.5, which rounds half up to 2 per entry: three entries are 6.
    expect(budget.data[0]?.actualMinor).toBe(6);
    expect(row?.actual).toBe(6);
  });
});

describe("capacity is for reporting, not assignment (TC-22)", () => {
  it("is read only by the time module, the capacity reports and the migration", () => {
    const root = join(__dirname, "../../apps/api/src");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (
          path.endsWith(".ts") &&
          /available_hours|availableHoursTable/.test(readFileSync(path, "utf8"))
        )
          hits.push(path.slice(root.length + 1));
      }
    };
    walk(root);
    // Schema, audit action name, legal-hold fence, the pure maths comment and repository of the
    // time module, and the two capacity reports: no work-item, assignment or scheduler code.
    expect(hits.sort()).toEqual([
      "audit/actions.ts",
      "database/schema-p5-time.ts",
      "report/reports/people.ts",
      "time-tracking/cost-logic.ts",
      "time-tracking/cost-repository.ts",
      "utils/legal-hold-scope.ts",
    ]);
  });

  it("keeps the table's person and effective-date rows intact after reports run", async () => {
    await setHours(w.owner.user, w.member.personId, 2400, "2026-01-01");
    await w.report(w.owner.user, "utilisation", "&window=30");
    expect(await db.select().from(availableHoursTable)).toHaveLength(1);
  });
});
