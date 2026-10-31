/**
 * PG-4 autosave coalescing (Thomas, 31 Oct 2026): a content save by the author of the page's
 * latest "edit" version, within PAGE_VERSION_COALESCE_WINDOW_MINUTES of that version's creation,
 * updates that version (renumbered to the new page version) instead of adding one. The page
 * version still advances on every save (PG-5) and every save still writes an audit row (PG-8).
 */
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../apps/api/src/database/schema-p5-pages";
import { PAGE_VERSION_COALESCE_WINDOW_MINUTES } from "../../apps/api/src/pages/logic";
import { resetTestDatabase } from "./helpers/database";
import { grantProjectRole } from "./helpers/fixtures";
import {
  doc,
  type PageBody,
  type PagesWorld,
  pagesWorld,
} from "./helpers/p5-pages";
import { ensureAgentSession } from "./helpers/pending-deletion";
import { addMember } from "./helpers/reach-world";

let w: PagesWorld;
let coEditor: Awaited<ReturnType<typeof addMember>>;
beforeEach(async () => {
  await resetTestDatabase();
  w = await pagesWorld();
  coEditor = await addMember(w.workspaceId, "member");
  await grantProjectRole(coEditor.user.id, w.project.id, [
    "project:read",
    "project:update",
  ]);
  await ensureAgentSession(w.editor.user.id);
  await ensureAgentSession(coEditor.user.id);
});

type User = PagesWorld["editor"]["user"];

const make = async (title: string) =>
  w.json<PageBody>(
    await w.call(w.editor.user, w.base(), { method: "POST", body: { title } }),
    201,
  );
const patch = (id: string, body: unknown, user: User = w.editor.user) =>
  w.call(user, `${w.base()}/${id}`, { method: "PATCH", body });
const save = async (
  id: string,
  body: unknown,
  user: User = w.editor.user,
): Promise<PageBody> => w.json<PageBody>(await patch(id, body, user));
const versionRows = (pageId: string) =>
  db
    .select()
    .from(projectPageVersionTable)
    .where(eq(projectPageVersionTable.pageId, pageId))
    .orderBy(projectPageVersionTable.number);
const updateAudits = (pageId: string) =>
  db
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.entityId, pageId),
        eq(schema.auditLogTable.action, "page.updated"),
      ),
    );

/** Moves a version's creation past the window. The immutability trigger is bypassed for this
 * one transaction only (owner connection, `session_replication_role = replica`). */
async function ageVersion(versionId: string, minutes: number) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`UPDATE project_page_version SET created_at = now() - make_interval(mins => ${minutes}::int) WHERE id = ${versionId}`,
    );
  });
}

describe("autosave coalescing (PG-4)", () => {
  it("updates the same author's latest edit version inside the window and still advances the page", async () => {
    const page = await make("Notes");
    const first = await save(page.id, {
      expectedVersion: 1,
      body: doc("draft one"),
    });
    expect(first.version).toBe(2);
    const [, firstEdit] = await versionRows(page.id);
    expect(firstEdit?.updatedAt).toBeNull();

    const second = await save(page.id, {
      expectedVersion: 2,
      body: doc("draft two"),
    });
    const third = await save(page.id, {
      expectedVersion: 3,
      title: "Notes",
      body: doc("draft three"),
    });
    expect([second.version, third.version]).toEqual([3, 4]);

    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.number, v.kind])).toEqual([
      [1, "create"],
      [4, "edit"],
    ]);
    const latest = rows[1];
    expect(latest?.id).toBe(firstEdit?.id);
    expect(latest?.createdAt.getTime()).toBe(firstEdit?.createdAt.getTime());
    expect(latest?.updatedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(latest?.body)).toContain("draft three");
    expect(latest?.bodyText).toContain("draft three");

    const [stored] = await db
      .select()
      .from(projectPageTable)
      .where(eq(projectPageTable.id, page.id));
    expect(stored?.version).toBe(4);

    // The history API shows the coalesced version under the page's current number.
    const list = await w.json<{
      versions: Array<{ number: number; createdAt: string; updatedAt: string }>;
    }>(await w.call(w.reader.user, `${w.base()}/${page.id}/versions`));
    expect(list.versions.map((v) => v.number)).toEqual([4, 1]);
    expect(
      Date.parse(list.versions[0]?.updatedAt ?? ""),
    ).toBeGreaterThanOrEqual(Date.parse(list.versions[0]?.createdAt ?? ""));
    const one = await w.json<{ body: unknown }>(
      await w.call(w.reader.user, `${w.base()}/${page.id}/versions/4`),
    );
    expect(JSON.stringify(one.body)).toContain("draft three");
    expect(
      (await w.call(w.reader.user, `${w.base()}/${page.id}/versions/2`)).status,
    ).toBe(404);
  });

  it("writes a new version when another author saves", async () => {
    const page = await make("Shared");
    await save(page.id, { expectedVersion: 1, body: doc("editor words") });
    const theirs = await save(
      page.id,
      { expectedVersion: 2, body: doc("co-editor words") },
      coEditor.user,
    );
    expect(theirs.version).toBe(3);
    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.number, v.kind])).toEqual([
      [1, "create"],
      [2, "edit"],
      [3, "edit"],
    ]);
    expect(JSON.stringify(rows[1]?.body)).toContain("editor words");
    expect(rows[1]?.updatedAt).toBeNull();
  });

  it("writes a new version once the latest version is older than the window", async () => {
    const page = await make("Long session");
    await save(page.id, { expectedVersion: 1, body: doc("early") });
    const [, early] = await versionRows(page.id);
    await ageVersion(early?.id ?? "", PAGE_VERSION_COALESCE_WINDOW_MINUTES + 1);
    await save(page.id, { expectedVersion: 2, body: doc("late") });
    const rows = await versionRows(page.id);
    expect(rows.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(JSON.stringify(rows[1]?.body)).toContain("early");
    expect(JSON.stringify(rows[2]?.body)).toContain("late");
  });

  it("never coalesces into the create version, and gives a rename or a move its own version", async () => {
    const page = await make("Plan");
    const parent = await make("Parent");
    await save(page.id, { expectedVersion: 1, body: doc("body") });
    await save(page.id, { expectedVersion: 2, title: "Plan (renamed)" });
    await save(page.id, { expectedVersion: 3, parentId: parent.id });
    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.number, v.title, v.kind])).toEqual([
      [1, "Plan", "create"],
      [2, "Plan", "edit"],
      [3, "Plan (renamed)", "edit"],
      [4, "Plan (renamed)", "edit"],
    ]);
  });

  it("still answers a stale save 409 and writes nothing, after coalescing", async () => {
    const page = await make("Race");
    await save(page.id, { expectedVersion: 1, body: doc("a") });
    await save(page.id, { expectedVersion: 2, body: doc("b") });
    const before = await versionRows(page.id);
    const audits = (await updateAudits(page.id)).length;
    const stale = await patch(page.id, {
      expectedVersion: 2,
      body: doc("from an old tab"),
    });
    expect(stale.status).toBe(409);
    expect(
      ((await stale.json()) as { currentVersion: number }).currentVersion,
    ).toBe(3);
    const after = await versionRows(page.id);
    expect(after).toEqual(before);
    expect(JSON.stringify(after[1]?.body)).not.toContain("from an old tab");
    expect(await updateAudits(page.id)).toHaveLength(audits);
  });

  it("lets only one of two concurrent saves of the same version win", async () => {
    const page = await make("Concurrent");
    await save(page.id, { expectedVersion: 1, body: doc("start") });
    const [a, b] = await Promise.all([
      patch(page.id, { expectedVersion: 2, body: doc("A") }),
      patch(page.id, { expectedVersion: 2, body: doc("B") }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await versionRows(page.id)).map((v) => v.number)).toEqual([1, 3]);
  });

  it("restores a version as a new version that later saves do not coalesce into", async () => {
    const page = await make("Doc");
    await save(page.id, { expectedVersion: 1, body: doc("first") });
    await save(page.id, { expectedVersion: 2, body: doc("second") });
    const restored = await w.json<PageBody>(
      await w.call(w.editor.user, `${w.base()}/${page.id}/restore`, {
        method: "POST",
        body: { number: 1, expectedVersion: 3 },
      }),
    );
    expect(restored.version).toBe(4);
    await save(page.id, { expectedVersion: 4, body: doc("after restore") });
    const restoredAgain = await w.json<PageBody>(
      await w.call(w.editor.user, `${w.base()}/${page.id}/restore`, {
        method: "POST",
        body: { number: 3, expectedVersion: 5 },
      }),
    );
    expect(JSON.stringify(restoredAgain.body)).toContain("second");
    const rows = await versionRows(page.id);
    expect(rows.map((v) => [v.number, v.kind, v.restoredFrom])).toEqual([
      [1, "create", null],
      [3, "edit", null],
      [4, "restore", 1],
      [5, "edit", null],
      [6, "restore", 3],
    ]);
  });

  it("writes one audit row per save, marking coalesced saves, without the body", async () => {
    const page = await make("Audited");
    await save(page.id, { expectedVersion: 1, body: doc("secret-one") });
    await save(page.id, { expectedVersion: 2, body: doc("secret-two") });
    const audits = await updateAudits(page.id);
    expect(audits).toHaveLength(2);
    const afters = audits
      .map((row) => row.after as { version: number; coalesced: boolean })
      .sort((x, y) => x.version - y.version);
    expect(afters.map((a) => [a.version, a.coalesced])).toEqual([
      [2, false],
      [3, true],
    ]);
    // Audit ids are bigint; stringify them so the whole row can be searched.
    expect(
      JSON.stringify(audits, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain("secret-");
  });

  it("keeps refusing a direct rewrite of a version that is not the page's latest edit", async () => {
    const page = await make("Guarded");
    await save(page.id, { expectedVersion: 1, body: doc("x") });
    const [created, edit] = await versionRows(page.id);
    await expect(
      db
        .update(projectPageVersionTable)
        .set({ title: "tampered", number: 9, updatedAt: new Date() })
        .where(eq(projectPageVersionTable.id, created?.id ?? "")),
    ).rejects.toThrow();
    // The latest edit, but not renumbered to the page's version: refused.
    await expect(
      db
        .update(projectPageVersionTable)
        .set({ title: "tampered", updatedAt: new Date() })
        .where(eq(projectPageVersionTable.id, edit?.id ?? "")),
    ).rejects.toThrow();
  });
});
