import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

const day = 86_400_000;
const ymd = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

async function arrange() {
  const admin = await createWorkspaceMember({ role: "admin" });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, admin.user.id));
  const workspaceId = admin.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "started",
        group: "started",
      })
      .returning(),
    "template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: template.id,
        isDefault: true,
      })
      .returning(),
    "state",
  );
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({ workspaceId, key: randomUUID(), name: "Impact" })
      .returning(),
    "workflow",
  );
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "Incident",
        category: "service",
        workflowId: workflow.id,
      })
      .returning(),
    "type",
  );
  const { app } = createApp();
  mockAuthenticatedSession({ ...admin.user, role: "admin" });
  const created = await app.request("/api/service-calendars", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      name: "Impact calendar",
      timezone: "UTC",
      windows: { mon: [{ from: 540, to: 1020 }] },
      holidays: [],
    }),
  });
  expect(created.status).toBe(200);
  const calendar = (await created.json()) as { id: string; version: number };
  const policy = requireRow(
    await db
      .insert(schema.slaPolicyTable)
      .values({ workspaceId, name: "Impact policy" })
      .returning(),
    "policy",
  );
  const version = requireRow(
    await db
      .insert(schema.slaPolicyVersionTable)
      .values({
        workspaceId,
        policyId: policy.id,
        calendarId: calendar.id,
        number: 1,
        atRiskThresholdPct: 75,
      })
      .returning(),
    "version",
  );
  let number = 0;
  const item = async (startedDaysAgo: number, resolved: boolean) => {
    number += 1;
    return db.insert(schema.workItemTable).values({
      workspaceId,
      projectId: project.id,
      typeId: type.id,
      stateId: state.id,
      number,
      key: `${project.slug}-${number}`,
      title: `Impact ${number}`,
      priority: "high",
      slaPolicyVersionId: version.id,
      slaStartedAt: new Date(Date.now() - startedDaysAgo * day),
      ...(resolved ? { resolvedAt: new Date() } : {}),
    });
  };
  await item(10, false); // open, started before the holiday: affected
  await item(10, true); // resolved: unaffected
  await item(1, false); // open but started after the holiday: unaffected
  return { app, calendar };
}

describe("API integration: CAL-13 retroactive holiday impact", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("PATCH returns the count of open items a past holiday moves, and only that", async () => {
    const { app, calendar } = await arrange();
    const patch = (holidays: unknown[], version: number) =>
      app.request(`/api/service-calendars/${calendar.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": `"${version}"`,
        },
        body: JSON.stringify({ holidays }),
      });

    const past = await patch([{ date: ymd(-5), name: "Late bank holiday" }], 1);
    expect(past.status).toBe(200);
    const pastBody = (await past.json()) as {
      affectedWorkItemCount: number;
      version: number;
    };
    expect(pastBody.affectedWorkItemCount).toBe(1);

    // The same holiday again changes nothing new; a future one is not counted.
    const same = await patch(
      [
        { date: ymd(-5), name: "Late bank holiday" },
        { date: ymd(30), name: "Planned closure" },
      ],
      pastBody.version,
    );
    expect(same.status).toBe(200);
    expect(
      ((await same.json()) as { affectedWorkItemCount: number })
        .affectedWorkItemCount,
    ).toBe(0);
  });

  it("import returns the count too", async () => {
    const { app, calendar } = await arrange();
    const stamp = ymd(-5).replaceAll("-", "");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TaskDesk//Test//EN",
      "BEGIN:VEVENT",
      "UID:retro@example.test",
      "DTSTAMP:20261003T120000Z",
      `DTSTART;VALUE=DATE:${stamp}`,
      "SUMMARY:Retro",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const response = await app.request(
      `/api/service-calendars/${calendar.id}/holidays/import`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ics }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      importedCount: 1,
      affectedWorkItemCount: 1,
    });
  });
});
