import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createItem, json, setupWorld } from "./helpers/reach-world";

type Page = {
  data: {
    id: string;
    kind: string;
    body: unknown;
    deletedAt: string | null;
    deletedBy: string | null;
  }[];
  page: { hasMore: boolean; nextCursor: string | null };
};
const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});
beforeEach(resetTestDatabase);
async function fixture() {
  const world = await setupWorld();
  const { app } = createApp();
  const item = await createItem(app, world, "Comment focus parent");
  const other = await createItem(app, world, "Other comment scope");
  const comment = async (
    id: string,
    workItemId = item.id,
    createdAt = new Date("2026-01-02T00:00:00.000Z"),
  ) => {
    await db.insert(schema.commentTable).values({
      id,
      workspaceId: world.workspaceId,
      workItemId,
      authorId: world.projectMember.user.id,
      actorType: "person",
      visibility: "internal",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Private body ${id}` }],
          },
        ],
      },
      createdAt,
    });
    return id;
  };
  const read = (key = item.key, query: Record<string, string> = {}) =>
    json(
      app,
      "GET",
      `/api/work-items/${key}/activity?${new URLSearchParams(query)}`,
    );
  return { world, app, item, other, comment, read };
}
describe("scoped exact-comment activity pages", () => {
  it("anchors directly beyond the newest50 and continues all older rows without duplicates", async () => {
    const f = await fixture();
    await db.insert(schema.commentTable).values(
      Array.from({ length: 80 }, (_, i) => ({
        id: `focus-${String(i).padStart(3, "0")}`,
        workItemId: f.item.id,
        workspaceId: f.world.workspaceId,
        authorId: f.world.projectMember.user.id,
        actorType: "person",
        visibility: "internal",
        body: { type: "doc", content: [] },
        createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, i)),
      })),
    );
    const latest = await f.read();
    expect(latest.status).toBe(200);
    expect(
      ((await latest.json()) as Page).data.some((r) => r.id === "focus-020"),
    ).toBe(false);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await f.read(f.item.key, {
        comment: "focus-020",
        limit: "7",
        ...(cursor ? { cursor } : {}),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const page = (await response.json()) as Page;
      if (!cursor)
        expect(page.data[0]).toMatchObject({
          id: "focus-020",
          kind: "comment",
        });
      seen.push(...page.data.map((r) => r.id));
      cursor = page.page.nextCursor;
      expect(page.page.hasMore).toBe(Boolean(cursor));
      if (cursor)
        expect(
          JSON.parse(Buffer.from(cursor, "base64url").toString()),
        ).toMatchObject({
          focus: {
            workspaceId: f.world.workspaceId,
            workItemId: f.item.id,
            commentId: "focus-020",
          },
        });
      expect(seen.length).toBeLessThanOrEqual(21);
    } while (cursor);
    expect(seen).toEqual(
      Array.from(
        { length: 21 },
        (_, i) => `focus-${String(20 - i).padStart(3, "0")}`,
      ),
    );
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("masks missing and foreign-item/foreign-workspace comments identically", async () => {
    const f = await fixture();
    await f.comment("other-item-comment", f.other.id);
    const foreign = await setupWorld();
    const foreignItem = await createItem(
      f.app,
      foreign,
      "Foreign workspace comment owner",
    );
    const posted = await json(
      f.app,
      "POST",
      `/api/work-items/${foreignItem.key}/comments`,
      {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Foreign private body" }],
            },
          ],
        },
        visibility: "internal",
      },
    );
    expect(posted.status).toBe(200);
    const foreignComment = (await posted.json()) as { id: string };
    mockAuthenticatedSession(f.world.projectMember.user);
    const missing = await f.read(f.item.key, { comment: "missing-comment" });
    const other = await f.read(f.item.key, { comment: "other-item-comment" });
    expect(missing.status).toBe(404);
    expect(other.status).toBe(404);
    const missingBody = await missing.text();
    expect(await other.text()).toBe(missingBody);
    const foreignResponse = await f.read(f.item.key, {
      comment: foreignComment.id,
    });
    expect(foreignResponse.status).toBe(404);
    expect(await foreignResponse.text()).toBe(missingBody);
  });
  it("returns a selected deleted comment as a null-body tombstone", async () => {
    const f = await fixture();
    await f.comment("deleted-anchor");
    await db
      .update(schema.commentTable)
      .set({
        deletedAt: new Date(),
        deletedBy: f.world.projectMember.user.id,
        body: {
          type: "doc",
          content: [
            { type: "paragraph", text: "must never return stale body" },
          ],
        },
      })
      .where(eq(schema.commentTable.id, "deleted-anchor"));
    const response = await f.read(f.item.key, { comment: "deleted-anchor" });
    expect(response.status).toBe(200);
    const page = (await response.json()) as Page;
    expect(page.data[0]).toMatchObject({
      id: "deleted-anchor",
      body: null,
      deletedBy: f.world.projectMember.user.id,
    });
    expect(JSON.stringify(page)).not.toContain("must never return stale body");
  });
  it("rejects ordinary/focused, other-anchor and other-item cursor mixing", async () => {
    const f = await fixture();
    await f.comment("focus-old");
    await f.comment("focus-other");
    const first = await f.read(f.item.key, {
      comment: "focus-other",
      limit: "1",
    });
    const focused = ((await first.json()) as Page).page.nextCursor;
    if (!focused) throw new Error("expected focused cursor");
    const ordinary = (
      (await (await f.read(f.item.key, { limit: "1" })).json()) as Page
    ).page.nextCursor;
    if (!ordinary) throw new Error("expected ordinary cursor");
    const invalidQueries: Record<string, string>[] = [
      { cursor: focused },
      { comment: "focus-old", cursor: focused },
      { comment: "focus-other", cursor: ordinary },
    ];
    for (const query of invalidQueries)
      expect((await f.read(f.item.key, query)).status).toBe(400);
    await f.comment("other-page-anchor", f.other.id);
    expect(
      (
        await f.read(f.other.key, {
          comment: "other-page-anchor",
          cursor: focused,
        })
      ).status,
    ).toBe(400);
    const edited = JSON.parse(Buffer.from(focused, "base64url").toString());
    edited.focus.workItemId = f.other.id;
    expect(
      (
        await f.read(f.item.key, {
          comment: "focus-other",
          cursor: Buffer.from(JSON.stringify(edited)).toString("base64url"),
        })
      ).status,
    ).toBe(400);
  });
  it.each(["UTC", "Asia/Yangon", "America/New_York"])(
    "keeps exact-ms ordering including cross-table identical IDs in %s",
    async (timezone) => {
      process.env.TZ = timezone;
      const f = await fixture();
      for (const id of ["tie-c", "tie-b", "tie-a"]) await f.comment(id);
      await db.execute(
        sql`UPDATE comment SET created_at='2026-01-02 12:13:14.100001'::timestamp WHERE id='tie-a'`,
      );
      await db.execute(
        sql`UPDATE comment SET created_at='2026-01-02 12:13:14.100002'::timestamp WHERE id='tie-b'`,
      );
      await db.execute(
        sql`UPDATE comment SET created_at='2026-01-02 12:13:14.100003'::timestamp WHERE id='tie-c'`,
      );
      await db.insert(schema.activityTable).values({
        id: "tie-b",
        workItemId: f.item.id,
        workspaceId: f.world.workspaceId,
        actorId: null,
        actorType: "system",
        verb: "updated",
        field: "title",
        visibility: "internal",
        createdAt: new Date("2026-01-02T12:13:14.100Z"),
      });
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await f.read(f.item.key, {
          comment: "tie-b",
          limit: "1",
          ...(cursor ? { cursor } : {}),
        });
        expect(response.status).toBe(200);
        const page = (await response.json()) as Page;
        seen.push(...page.data.map((r) => `${r.kind}:${r.id}`));
        cursor = page.page.nextCursor;
        expect(seen.length).toBeLessThan(5);
      } while (cursor);
      expect(seen).toEqual([
        "comment:tie-b",
        "activity:tie-b",
        "comment:tie-a",
      ]);
    },
  );
  it("retains anonymous, out-of-reach and customer native-route denials", async () => {
    const f = await fixture();
    await f.comment("private-anchor");
    mockAnonymousSession();
    expect(
      (await f.read(f.item.key, { comment: "private-anchor" })).status,
    ).toBe(401);
    mockAuthenticatedSession(f.world.outsiderAdmin.user);
    const hidden = await f.read(f.item.key, { comment: "private-anchor" });
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).not.toContain("Private body");
    mockAuthenticatedSession(f.world.customerWithRole.user);
    expect(
      (await f.read(f.item.key, { comment: "private-anchor" })).status,
    ).toBe(403);
  });
});
