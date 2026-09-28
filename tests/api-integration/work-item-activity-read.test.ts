/**
 * `GET /api/work-items/{key}/activity` (`docs/03-features/work-items.md` `WI-6`, issue
 * #292) -- #23's fourth slice, the READ side over the already-merged write path
 * (`activity.ts`, wired into create/update/assign).
 *
 * Issue #452 extended this same route to also merge in posted `comment` rows (see
 * `docs/03-features/comments-and-activity.md`'s "one stream showing everything") -- the
 * tests below that name #452 cover that merge specifically; everything above them is
 * unchanged from #292.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate) throw new Error("makeDefaultState: state_template");
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state");
  return state;
}

async function setupProjectWithDefaultState() {
  const creator = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
  ifMatch: string | number,
) {
  return app.request(`/api/work-items/${key}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": `"${ifMatch}"` },
    body: JSON.stringify(body),
  });
}

function activityRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  query = "",
) {
  return app.request(`/api/work-items/${key}/activity${query}`);
}

function postCommentRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/work-items/${key}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteCommentRequest(
  app: ReturnType<typeof createApp>["app"],
  id: string,
) {
  return app.request(`/api/comments/${id}`, { method: "DELETE" });
}

// Pages through the whole stream at `limit=1`, asserting no id repeats across pages
// (a repeat is exactly as real a bug as a skip), and returns every id seen in order.
// Shared by the #452 B1/B2 regression tests below, which both need this exact walk.
async function pageThroughAll(
  app: ReturnType<typeof createApp>["app"],
  key: string,
): Promise<string[]> {
  const seen: string[] = [];
  const seenSet = new Set<string>();
  let cursor: string | null = null;
  let hasMore = true;
  let pages = 0;
  while (hasMore) {
    pages += 1;
    expect(pages).toBeLessThan(10); // safety valve against an infinite loop
    const query = cursor
      ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
      : "?limit=1";
    const response = await activityRequest(app, key, query);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ id: string }>;
      page: { hasMore: boolean; nextCursor: string | null };
    };
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    if (row) {
      expect(seenSet.has(row.id)).toBe(false);
      seenSet.add(row.id);
      seen.push(row.id);
    }
    hasMore = body.page.hasMore;
    cursor = body.page.nextCursor;
  }
  return seen;
}

describe("API integration: work item activity read (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns activity rows already written by update, newest first", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Original",
      })
    ).json()) as { key: string; version: number };

    await updateWorkItemRequest(
      app,
      created.key,
      { title: "First edit" },
      created.version,
    );
    await updateWorkItemRequest(
      app,
      created.key,
      { title: "Second edit" },
      created.version + 1,
    );

    const response = await activityRequest(app, created.key);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ verb: string; field: string | null; newValue: unknown }>;
      page: { hasMore: boolean; nextCursor: string | null };
    };
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    // Newest first: the SECOND edit's title-change row comes before the first's.
    const titleRows = body.data.filter((row) => row.field === "title");
    expect(titleRows[0]?.newValue).toBe("Second edit");
    expect(titleRows[1]?.newValue).toBe("First edit");
  });

  it("no seq field is ever exposed on a row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "No leaking seq",
      })
    ).json()) as { key: string };

    const response = await activityRequest(app, created.key);
    const body = (await response.json()) as {
      data: Array<Record<string, unknown>>;
    };
    for (const row of body.data) {
      expect(row).not.toHaveProperty("seq");
    }
  });

  it("pagination: limit=1 pages through every row without duplicates or gaps", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Paged",
      })
    ).json()) as { key: string; version: number };
    await updateWorkItemRequest(
      app,
      created.key,
      { title: "Edit 1" },
      created.version,
    );
    await updateWorkItemRequest(
      app,
      created.key,
      { title: "Edit 2" },
      created.version + 1,
    );

    const seenIds = new Set<string>();
    let cursor: string | null = null;
    let hasMore = true;
    let pages = 0;
    while (hasMore) {
      pages += 1;
      expect(pages).toBeLessThan(20); // safety valve against an infinite loop
      const query = cursor
        ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
        : "?limit=1";
      const response = await activityRequest(app, created.key, query);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Array<{ id: string }>;
        page: { hasMore: boolean; nextCursor: string | null };
      };
      expect(body.data).toHaveLength(1);
      for (const row of body.data) {
        expect(seenIds.has(row.id)).toBe(false);
        seenIds.add(row.id);
      }
      hasMore = body.page.hasMore;
      cursor = body.page.nextCursor;
    }
    expect(seenIds.size).toBeGreaterThanOrEqual(3); // created + 2 title edits
  });

  it("a malformed cursor is a 400, not a 500", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Bad cursor",
      })
    ).json()) as { key: string };

    const response = await activityRequest(
      app,
      created.key,
      "?cursor=not-valid-base64url-json",
    );
    expect(response.status).toBe(400);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await activityRequest(app, `${project.slug}-999999`);
    expect(response.status).toBe(404);
  });

  it("cross-workspace 404: a key that exists but belongs to another workspace", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Not yours",
      })
    ).json()) as { key: string };

    const stranger = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(stranger.user);

    const response = await activityRequest(app, created.key);
    expect(response.status).toBe(404);
  });

  // Issue #452: `GET /api/work-items/{key}/activity` merges in posted `comment` rows,
  // matching `comments-and-activity.md`'s "one stream showing everything" -- there is no
  // separate `GET .../comments` route (the spec's own `## API` section never documented
  // one), so the fix lives here.
  describe("#452: comment rows merged into the activity stream", () => {
    it("returns a posted comment tagged kind: comment, interleaved with activity by time", async () => {
      const { creator, project, type } = await setupProjectWithDefaultState();
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();

      const created = (await (
        await createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: "Original",
        })
      ).json()) as { key: string; id: string; version: number };

      await updateWorkItemRequest(
        app,
        created.key,
        { title: "Edited" },
        created.version,
      );

      const commentResponse = await postCommentRequest(app, created.key, {
        body: { type: "doc", content: [] },
        visibility: "internal",
      });
      expect(commentResponse.status).toBe(200);
      const comment = (await commentResponse.json()) as { id: string };

      const response = await activityRequest(app, created.key);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };

      const activityKinds = new Set(body.data.map((row) => row.kind));
      expect(activityKinds.has("activity")).toBe(true);
      expect(activityKinds.has("comment")).toBe(true);

      const commentRow = body.data.find((row) => row.id === comment.id);
      expect(commentRow).toBeDefined();
      expect(commentRow?.kind).toBe("comment");
      expect(commentRow?.workItemId).toBe(created.id);
      expect(commentRow?.visibility).toBe("internal");

      // Newest first, across both sources: the comment was posted after the title
      // edit, so it comes first in the merged stream.
      expect(body.data[0]?.id).toBe(comment.id);
    });

    it("a tombstoned (deleted) comment still appears, body null", async () => {
      const { creator, project, type } = await setupProjectWithDefaultState();
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();

      const created = (await (
        await createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: "Has a deleted comment",
        })
      ).json()) as { key: string };

      const commentResponse = await postCommentRequest(app, created.key, {
        body: { type: "doc", content: [] },
        visibility: "internal",
      });
      const comment = (await commentResponse.json()) as { id: string };
      await deleteCommentRequest(app, comment.id);

      const response = await activityRequest(app, created.key);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };
      const commentRow = body.data.find((row) => row.id === comment.id);
      expect(commentRow).toBeDefined();
      expect(commentRow?.kind).toBe("comment");
      expect(commentRow?.body).toBeNull();
      expect(commentRow?.deletedAt).not.toBeNull();
    });

    it("pagination: limit=1 pages through a mix of activity and comment rows without duplicates or gaps", async () => {
      const { creator, project, type } = await setupProjectWithDefaultState();
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();

      const created = (await (
        await createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: "Mixed stream",
        })
      ).json()) as { key: string; version: number };

      await updateWorkItemRequest(
        app,
        created.key,
        { title: "Edit 1" },
        created.version,
      );
      await postCommentRequest(app, created.key, {
        body: { type: "doc", content: [] },
        visibility: "internal",
      });
      await updateWorkItemRequest(
        app,
        created.key,
        { title: "Edit 2" },
        created.version + 1,
      );
      await postCommentRequest(app, created.key, {
        body: { type: "doc", content: [] },
        visibility: "public",
      });

      const seenIds = new Set<string>();
      const seenKinds = new Set<string>();
      let cursor: string | null = null;
      let hasMore = true;
      let pages = 0;
      while (hasMore) {
        pages += 1;
        expect(pages).toBeLessThan(30); // safety valve against an infinite loop
        const query = cursor
          ? `?limit=1&cursor=${encodeURIComponent(cursor)}`
          : "?limit=1";
        const response = await activityRequest(app, created.key, query);
        expect(response.status).toBe(200);
        const body = (await response.json()) as {
          data: Array<{ id: string; kind: string }>;
          page: { hasMore: boolean; nextCursor: string | null };
        };
        expect(body.data).toHaveLength(1);
        for (const row of body.data) {
          expect(seenIds.has(row.id)).toBe(false);
          seenIds.add(row.id);
          seenKinds.add(row.kind);
        }
        hasMore = body.page.hasMore;
        cursor = body.page.nextCursor;
      }
      // created + 2 title edits (activity) + 2 comments = 5 rows minimum.
      expect(seenIds.size).toBeGreaterThanOrEqual(5);
      expect(seenKinds.has("activity")).toBe(true);
      expect(seenKinds.has("comment")).toBe(true);
    });

    it("#452 delta (Opus B1): comments microseconds apart in the same millisecond page correctly, no rows skipped", async () => {
      const { creator, project, type } = await setupProjectWithDefaultState();
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();

      const created = (await (
        await createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: "Same-millisecond comments",
        })
      ).json()) as { key: string };

      const commentIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const response = await postCommentRequest(app, created.key, {
          body: { type: "doc", content: [] },
          visibility: "internal",
        });
        const comment = (await response.json()) as { id: string };
        commentIds.push(comment.id);
      }

      // Force all three comments into the EXACT same millisecond, at distinct
      // microsecond offsets -- reproduces #452's B1 (Opus delta review): `comment.
      // created_at` is stored to the microsecond, but the old continuation filter
      // compared it against a millisecond-precision cursor, so every comment but the
      // first written in a shared millisecond bucket was silently skipped on every
      // subsequent page.
      const baseTimestamp = "2030-01-01 00:00:00.500";
      for (const [index, id] of commentIds.entries()) {
        await db.execute(
          sql`update comment set created_at = ${baseTimestamp}::timestamp + (${index} * interval '1 microsecond') where id = ${id}`,
        );
      }

      const seenIds = new Set(await pageThroughAll(app, created.key));

      // EXACT count, not >= : the bug silently dropped rows sharing a millisecond
      // bucket, so a >= assertion would not have caught it. 3 comments (forced into
      // the same millisecond) + the work item's own single `created` activity row
      // (this work item has no other activity) = 4, deterministically.
      expect(seenIds.size).toBe(4);
      for (const id of commentIds) {
        expect(seenIds.has(id)).toBe(true);
      }
    });

    it("#452 delta (Opus B2): pagination is correct under a non-UTC server timezone", async () => {
      // B2: the cursor's `createdAt` used to bind through node-postgres's DEFAULT
      // Date serialisation whenever the comment side compared against the truncated
      // `date_trunc('milliseconds', ...)` expression rather than a real column --
      // and that default serialisation reflects the SERVER PROCESS's own local
      // timezone, silently dropped by `comment.created_at`'s `timestamp` (no time
      // zone) column. Invisible under UTC (this whole suite's default), so this test
      // deliberately runs under a real non-UTC zone and restores `process.env.TZ`
      // afterward -- mutating it at runtime takes effect immediately in this Node
      // version (verified separately), so this reproduces the bug in-process rather
      // than needing a subprocess.
      const originalTz = process.env.TZ;
      process.env.TZ = "America/New_York";
      try {
        const { creator, project, type } = await setupProjectWithDefaultState();
        mockAuthenticatedSession(creator.user);
        const { app } = createApp();

        const created = (await (
          await createWorkItemRequest(app, project.id, {
            typeId: type.id,
            title: "Non-UTC timezone comments",
          })
        ).json()) as { key: string };

        const commentIds: string[] = [];
        for (let i = 0; i < 3; i++) {
          const response = await postCommentRequest(app, created.key, {
            body: { type: "doc", content: [] },
            visibility: "internal",
          });
          const comment = (await response.json()) as { id: string };
          commentIds.push(comment.id);
        }

        const seenIds = new Set(await pageThroughAll(app, created.key));

        // 3 comments + 1 `created` activity row = 4, deterministically -- same
        // shape as the B1 test, but here the bug was in the cursor's TIMEZONE
        // handling, not its precision, so ordinary (non-same-millisecond) comments
        // are enough to reproduce it.
        expect(seenIds.size).toBe(4);
        for (const id of commentIds) {
          expect(seenIds.has(id)).toBe(true);
        }
      } finally {
        // N1 (Opus round-3 delta review of #452): assigning `undefined` here would
        // store the literal string `"undefined"`, not unset the variable -- harmless
        // (falls back to UTC) but leaks a bogus TZ into every later test in this
        // process. Delete outright when there was nothing to restore.
        if (originalTz === undefined) {
          delete process.env.TZ;
        } else {
          process.env.TZ = originalTz;
        }
      }
    });

    it("cross-workspace 404 still applies once comments exist on the item", async () => {
      const { creator, project, type } = await setupProjectWithDefaultState();
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();

      const created = (await (
        await createWorkItemRequest(app, project.id, {
          typeId: type.id,
          title: "Not yours, with a comment",
        })
      ).json()) as { key: string };
      await postCommentRequest(app, created.key, {
        body: { type: "doc", content: [] },
        visibility: "internal",
      });

      const stranger = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(stranger.user);

      const response = await activityRequest(app, created.key);
      expect(response.status).toBe(404);
    });
  });
});
