/**
 * P5-R2-03 / P5-R2-07: version rows are immutable (only the erased-author created_by -> NULL
 * change passes), cannot be deleted directly, still cascade with their parent, and the hand-written
 * P5 migrations 0150/0152/0154 (and 0212, the PG-4 autosave trigger) re-run without error.
 * 0212 lets through only the autosave coalescing update; each of its rules is refused directly.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  kbArticleTable,
  kbArticleVersionTable,
} from "../../apps/api/src/database/schema-p5-kb";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../apps/api/src/database/schema-p5-pages";
import { PAGE_VERSION_COALESCE_WINDOW_MINUTES } from "../../apps/api/src/pages/logic";
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

describe("project_page_version autosave coalescing (0212)", () => {
  type PageFixture = Awaited<ReturnType<typeof pageFixture>>;
  const newBody = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "coalesced" }] },
    ],
  };

  /**
   * The update updatePage makes when it coalesces: the page row advances by one and records
   * the author, then the latest version takes the new body, number and updated_at = now().
   * Each refusal below changes exactly one thing from this accepted update.
   */
  async function coalesce(
    f: PageFixture,
    change: {
      pageVersion?: number;
      updatedBy?: string;
      deletedAt?: Date;
      version?: PgUpdateSetSource<typeof projectPageVersionTable>;
    } = {},
  ) {
    const [current] = await db
      .select({ version: projectPageTable.version })
      .from(projectPageTable)
      .where(eq(projectPageTable.id, f.page.id));
    const next = (current?.version ?? 0) + 1;
    await db.transaction(async (tx) => {
      await tx
        .update(projectPageTable)
        .set({
          version: change.pageVersion ?? next,
          updatedBy: change.updatedBy ?? f.person,
          ...(change.deletedAt ? { deletedAt: change.deletedAt } : {}),
        })
        .where(eq(projectPageTable.id, f.page.id));
      await tx
        .update(projectPageVersionTable)
        .set({
          number: change.pageVersion ?? next,
          body: newBody,
          bodyText: "coalesced",
          updatedAt: sql`now()`,
          ...change.version,
        })
        .where(eq(projectPageVersionTable.id, f.version.id));
    });
  }

  it("accepts the update autosave makes, and refuses each departure from it", async () => {
    const f = await pageFixture();
    expect(f.version.kind).toBe("edit");
    const other = await personId(
      (await createWorkspaceMember({ role: "member" })).user.id,
    );
    const refusals: Array<[string, Parameters<typeof coalesce>[1]]> = [
      ["a title change", { version: { title: "renamed" } }],
      ["a renumber by more than one", { pageVersion: 3 }],
      ["another author's save", { updatedBy: other }],
      [
        "an updated_at other than now()",
        { version: { updatedAt: sql`now() - interval '1 second'` } },
      ],
      ["no updated_at", { version: { updatedAt: null } }],
      ["a kind change", { version: { kind: "restore" } }],
      ["an author change", { version: { createdBy: other } }],
      ["a deleted page", { deletedAt: new Date() }],
    ];
    for (const [name, change] of refusals) {
      await expect(coalesce(f, change), name).rejects.toThrow();
    }

    // The accepted update, on the same fixture the refusals used.
    await coalesce(f);
    const [row] = await db
      .select()
      .from(projectPageVersionTable)
      .where(eq(projectPageVersionTable.id, f.version.id));
    expect(row?.number).toBe(2);
    expect(row?.bodyText).toBe("coalesced");
    expect(row?.updatedAt).toBeInstanceOf(Date);
    // A second coalesce inside the window is accepted too.
    await coalesce(f);

    // Past the coalescing window (created_at moved with the trigger bypassed): refused.
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`UPDATE project_page_version SET created_at = now() - make_interval(mins => ${PAGE_VERSION_COALESCE_WINDOW_MINUTES + 1}::int) WHERE id = ${f.version.id}`,
      );
    });
    await expect(coalesce(f), "outside the window").rejects.toThrow();
  });

  it("refuses coalescing a version that is not the page's latest", async () => {
    const f = await pageFixture();
    // A later version 3 exists; renumbering v1 to 2 with the page at 2 meets every other rule.
    await db.transaction(async (tx) => {
      await tx
        .update(projectPageTable)
        .set({ version: 3, updatedBy: f.person })
        .where(eq(projectPageTable.id, f.page.id));
      await tx.insert(projectPageVersionTable).values({
        pageId: f.page.id,
        number: 3,
        title: "P",
        body: { type: "doc", content: [] },
        createdBy: f.person,
      });
    });
    await expect(coalesce(f, { pageVersion: 2 })).rejects.toThrow();
  });

  it("keeps the trigger's window equal to PAGE_VERSION_COALESCE_WINDOW_MINUTES", () => {
    const migration = readFileSync(
      path.resolve(
        __dirname,
        "../../apps/api/drizzle/0212_page_version_autosave_coalesce.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      `make_interval(mins => ${PAGE_VERSION_COALESCE_WINDOW_MINUTES})`,
    );
  });
});

describe("P5 migrations are idempotent (P5-R2-07)", () => {
  it("re-runs 0150, 0152, 0154 and 0212 on a migrated database without error", async () => {
    const dir = path.resolve(__dirname, "../../apps/api/drizzle");
    // 0212 re-runs after 0154 so the database keeps the current (autosave-aware) page trigger.
    for (const file of [
      "0150_p5_knowledge_base.sql",
      "0152_p5_reports_dashboards.sql",
      "0154_p5_project_pages.sql",
      "0212_page_version_autosave_coalesce.sql",
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
