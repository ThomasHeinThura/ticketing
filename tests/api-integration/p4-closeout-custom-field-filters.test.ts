/**
 * CF-10: `cf.<key>` filters in the work-item search / saved-view query language, with reach
 * intact (a filter never widens what the caller may see) and VW-31 refusals for unknown keys.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { customFieldTable } from "../../apps/api/src/database/migration-schema";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";
import {
  makeCustomField,
  setCustomValue,
  workItemWorld,
} from "./helpers/p4-closeout";
import { addMember } from "./helpers/reach-world";

async function world() {
  const actor = await createWorkspaceMember({ role: "owner" });
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  await grantProjectRole(actor.user.id, project.id, [
    "project:read",
    "work_item:read",
  ]);
  const rows = await workItemWorld(actor.workspace.id, project.id);
  const ws = actor.workspace.id;
  const severity = await makeCustomField(ws, rows.type.id, {
    key: "severity",
    format: "select",
    options: [
      { key: "low", label: "Low" },
      { key: "high", label: "High" },
    ],
  });
  const cost = await makeCustomField(ws, rows.type.id, {
    key: "cost",
    format: "number",
  });
  const note = await makeCustomField(ws, rows.type.id, {
    key: "note",
    format: "text",
  });
  const tags = await makeCustomField(ws, rows.type.id, {
    key: "tags",
    format: "multi_select",
    options: [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ],
  });
  const due = await makeCustomField(ws, rows.type.id, {
    key: "review_on",
    format: "date",
  });
  const flag = await makeCustomField(ws, rows.type.id, {
    key: "blocked",
    format: "boolean",
  });
  const first = await rows.makeItem("first");
  const second = await rows.makeItem("second");
  const third = await rows.makeItem("third");
  const put = (field: { id: string }, item: typeof first, value: unknown) =>
    setCustomValue(ws, field.id, item, value);
  await put(severity, first, "high");
  await put(severity, second, "low");
  await put(cost, first, 10);
  await put(cost, second, 250);
  await put(note, first, "Printer on fire");
  await put(note, third, "100% sure_thing");
  await put(tags, first, ["a"]);
  await put(tags, second, ["a", "b"]);
  await put(due, first, "2026-01-10");
  await put(due, second, "2026-03-01");
  await put(flag, third, true);
  mockAuthenticatedSession(actor.user);
  const { app } = createApp();
  async function run(filter: unknown) {
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: ws,
        query: { entity: "work_item", filter },
      }),
    });
    return response;
  }
  async function titles(filter: unknown) {
    const response = await run(filter);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { data: { title: string }[] };
    return body.data.map((row) => row.title).sort();
  }
  return {
    actor,
    project,
    rows,
    ws,
    app,
    run,
    titles,
    fields: { severity, cost, note, tags, due, flag },
    items: { first, second, third },
  };
}

const leaf = (field: string, op: string, value: unknown) => ({
  field: `cf.${field}`,
  op,
  value,
});

describe("CF-10 cf.<key> filters", () => {
  beforeEach(async () => resetTestDatabase());

  it("filters by every supported format and operator", async () => {
    const w = await world();
    expect(await w.titles(leaf("severity", "eq", "high"))).toEqual(["first"]);
    expect(await w.titles(leaf("severity", "in", ["high", "low"]))).toEqual([
      "first",
      "second",
    ]);
    // neq matches items that have a different value or none at all.
    expect(await w.titles(leaf("severity", "neq", "high"))).toEqual([
      "second",
      "third",
    ]);
    expect(await w.titles(leaf("cost", "gt", 20))).toEqual(["second"]);
    expect(await w.titles(leaf("cost", "lte", 10))).toEqual(["first"]);
    expect(await w.titles(leaf("cost", "eq", "250"))).toEqual(["second"]);
    expect(await w.titles(leaf("note", "contains", "printer"))).toEqual([
      "first",
    ]);
    // LIKE wildcards in the value are literals, not patterns.
    expect(await w.titles(leaf("note", "contains", "100%"))).toEqual(["third"]);
    expect(await w.titles(leaf("note", "contains", "%"))).toEqual(["third"]);
    expect(await w.titles(leaf("note", "contains", "_"))).toEqual(["third"]);
    expect(await w.titles(leaf("tags", "contains", "b"))).toEqual(["second"]);
    expect(await w.titles(leaf("tags", "contains", "a"))).toEqual([
      "first",
      "second",
    ]);
    expect(await w.titles(leaf("review_on", "lt", "2026-02-01"))).toEqual([
      "first",
    ]);
    expect(await w.titles(leaf("blocked", "eq", true))).toEqual(["third"]);
    expect(await w.titles(leaf("note", "is_set", true))).toEqual([
      "first",
      "third",
    ]);
    expect(await w.titles(leaf("note", "is_set", false))).toEqual(["second"]);
  });

  it("combines with other filters and groups under AND / OR", async () => {
    const w = await world();
    expect(
      await w.titles({
        op: "or",
        clauses: [leaf("severity", "eq", "low"), leaf("blocked", "eq", true)],
      }),
    ).toEqual(["second", "third"]);
    expect(
      await w.titles({
        op: "and",
        clauses: [leaf("tags", "contains", "a"), leaf("cost", "gt", 20)],
      }),
    ).toEqual(["second"]);
  });

  it("refuses an unknown, deleted or malformed field instead of returning everything", async () => {
    const w = await world();
    const unknown = await w.run(leaf("nope", "eq", "x"));
    expect(unknown.status).toBe(422);
    expect(await unknown.text()).toContain("cf.nope");

    // Soft-deleting the field makes the same query unavailable (saved views re-check at run time).
    await db
      .update(customFieldTable)
      .set({ deletedAt: new Date() })
      .where(eq(customFieldTable.id, w.fields.severity.id));
    expect((await w.run(leaf("severity", "eq", "high"))).status).toBe(422);

    // Operator / value problems are 400, never an empty or unfiltered page.
    expect((await w.run(leaf("cost", "contains", "1"))).status).toBe(400);
    expect((await w.run(leaf("cost", "gt", "abc"))).status).toBe(400);
    expect((await w.run(leaf("tags", "eq", "a"))).status).toBe(400);
    expect((await w.run(leaf("tags", "contains", "zzz"))).status).toBe(400);
    expect((await w.run(leaf("review_on", "lt", "yesterday"))).status).toBe(
      400,
    );
    expect((await w.run(leaf("blocked", "eq", "maybe"))).status).toBe(400);
    expect((await w.run(leaf("bad key!", "eq", "x"))).status).toBe(400);
  });

  it("never matches another workspace's field of the same key and never widens reach", async () => {
    const w = await world();
    // A second workspace defines the same key and holds values on its own item.
    const other = await createWorkspaceMember({ role: "owner" });
    const otherProject = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const otherRows = await workItemWorld(
      other.workspace.id,
      otherProject.project.id,
    );
    const otherField = await makeCustomField(
      other.workspace.id,
      otherRows.type.id,
      {
        key: "severity",
        format: "select",
        options: [{ key: "high", label: "High" }],
      },
    );
    const foreignItem = await otherRows.makeItem("foreign high");
    await setCustomValue(
      other.workspace.id,
      otherField.id,
      foreignItem,
      "high",
    );
    expect(await w.titles(leaf("severity", "eq", "high"))).toEqual(["first"]);

    // A second project in the same workspace the caller has no row on stays invisible.
    const hiddenProject = await createProjectFixture({ workspaceId: w.ws });
    const hiddenRows = await workItemWorld(w.ws, hiddenProject.project.id);
    const hidden = await hiddenRows.makeItem("hidden high");
    await setCustomValue(w.ws, w.fields.severity.id, hidden, "high");
    // The shared type/field visibility is per type: give the field's value to the hidden item.
    expect(await w.titles(leaf("severity", "eq", "high"))).toEqual(["first"]);

    // Another person without any project row sees nothing, whatever the filter says.
    const stranger = await addMember(w.ws, "member");
    mockAuthenticatedSession(stranger.user);
    expect(await w.titles(leaf("severity", "eq", "high"))).toEqual([]);
  });

  it("runs through a saved view and refuses it once the field is gone", async () => {
    const w = await world();
    const [view] = await db
      .insert(schema.savedViewTable)
      .values({
        workspaceId: w.ws,
        name: "High severity",
        scope: "workspace",
        scopeId: w.ws,
        visibility: "workspace",
        layout: "list",
        query: {
          entity: "work_item",
          filter: leaf("severity", "eq", "high"),
        },
        createdBy: await personOf(w.actor.user.id),
      })
      .returning();
    if (!view) throw new Error("view insert failed");
    const run = await w.app.request(`/api/views/${view.id}/run`, {
      method: "POST",
    });
    expect(run.status, await run.clone().text()).toBe(200);
    expect(
      ((await run.json()) as { data: { title: string }[] }).data.map(
        (row) => row.title,
      ),
    ).toEqual(["first"]);
    await db
      .update(customFieldTable)
      .set({ deletedAt: new Date() })
      .where(eq(customFieldTable.id, w.fields.severity.id));
    expect(
      (await w.app.request(`/api/views/${view.id}/run`, { method: "POST" }))
        .status,
    ).toBe(422);
  });
});

async function personOf(userId: string) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId));
  if (!person) throw new Error("person missing");
  return person.id;
}
