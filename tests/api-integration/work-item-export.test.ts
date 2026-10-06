import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("POST /api/work-items/export", () => {
  beforeEach(async () => resetTestDatabase());

  it("requires work_item:export and records no audit row on denial", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: { entity: "work_item" },
      }),
    });
    expect(response.status).toBe(403);
    const audits = await db.select().from(schema.auditLogTable);
    expect(audits).toHaveLength(0);
  });

  it("masks a foreign workspace before checking export capability", async () => {
    const caller = await createWorkspaceMember({ role: "member" });
    const foreign = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: foreign.workspace.id,
        query: { entity: "work_item" },
      }),
    });
    expect(response.status).toBe(404);
    expect(await db.select().from(schema.auditLogTable)).toHaveLength(0);
  });

  it("exports only requested columns and audits the completed export", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["key", "title"] },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "work-items.csv",
    );
    expect(await response.text()).toBe('"Key","Title"\r\n');
    const audits = await db.select().from(schema.auditLogTable);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("work_item.exported");
    expect(audits[0]?.after).toMatchObject({
      format: "csv",
      count: 0,
      columns: ["key", "title"],
    });
  });
});
