/** #1199: a 15-letter project key flows through work-item keys, search and the CSV export. */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetWorkItemExportRateLimitsForTest } from "../../apps/api/src/work-item/search/csv";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { json, setupWorld } from "./helpers/reach-world";

const LONG_KEY = "ABCDEFGHIJKLMNO";

describe("15-letter project key (#1199)", () => {
  beforeEach(async () => {
    resetWorkItemExportRateLimitsForTest();
    await resetTestDatabase();
  });

  it("mints SLUG-n keys and exports them to CSV unchanged", async () => {
    const world = await setupWorld();
    const { app } = createApp();
    await db
      .update(schema.projectTable)
      .set({ slug: LONG_KEY })
      .where(eq(schema.projectTable.id, world.project.id));
    mockAuthenticatedSession(world.admin.user);
    const created = await json(
      app,
      "POST",
      `/api/projects/${world.project.id}/work-items`,
      { typeId: world.type.id, title: "Long key item" },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const item = (await created.json()) as { id: string; key: string };
    expect(item.key).toBe(`${LONG_KEY}-1`);

    const exported = await json(app, "POST", "/api/work-items/export", {
      workspaceId: world.workspaceId,
      query: { entity: "work_item", columns: ["key", "title"] },
    });
    expect(exported.status, await exported.clone().text()).toBe(200);
    expect(await exported.text()).toBe(
      `Key,Title\r\n${LONG_KEY}-1,Long key item\r\n`,
    );
  });
});
