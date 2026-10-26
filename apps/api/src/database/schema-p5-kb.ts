// P5 knowledge base tables (owned by the kb lane). Re-exported nowhere: import from this file directly.
// Mirrors apps/api/drizzle/0150_p5_knowledge_base.sql, which is the hand-written source of truth.
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  personTable,
  projectTable,
  requestTypeTable,
  workspaceTable,
} from "./schema";

const tz = { mode: "date", withTimezone: true } as const;

/** KB-1 / KB-14: a hierarchical grouping inside one workspace. */
export const kbCategoryTable = pgTable(
  "kb_category",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("kb_category_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    foreignKey({
      name: "kb_category_parent_fk",
      columns: [table.workspaceId, table.parentId],
      foreignColumns: [table.workspaceId, table.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    index("kb_category_workspace_idx").on(table.workspaceId, table.parentId),
    check(
      "kb_category_name_length",
      sql.raw("(char_length(name) >= 1) AND (char_length(name) <= 120)"),
    ),
    check(
      "kb_category_not_own_parent",
      sql.raw("parent_id IS NULL OR parent_id <> id"),
    ),
  ],
);

export const KB_ARTICLE_STATES = [
  "draft",
  "in_review",
  "published",
  "archived",
] as const;

/**
 * KB-1..KB-7. `body`/`title` are the working copy; customers only ever read the immutable
 * `kb_article_version` row numbered `published_version` (KB-2/KB-3), so editing a published
 * article never changes what customers see until it is published again.
 */
export const kbArticleTable = pgTable(
  "kb_article",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id"),
    categoryId: text("category_id"),
    title: text("title").notNull(),
    body: jsonb("body").notNull(),
    bodyText: text("body_text").default("").notNull(),
    state: text("state").default("draft").notNull(),
    customerVisible: boolean("customer_visible").default(false).notNull(),
    authorId: text("author_id").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    ownerId: text("owner_id").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reviewDueAt: timestamp("review_due_at", tz),
    viewCount: integer("view_count").default(0).notNull(),
    publishedAt: timestamp("published_at", tz),
    publishedVersion: integer("published_version"),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("kb_article_workspace_id_id_unique").on(table.workspaceId, table.id),
    foreignKey({
      name: "kb_article_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      // Articles go with a purged project: the workspace delete removes projects first.
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "kb_article_category_fk",
      columns: [table.workspaceId, table.categoryId],
      foreignColumns: [kbCategoryTable.workspaceId, kbCategoryTable.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    index("kb_article_workspace_state_idx").on(table.workspaceId, table.state),
    index("kb_article_category_idx").on(table.categoryId),
    index("kb_article_project_idx").on(table.projectId),
    index("kb_article_full_text_idx").using(
      "gin",
      sql`(setweight(to_tsvector('simple', coalesce(${table.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${table.bodyText}, '')), 'B'))`,
    ),
    index("kb_article_review_due_idx")
      .on(table.workspaceId, table.reviewDueAt)
      .where(sql.raw("(review_due_at IS NOT NULL)")),
    check(
      "kb_article_title_length",
      sql.raw("(char_length(title) >= 1) AND (char_length(title) <= 200)"),
    ),
    check(
      "kb_article_state_allowed",
      sql.raw(
        "state = ANY (ARRAY['draft'::text, 'in_review'::text, 'published'::text, 'archived'::text])",
      ),
    ),
    check(
      "kb_article_published_has_version",
      sql.raw("(state = 'published') = (published_version IS NOT NULL)"),
    ),
    check("kb_article_version_positive", sql.raw("version >= 1")),
    check("kb_article_view_count_nonnegative", sql.raw("view_count >= 0")),
  ],
);

/** KB-3: an immutable snapshot taken on each publish (an UPDATE trigger refuses edits). */
export const kbArticleVersionTable = pgTable(
  "kb_article_version",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => kbArticleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: jsonb("body").notNull(),
    bodyText: text("body_text").default("").notNull(),
    createdBy: text("created_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("kb_article_version_article_number_unique").on(
      table.articleId,
      table.number,
    ),
    index("kb_article_version_full_text_idx").using(
      "gin",
      sql`(setweight(to_tsvector('simple', coalesce(${table.title}, '')), 'A') || setweight(to_tsvector('simple', coalesce(${table.bodyText}, '')), 'B'))`,
    ),
    check("kb_article_version_number_positive", sql.raw("number >= 1")),
  ],
);

/** KB-17: one helpful / not-helpful answer per person and article (re-answering replaces it). */
export const kbArticleFeedbackTable = pgTable(
  "kb_article_feedback",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    articleId: text("article_id")
      .notNull()
      .references(() => kbArticleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    personId: text("person_id")
      .notNull()
      .references(() => personTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    helpful: boolean("helpful").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("kb_article_feedback_person_unique").on(
      table.articleId,
      table.personId,
    ),
    index("kb_article_feedback_person_idx").on(table.personId),
    check(
      "kb_article_feedback_comment_length",
      sql.raw("comment IS NULL OR char_length(comment) <= 2000"),
    ),
  ],
);

/** KB-10: a candidate when a customer opens an article from the request form; abandoned_at makes it a deflection. */
export const deflectionEventTable = pgTable(
  "deflection_event",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    personId: text("person_id")
      .notNull()
      .references(() => personTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    requestTypeId: text("request_type_id").references(
      () => requestTypeTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    kbArticleId: text("kb_article_id")
      .notNull()
      .references(() => kbArticleTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    query: text("query").default("").notNull(),
    abandonedAt: timestamp("abandoned_at", tz),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    index("deflection_event_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("deflection_event_article_idx").on(table.kbArticleId),
    index("deflection_event_person_idx").on(table.personId),
    check(
      "deflection_event_query_length",
      sql.raw("char_length(query) <= 500"),
    ),
  ],
);
