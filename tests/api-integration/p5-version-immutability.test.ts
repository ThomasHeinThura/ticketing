/**
 * P5-R2-03 / P5-R2-07: version rows are immutable (only the erased-author created_by -> NULL
 * change passes), cannot be deleted directly, still cascade with their parent, and the hand-written
 * P5 migrations 0150/0152/0154 re-run on a migrated database without error.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  kbArticleTable,
  kbArticleVersionTable,
} from "../../apps/api/src/database/schema-p5-kb";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

beforeEach(async () => resetTestDatabase());

async function personId(userId: string) {
  const { ensureStaffPersonForUser } = await import(
    "../../apps/api/src/utils/seed-internal-organisation"
  );
  await ensureStaffPersonForUser(userId);
  return requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "person",
  ).id;
}

async function kbFixture() {
  const member = await createWorkspaceMember({ role: "owner" });
  const person = await personId(member.user.id);
  const article = requireRow(
    await db
      .insert(kbArticleTable)
      .values({
        workspaceId: member.workspace.id,
        title: "T",
        body: { type: "doc", content: [] },
      })
      .returning(),
    "article",
  );
  const version = requireRow(
    await db
      .insert(kbArticleVersionTable)
      .values({
        articleId: article.id,
        number: 1,
        title: "T",
        body: { type: "doc", content: [] },
        createdBy: person,
      })
      .returning(),
    "version",
  );
  return { member, person, article, version };
}

async function pageFixture() {
  const member = await createWorkspaceMember({ role: "owner" });
  const person = await personId(member.user.id);
  const { project } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  const { projectPageTable, projectPageVersionTable } = await import(
    "../../apps/api/src/database/schema-p5-pages"
  );
  const page = requireRow(
    await db
      .insert(projectPageTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        title: "P",
        body: { type: "doc", content: [] },
      })
      .returning(),
    "page",
  );
  const version = requireRow(
    await db
      .insert(projectPageVersionTable)
      .values({
        pageId: page.id,
        number: 1,
        title: "P",
        body: { type: "doc", content: [] },
        createdBy: person,
      })
      .returning(),
    "version",
  );
  return { member, person, project, page, version };
}

describe("kb_article_version triggers", () => {
  it("refuses edits and direct deletes, allows only created_by -> NULL, cascades with the article", async () => {
    const f = await kbFixture();
    await expect(
      db
        .update(kbArticleVersionTable)
        .set({ title: "changed" })
        .where(eq(kbArticleVersionTable.id, f.version.id)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(kbArticleVersionTable)
        .where(eq(kbArticleVersionTable.id, f.version.id)),
    ).rejects.toThrow();
    await db
      .update(kbArticleVersionTable)
      .set({ createdBy: null })
      .where(eq(kbArticleVersionTable.id, f.version.id));
    await db.delete(kbArticleTable).where(eq(kbArticleTable.id, f.article.id));
    const left = await db
      .select()
      .from(kbArticleVersionTable)
      .where(eq(kbArticleVersionTable.id, f.version.id));
    expect(left).toHaveLength(0);
  });
});

describe("project_page_version triggers", () => {
  it("refuses edits and direct deletes, cascades with the page", async () => {
    const f = await pageFixture();
    const { projectPageTable, projectPageVersionTable } = await import(
      "../../apps/api/src/database/schema-p5-pages"
    );
    await expect(
      db
        .update(projectPageVersionTable)
        .set({ title: "changed" })
        .where(eq(projectPageVersionTable.id, f.version.id)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(projectPageVersionTable)
        .where(eq(projectPageVersionTable.id, f.version.id)),
    ).rejects.toThrow();
    await db
      .update(projectPageVersionTable)
      .set({ createdBy: null })
      .where(eq(projectPageVersionTable.id, f.version.id));
    await db.delete(projectPageTable).where(eq(projectPageTable.id, f.page.id));
    const left = await db
      .select()
      .from(projectPageVersionTable)
      .where(eq(projectPageVersionTable.id, f.version.id));
    expect(left).toHaveLength(0);
  });
});

describe("P5 migrations are idempotent (P5-R2-07)", () => {
  it("re-runs 0150, 0152 and 0154 on a migrated database without error", async () => {
    const dir = path.resolve(__dirname, "../../apps/api/drizzle");
    for (const file of [
      "0150_p5_knowledge_base.sql",
      "0152_p5_reports_dashboards.sql",
      "0154_p5_project_pages.sql",
    ]) {
      const statements = readFileSync(path.join(dir, file), "utf8")
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) await db.execute(sql.raw(statement));
    }
    // The guards held and the triggers are still the strict ones.
    const f = await kbFixture();
    await expect(
      db
        .delete(kbArticleVersionTable)
        .where(eq(kbArticleVersionTable.id, f.version.id)),
    ).rejects.toThrow();
  });
});
