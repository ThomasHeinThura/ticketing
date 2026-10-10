/**
 * `work_item.due_date` is `timestamp without time zone` holding UTC wall time. A keyset
 * cursor on it must bind the instant the way `utils/db-time.ts` describes (UTC), not through
 * node-pg's local-time Date serialisation, which Postgres reads without regard to the offset.
 * Run under several `TZ` values (`TZ=Asia/Yangon`, `TZ=America/New_York`) to prove it.
 */
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
  grantProjectRole,
} from "./helpers/fixtures";

describe("POST /api/work-items/search due-date keyset paging", () => {
  beforeEach(async () => resetTestDatabase());

  it.each(["asc", "desc"] as const)(
    "pages every item exactly once when sorting by dueDate %s",
    async (order) => {
      const member = await createWorkspaceMember({ role: "member" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await grantProjectRole(member.user.id, project.id, [
        "work_item:read",
        "work_item:create",
        "project:read",
      ]);
      const now = new Date();
      const [type] = await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `type-${randomUUID()}`,
          name: "Task",
          category: "delivery",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const [template] = await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: member.workspace.id,
          key: `state-${randomUUID()}`,
          name: "Started",
          group: "started",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!type || !template) throw new Error("fixture creation failed");
      await db.insert(schema.stateTable).values({
        projectId: project.id,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      const due = [
        "2031-03-01T05:30:00.000Z",
        "2031-03-01T11:00:00.000Z",
        "2031-03-02T00:15:00.000Z",
        "2031-03-02T23:45:00.000Z",
      ];
      const keys: string[] = [];
      for (const [index, iso] of due.entries()) {
        const response = await app.request(
          `/api/projects/${project.id}/work-items`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ typeId: type.id, title: `Due ${index}` }),
          },
        );
        expect(response.status).toBe(200);
        const created = (await response.json()) as { id: string; key: string };
        await db
          .update(schema.workItemTable)
          .set({ dueDate: new Date(iso) })
          .where(eq(schema.workItemTable.id, created.id));
        keys.push(created.key);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const response = await app.request("/api/work-items/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            workspaceId: member.workspace.id,
            query: {
              entity: "work_item",
              sort: [{ field: "dueDate", order }],
            },
            limit: 1,
            cursor,
          }),
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: Array<{ key: string }>;
          page: { nextCursor: string | null; hasMore: boolean };
        };
        seen.push(...body.data.map((row) => row.key));
        if (!body.page.hasMore) break;
        cursor = body.page.nextCursor;
      }
      expect(seen).toEqual(order === "asc" ? keys : [...keys].reverse());
    },
  );
});
