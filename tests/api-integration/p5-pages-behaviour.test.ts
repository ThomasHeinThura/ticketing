/**
 * Project Pages behaviour: versions (PG-4), optimistic concurrency (PG-5), the tree (PG-1),
 * deletion through the pending-action flow (PG-7), audit without the body (PG-8) and canonical
 * search for staff only (PG-6).
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../apps/api/src/database/schema-p5-pages";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  doc,
  type PageBody,
  type PagesWorld,
  pagesWorld,
} from "./helpers/p5-pages";
import {
  deleteThroughApproval,
  ensureAgentSession,
} from "./helpers/pending-deletion";

let w: PagesWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await pagesWorld();
  await ensureAgentSession(w.editor.user.id);
});

const create = (
  title: string,
  extra: { body?: unknown; parentId?: string | null } = {},
  projectId = w.project.id,
) =>
  w.call(w.editor.user, w.base(projectId), {
    method: "POST",
    body: { title, ...extra },
  });
const make = async (title: string, parentId?: string | null) =>
  w.json<PageBody>(
    await create(title, parentId === undefined ? {} : { parentId }),
    201,
  );
const patch = (id: string, body: unknown, projectId = w.project.id) =>
  w.call(w.editor.user, `${w.base(projectId)}/${id}`, {
    method: "PATCH",
    body,
  });
const versionRows = (pageId: string) =>
  db
    .select()
    .from(projectPageVersionTable)
    .where(eq(projectPageVersionTable.pageId, pageId))
    .orderBy(projectPageVersionTable.number);
const auditRows = (entityId: string) =>
  db
    .select()
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.entityId, entityId));

describe("creating and saving (PG-1, PG-4)", () => {
  it("creates a page with an author, a sanitised body and version 1", async () => {
    const page = await w.json<PageBody>(
      await create("Runbook", {
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "keep me",
                  marks: [
                    { type: "link", attrs: { href: "javascript:alert(1)" } },
                  ],
                },
              ],
            },
            { type: "script", content: [{ type: "text", text: "gone" }] },
          ],
        },
      }),
      201,
    );
    expect(page.version).toBe(1);
    expect(page.canEdit).toBe(true);
    const stored = JSON.stringify(page.body);
    expect(stored).toContain("keep me");
    expect(stored).not.toContain("javascript:");
    const [row] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, page.id));
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, w.editor.user.id));
    expect(person?.id).toBeTruthy();
    expect(row?.createdBy).toBe(person?.id);
    expect(row?.workspaceId).toBe(w.workspaceId);
    expect((await versionRows(page.id)).map((v) => [v.number, v.kind])).toEqual(
      [[1, "create"]],
    );
  });

  it("rejects a blank title and a non-document body, and stores nothing", async () => {
    expect((await create("   ")).status).toBe(400);
    expect((await create("T", { body: { type: "not-a-doc" } })).status).toBe(
      422,
    );
    expect(await db.select().from(projectPageTable)).toHaveLength(0);
  });

  it("writes one immutable version per save and bumps the version", async () => {
    const page = await make("Plan");
    const saved = await w.json<PageBody>(
      await patch(page.id, {
        expectedVersion: 1,
        body: doc("second draft"),
      }),
    );
    expect(saved.version).toBe(2);
    const again = await w.json<PageBody>(
      await patch(page.id, { expectedVersion: 2, title: "Plan v2" }),
    );
    expect(again.version).toBe(3);
    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.number, v.title, v.kind])).toEqual([
      [1, "Plan", "create"],
      [2, "Plan", "edit"],
      [3, "Plan v2", "edit"],
    ]);
    expect(JSON.stringify(rows[1]?.body)).toContain("second draft");
    // A version row can never be rewritten, not even by the database owner's own UPDATE.
    await expect(
      db
        .update(projectPageVersionTable)
        .set({ title: "tampered" })
        .where(eq(projectPageVersionTable.id, rows[0]?.id ?? "")),
    ).rejects.toThrow();
  });

  it("lists the history newest first and serves one version with its body", async () => {
    const page = await make("History");
    await patch(page.id, { expectedVersion: 1, body: doc("later") });
    const list = await w.json<{ versions: Array<{ number: number }> }>(
      await w.call(w.reader.user, `${w.base()}/${page.id}/versions`),
    );
    expect(list.versions.map((v) => v.number)).toEqual([2, 1]);
    const one = await w.json<{ number: number; body: unknown }>(
      await w.call(w.reader.user, `${w.base()}/${page.id}/versions/2`),
    );
    expect(JSON.stringify(one.body)).toContain("later");
    expect(
      (await w.call(w.reader.user, `${w.base()}/${page.id}/versions/9`)).status,
    ).toBe(404);
  });
});

describe("optimistic concurrency (PG-5)", () => {
  it("answers a stale save 409 with the current version and writes nothing", async () => {
    const page = await make("Shared");
    await w.json(
      await patch(page.id, { expectedVersion: 1, title: "Shared (theirs)" }),
    );
    const before = await versionRows(page.id);
    const stale = await patch(page.id, {
      expectedVersion: 1,
      title: "Shared (mine)",
      body: doc("my words"),
    });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as {
      message: string;
      currentVersion: number;
      currentTitle: string;
    };
    expect(body.message).toBe("page_version_conflict");
    expect(body.currentVersion).toBe(2);
    expect(body.currentTitle).toBe("Shared (theirs)");
    expect(JSON.stringify(body)).not.toContain("my words");
    const [row] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, page.id));
    expect(row?.title).toBe("Shared (theirs)");
    expect(row?.version).toBe(2);
    expect(await versionRows(page.id)).toHaveLength(before.length);
  });

  it("requires an expected version", async () => {
    const page = await make("Needs version");
    expect((await patch(page.id, { title: "x" })).status).toBe(400);
  });

  it("lets only one of two concurrent saves of the same version win", async () => {
    const page = await make("Race");
    const [a, b] = await Promise.all([
      patch(page.id, { expectedVersion: 1, title: "A" }),
      patch(page.id, { expectedVersion: 1, title: "B" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await versionRows(page.id)).toHaveLength(2);
  });
});

describe("restore (PG-4)", () => {
  it("restores an old version as a new version without rewriting history", async () => {
    const page = await make("Doc");
    await w.json(
      await patch(page.id, {
        expectedVersion: 1,
        title: "Doc edited",
        body: doc("edited"),
      }),
    );
    const restored = await w.json<PageBody>(
      await w.call(w.editor.user, `${w.base()}/${page.id}/restore`, {
        method: "POST",
        body: { number: 1, expectedVersion: 2 },
      }),
    );
    expect(restored.version).toBe(3);
    expect(restored.title).toBe("Doc");
    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.number, v.kind, v.restoredFrom])).toEqual([
      [1, "create", null],
      [2, "edit", null],
      [3, "restore", 1],
    ]);
    expect(rows[1]?.title).toBe("Doc edited");
    expect(await auditActions(page.id)).toContain("page.restored");
  });

  it("refuses a stale restore and an unknown version", async () => {
    const page = await make("Doc2");
    const stale = await w.call(
      w.editor.user,
      `${w.base()}/${page.id}/restore`,
      { method: "POST", body: { number: 1, expectedVersion: 5 } },
    );
    expect(stale.status).toBe(409);
    const unknown = await w.call(
      w.editor.user,
      `${w.base()}/${page.id}/restore`,
      { method: "POST", body: { number: 7, expectedVersion: 1 } },
    );
    expect(unknown.status).toBe(404);
    expect(await versionRows(page.id)).toHaveLength(1);
  });
});

async function auditActions(entityId: string) {
  return (await auditRows(entityId)).map((row) => row.action);
}

describe("the tree (PG-1)", () => {
  it("nests pages and lists them with their parent", async () => {
    const parent = await make("Parent");
    const child = await make("Child", parent.id);
    const list = await w.json<{
      pages: Array<{ id: string; parentId: string | null }>;
      canEdit: boolean;
    }>(await w.call(w.reader.user, w.base()));
    expect(list.canEdit).toBe(false);
    expect(list.pages.find((p) => p.id === child.id)?.parentId).toBe(parent.id);
  });

  it("refuses a self parent, a cycle, a parent in another project and a missing parent", async () => {
    const a = await make("A");
    const b = await make("B", a.id);
    expect(
      (await patch(a.id, { expectedVersion: 1, parentId: a.id })).status,
    ).toBe(422);
    expect(
      (await patch(a.id, { expectedVersion: 1, parentId: b.id })).status,
    ).toBe(422);
    const foreignParent = await w.json<PageBody>(
      await create("Elsewhere", {}, w.otherProject.id),
      201,
    );
    expect(
      (await patch(a.id, { expectedVersion: 1, parentId: foreignParent.id }))
        .status,
    ).toBe(422);
    expect(
      (await create("Orphan", { parentId: foreignParent.id })).status,
    ).toBe(422);
    expect((await create("Ghost", { parentId: "nope" })).status).toBe(422);
    const [row] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, a.id));
    expect(row?.parentId).toBeNull();
    expect(row?.version).toBe(1);
  });

  it("refuses a tree deeper than eight levels", async () => {
    let parent: string | null = null;
    for (let depth = 1; depth <= 8; depth += 1) {
      const page: PageBody = await make(`Level ${depth}`, parent);
      parent = page.id;
    }
    expect((await create("Level 9", { parentId: parent })).status).toBe(422);
  });
});

describe("deletion through the pending-action flow (PG-7)", () => {
  it("keeps the page until approval, then soft-deletes it with its versions and an audit row", async () => {
    const page = await make("Doomed");
    await patch(page.id, { expectedVersion: 1, body: doc("more") });
    mockAuthenticatedSession(w.editor.user);
    const { pending } = await deleteThroughApproval(
      w.app,
      w.editor.user,
      `${w.base()}/${page.id}`,
      {
        afterRequest: async () => {
          const response = await w.call(
            w.editor.user,
            `${w.base()}/${page.id}`,
          );
          expect(response.status).toBe(200);
          const [row] = await db
            .select()
            .from(projectPageTable)
            .where(eq(projectPageTable.id, page.id));
          expect(row?.deletedAt).toBeNull();
        },
      },
    );
    expect(pending.pendingActionId).toBeTruthy();
    expect(pending.summary).toMatchObject({ pageId: page.id });
    const [row] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, page.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.purgeAfter).not.toBeNull();
    expect(await versionRows(page.id)).toHaveLength(2);
    expect((await w.call(w.editor.user, `${w.base()}/${page.id}`)).status).toBe(
      404,
    );
    expect(
      (await w.call(w.editor.user, `${w.base()}/${page.id}/versions`)).status,
    ).toBe(404);
    const list = await w.json<{ pages: Array<{ id: string }> }>(
      await w.call(w.editor.user, w.base()),
    );
    expect(list.pages.map((p) => p.id)).not.toContain(page.id);
    expect(await auditActions(page.id)).toContain("page.deleted");
  });

  it("refuses to delete a page that still has sub-pages, and creates no pending action", async () => {
    const parent = await make("Has kids");
    await make("Kid", parent.id);
    const refused = await w.call(w.editor.user, `${w.base()}/${parent.id}`, {
      method: "DELETE",
    });
    expect(refused.status, await refused.clone().text()).toBe(409);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    const [row] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, parent.id));
    expect(row?.deletedAt).toBeNull();
  });
});

describe("audit (PG-8)", () => {
  it("records create, update and restore with metadata only, never the body", async () => {
    const secret = "SECRET-BODY-TEXT-9f3";
    const page = await w.json<PageBody>(
      await create("Audited", { body: doc(secret) }),
      201,
    );
    await patch(page.id, { expectedVersion: 1, body: doc(`${secret} two`) });
    const rows = await auditRows(page.id);
    expect(rows.map((r) => r.action).sort()).toEqual([
      "page.created",
      "page.updated",
    ]);
    expect(
      JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    ).not.toContain(secret);
    expect(rows.every((r) => r.projectId === w.project.id)).toBe(true);
    expect(rows.every((r) => r.entityType === "project_page")).toBe(true);
  });
});

describe("canonical search (PG-6)", () => {
  const search = (
    user: Parameters<PagesWorld["call"]>[0],
    q: string,
    type = "pages",
  ) =>
    w.call(
      user,
      `/api/search?q=${encodeURIComponent(q)}&workspaceId=${w.workspaceId}&type=${type}`,
    );
  type Hit = { id: string; type: string; projectId?: string };

  it("finds a page by title or body for a caller who reaches the project, and nobody else", async () => {
    const page = await w.json<PageBody>(
      await create("Quokka onboarding", {
        body: doc("the zanzibar checklist"),
      }),
      201,
    );
    for (const q of ["quokka", "zanzibar"]) {
      const hits = await w.json<{ results: Hit[] }>(
        await search(w.reader.user, q),
      );
      expect(hits.results.map((h) => [h.id, h.type])).toEqual([
        [page.id, "page"],
      ]);
    }
    const all = await w.json<{ results: Hit[] }>(
      await search(w.editor.user, "quokka", "all"),
    );
    expect(all.results.some((h) => h.type === "page" && h.id === page.id)).toBe(
      true,
    );
    for (const user of [w.outsider.user, w.foreign.user]) {
      const hits = await search(user, "quokka");
      if (hits.status === 200)
        expect(((await hits.json()) as { results: Hit[] }).results).toEqual([]);
      else expect([403, 404]).toContain(hits.status);
    }
  });

  it("never returns a page to a customer identity, and drops a deleted page", async () => {
    const page = await w.json<PageBody>(
      await create("Hidden narwhal plan", { body: doc("narwhal") }),
      201,
    );
    const asCustomer = await search(w.customer.user, "narwhal", "all");
    if (asCustomer.status === 200)
      expect(
        ((await asCustomer.json()) as { results: Hit[] }).results.filter(
          (h) => h.type === "page",
        ),
      ).toEqual([]);
    await db
      .update(projectPageTable)
      .set({ deletedAt: new Date() })
      .where(and(eq(projectPageTable.id, page.id)));
    const hits = await w.json<{ results: Hit[] }>(
      await search(w.editor.user, "narwhal"),
    );
    expect(hits.results).toEqual([]);
  });

  it("keeps a page of a project the caller does not reach out of the results", async () => {
    await w.json(await create("Okapi roadmap", {}, w.otherProject.id), 201);
    // The reader holds project:read on the first project only.
    const hits = await w.json<{ results: Hit[] }>(
      await search(w.reader.user, "okapi"),
    );
    expect(hits.results).toEqual([]);
    const own = await w.json<{ results: Hit[] }>(
      await search(w.editor.user, "okapi"),
    );
    expect(own.results).toHaveLength(1);
  });
});
