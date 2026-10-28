import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../apps/api/src/database/migration-schema";
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

describe("work-item search custom columns (VW-19, VW-22, CF-3, CF-6, CF-10)", () => {
  beforeEach(async () => resetTestDatabase());

  it("projects selected live definitions and only row-visible values in one page", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "work_item:read",
      "work_item:update",
    ]);
    const items = await workItemWorld(owner.workspace.id, project.id);
    const severity = await makeCustomField(owner.workspace.id, items.type.id, {
      key: "severity",
      name: "Severity",
      format: "select",
      options: [
        { key: "low", label: "Low" },
        { key: "high", label: "High" },
      ],
    });
    const conditional = await makeCustomField(
      owner.workspace.id,
      items.type.id,
      { key: "escalation_note", name: "Escalation note", format: "text" },
    );
    await db
      .update(customFieldTable)
      .set({
        visibilityCondition: {
          field_key: "severity",
          op: "eq",
          value: "high",
        },
      })
      .where(eq(customFieldTable.id, conditional.id));
    const hidden = await makeCustomField(owner.workspace.id, items.type.id, {
      key: "staff_only",
      format: "text",
      visible: false,
    });
    const high = await items.makeItem("High severity item");
    const low = await items.makeItem("Low severity item");
    await setCustomValue(owner.workspace.id, severity.id, high, "high");
    await setCustomValue(owner.workspace.id, severity.id, low, "low");
    await setCustomValue(
      owner.workspace.id,
      conditional.id,
      high,
      "Visible note",
    );
    await setCustomValue(
      owner.workspace.id,
      conditional.id,
      low,
      "Hidden note",
    );
    await setCustomValue(owner.workspace.id, hidden.id, high, "Do not project");

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: {
          entity: "work_item",
          columns: [
            "key",
            "cf.severity",
            "cf.escalation_note",
            "cf.staff_only",
          ],
        },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        id: string;
        customFieldValues?: Record<string, unknown>;
      }>;
      customFieldColumns?: Array<{
        key: string;
        name: string;
        format: string;
        options: Array<{ key: string; label: string }>;
      }>;
    };
    expect(body.customFieldColumns).toEqual([
      {
        key: "severity",
        name: "Severity",
        format: "select",
        options: [
          { key: "low", label: "Low" },
          { key: "high", label: "High" },
        ],
      },
      {
        key: "escalation_note",
        name: "Escalation note",
        format: "text",
        options: [],
      },
      { key: "staff_only", name: "staff_only", format: "text", options: [] },
    ]);
    const byId = new Map(
      body.data.map((row) => [row.id, row.customFieldValues]),
    );
    expect(byId.get(high.id)).toEqual({
      severity: "high",
      escalation_note: "Visible note",
    });
    expect(byId.get(low.id)).toEqual({ severity: "low" });
    expect(JSON.stringify(body)).not.toContain("Do not project");
    expect(JSON.stringify(body)).not.toContain("Hidden note");
  });

  it("fails closed for unknown and deleted selected field keys", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, ["work_item:read"]);
    const items = await workItemWorld(owner.workspace.id, project.id);
    const field = await makeCustomField(owner.workspace.id, items.type.id, {
      key: "severity",
      format: "text",
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const search = (column: string) =>
      app.request("/api/work-items/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          query: { entity: "work_item", columns: [column] },
        }),
      });

    expect((await search("cf.unknown_field")).status).toBe(422);
    await db
      .update(customFieldTable)
      .set({ deletedAt: new Date() })
      .where(eq(customFieldTable.id, field.id));
    expect((await search("cf.severity")).status).toBe(422);
  });

  it("preserves a visible empty constructor key and rejects foreign field values", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const rows = await workItemWorld(owner.workspace.id, project.id);
    const item = await rows.makeItem("Empty constructor custom field");
    const localField = await makeCustomField(owner.workspace.id, rows.type.id, {
      key: "constructor",
      format: "text",
    });

    const foreign = await createWorkspaceMember({ role: "owner" });
    const foreignProject = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const foreignRows = await workItemWorld(
      foreign.workspace.id,
      foreignProject.project.id,
    );
    const foreignField = await makeCustomField(
      foreign.workspace.id,
      foreignRows.type.id,
      { key: "constructor", format: "text" },
    );
    await expect(
      db.insert(customFieldValueTable).values({
        id: `cfv-foreign-${item.id}`,
        workspaceId: foreign.workspace.id,
        customFieldId: foreignField.id,
        entityType: "work_item",
        entityId: item.id,
        value: "must not leak",
        projectId: project.id,
      }),
    ).rejects.toThrow();

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["cf.constructor"] },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string; customFieldValues?: Record<string, unknown> }>;
    };
    const projected = body.data.find(
      (row) => row.id === item.id,
    )?.customFieldValues;
    expect(projected && Object.hasOwn(projected, "constructor")).toBe(true);
    expect(projected?.constructor).toBeNull();
    expect(projected?.[localField.key]).toBeNull();
    expect(JSON.stringify(body)).not.toContain("must not leak");
  });

  it("paginates long custom sort tuples with a compact cursor and rejects a changed anchor", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const rows = await workItemWorld(owner.workspace.id, project.id);
    const field = await makeCustomField(owner.workspace.id, rows.type.id, {
      key: "long_sort_value",
      format: "long_text",
    });
    const first = await rows.makeItem("Long sort first");
    const second = await rows.makeItem("Long sort second");
    const third = await rows.makeItem("Long sort third");
    const values = [
      `${'a"\\\n'.repeat(2_000)}first`,
      `${"b".repeat(12_000)}second`,
      `${"c".repeat(12_000)}third`,
    ];
    for (const [item, value] of [
      [first, values[0]],
      [second, values[1]],
      [third, values[2]],
    ] as const) {
      await setCustomValue(owner.workspace.id, field.id, item, value);
    }
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const query = {
      entity: "work_item",
      sort: [{ field: "cf.long_sort_value", order: "asc" }],
      columns: ["key", "cf.long_sort_value"],
    };
    const requestPage = (cursor?: string) =>
      app.request("/api/work-items/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          query,
          limit: 1,
          ...(cursor ? { cursor } : {}),
        }),
      });

    const allIds: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await requestPage(cursor ?? undefined);
      expect(response.status, await response.clone().text()).toBe(200);
      const page = (await response.json()) as {
        data: { id: string }[];
        page: { hasMore: boolean; nextCursor: string | null };
      };
      allIds.push(...page.data.map((row) => row.id));
      cursor = page.page.nextCursor;
      if (!page.page.hasMore) break;
      expect(cursor).toEqual(expect.any(String));
      expect(cursor?.length).toBeLessThanOrEqual(2048);
    } while (cursor);
    expect(allIds).toEqual([first.id, second.id, third.id]);
    expect(new Set(allIds).size).toBe(allIds.length);

    const anchorResponse = await requestPage();
    expect(anchorResponse.status).toBe(200);
    const anchorPage = (await anchorResponse.json()) as {
      data: { id: string }[];
      page: { nextCursor: string | null };
    };
    const anchorId = anchorPage.data[0]?.id;
    const changedCursor = anchorPage.page.nextCursor;
    expect(anchorId).toBe(first.id);
    expect(changedCursor).toEqual(expect.any(String));
    await db
      .update(customFieldValueTable)
      .set({ value: `${"z".repeat(12_000)}changed` })
      .where(
        and(
          eq(customFieldValueTable.entityId, anchorId as string),
          eq(customFieldValueTable.customFieldId, field.id),
        ),
      );
    const changedResponse = await requestPage(changedCursor ?? undefined);
    expect(changedResponse.status).toBe(409);
    expect(await changedResponse.text()).toContain("cursor_changed");
  });

  it("sorts typed custom values numerically, keeps currencies separate, and nulls hidden values", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const rows = await workItemWorld(owner.workspace.id, project.id);
    const first = await rows.makeItem("Typed sort first");
    const second = await rows.makeItem("Typed sort second");
    const third = await rows.makeItem("Typed sort third");
    const amount = await makeCustomField(owner.workspace.id, rows.type.id, {
      key: "amount",
      format: "decimal",
    });
    const cost = await makeCustomField(owner.workspace.id, rows.type.id, {
      key: "cost",
      format: "currency",
    });
    const level = await makeCustomField(owner.workspace.id, rows.type.id, {
      key: "level",
      format: "select",
      options: [
        { key: "low", label: "Low" },
        { key: "high", label: "High" },
      ],
    });
    const conditional = await makeCustomField(
      owner.workspace.id,
      rows.type.id,
      {
        key: "conditional_note",
        format: "text",
      },
    );
    await db
      .update(customFieldTable)
      .set({
        visibilityCondition: {
          field_key: "level",
          op: "eq",
          value: "high",
        },
      })
      .where(eq(customFieldTable.id, conditional.id));
    await Promise.all([
      setCustomValue(owner.workspace.id, amount.id, first, 10),
      setCustomValue(owner.workspace.id, amount.id, second, 2),
      setCustomValue(owner.workspace.id, cost.id, first, {
        amount: 20,
        currency: "EUR",
      }),
      setCustomValue(owner.workspace.id, cost.id, second, {
        amount: 10,
        currency: "EUR",
      }),
      setCustomValue(owner.workspace.id, cost.id, third, {
        amount: 1,
        currency: "USD",
      }),
      setCustomValue(owner.workspace.id, level.id, first, "high"),
      setCustomValue(owner.workspace.id, level.id, second, "low"),
      setCustomValue(owner.workspace.id, level.id, third, "high"),
      setCustomValue(owner.workspace.id, conditional.id, first, "z-visible"),
      setCustomValue(owner.workspace.id, conditional.id, second, "a-hidden"),
    ]);
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const sortedIds = async (field: string, order: "asc" | "desc") => {
      const response = await app.request("/api/work-items/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: owner.workspace.id,
          query: {
            entity: "work_item",
            sort: [{ field: `cf.${field}`, order }],
            columns: ["key", `cf.${field}`, "cf.level"],
          },
        }),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as {
        data: Array<{ id: string }>;
      };
      return body.data.map((row) => row.id);
    };
    expect(await sortedIds("amount", "asc")).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    expect(await sortedIds("amount", "desc")).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    expect(await sortedIds("cost", "asc")).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    const conditionalOrder = await sortedIds("conditional_note", "asc");
    expect(conditionalOrder[0]).toBe(first.id);
    expect(conditionalOrder.slice(1)).toEqual(
      expect.arrayContaining([second.id, third.id]),
    );
  });

  it("resolves user values only for references on the matching project roster", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const projectA = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const projectB = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    for (const project of [projectA.project, projectB.project]) {
      await grantProjectRole(owner.user.id, project.id, [
        "project:read",
        "work_item:read",
        "work_item:update",
        "work_item:assign",
      ]);
    }
    const rosterMember = await createWorkspaceMember();
    await grantProjectRole(rosterMember.user.id, projectA.project.id, [
      "work_item:read",
    ]);
    const person = await db.query.personTable.findFirst({
      where: eq(schema.personTable.userId, rosterMember.user.id),
    });
    if (!person) throw new Error("roster person missing");
    const rowsA = await workItemWorld(owner.workspace.id, projectA.project.id);
    const rowsB = await workItemWorld(owner.workspace.id, projectB.project.id);
    const ownerField = await makeCustomField(
      owner.workspace.id,
      rowsA.type.id,
      {
        key: "owner_ref",
        name: "Owner reference",
        format: "user",
      },
    );
    await db.insert(customFieldTypeVisibilityTable).values({
      workspaceId: owner.workspace.id,
      customFieldId: ownerField.id,
      workItemTypeId: rowsB.type.id,
      visible: true,
      required: false,
    });
    const itemA = await rowsA.makeItem("Roster-bound A");
    const itemB = await rowsB.makeItem("Roster-bound B");
    await setCustomValue(owner.workspace.id, ownerField.id, itemA, person.id);
    await setCustomValue(owner.workspace.id, ownerField.id, itemB, person.id);

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["cf.owner_ref"] },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string; projectId: string }>;
      customFieldPeople?: Array<{
        projectId: string;
        personId: string;
        name: string | null;
      }>;
    };
    expect(body.data.map((row) => row.id)).toEqual(
      expect.arrayContaining([itemA.id, itemB.id]),
    );
    expect(body.customFieldPeople).toEqual([
      {
        projectId: projectA.project.id,
        personId: person.id,
        name: rosterMember.user.name,
      },
    ]);
  });

  it("does not return a custom user roster to a read-only viewer", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const rosterMember = await createWorkspaceMember();
    await grantProjectRole(rosterMember.user.id, project.id, [
      "work_item:read",
    ]);
    const rows = await workItemWorld(owner.workspace.id, project.id);
    const field = await makeCustomField(owner.workspace.id, rows.type.id, {
      key: "owner_ref",
      format: "user",
    });
    const item = await rows.makeItem("Viewer custom field");
    const person = await db.query.personTable.findFirst({
      where: eq(schema.personTable.userId, rosterMember.user.id),
    });
    if (!person) throw new Error("roster person missing");
    await setCustomValue(owner.workspace.id, field.id, item, person.id);

    const viewer = await createWorkspaceMember({ role: "viewer" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: viewer.user.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: owner.workspace.id,
      role: "viewer",
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await grantProjectRole(viewer.user.id, project.id, ["work_item:read"]);
    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["cf.owner_ref"] },
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      customFieldPeople?: unknown;
    };
    expect(body.customFieldPeople).toBeUndefined();
  });

  it("leaves native-only response shape unchanged", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, project.id, ["work_item:read"]);
    const items = await workItemWorld(owner.workspace.id, project.id);
    await items.makeItem("Native columns only");
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["key", "title"] },
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>;
      customFieldColumns?: unknown;
    };
    expect(body.customFieldColumns).toBeUndefined();
    expect(body.data[0]).not.toHaveProperty("customFieldValues");
  });
});
