// P5 pages tables (owned by the pages lane). Re-exported nowhere: import from this file directly.
// Mirrors apps/api/drizzle/0154_p5_project_pages.sql and 0212, the hand-written source of truth.
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
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
import { personTable, projectTable } from "./schema";

const tz = { mode: "date", withTimezone: true } as const;

/**
 * PG-1: a staff-only long-form document that belongs to exactly one project. `version` counts
 * saves (PG-4/PG-5); `parent_id` forms the tree and stays inside the project through the
 * composite self-reference. A soft-deleted page (PG-7) keeps its row and its versions.
 */
export const projectPageTable = pgTable(
  "project_page",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    parentId: text("parent_id"),
    title: text("title").notNull(),
    body: jsonb("body").notNull(),
    bodyText: text("body_text").default("").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedBy: text("updated_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", tz),
    purgeAfter: timestamp("purge_after", tz),
  },
  (table) => [
    foreignKey({
      name: "project_page_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    unique("project_page_project_id_id_unique").on(table.projectId, table.id),
    foreignKey({
      name: "project_page_parent_fk",
      columns: [table.projectId, table.parentId],
      foreignColumns: [table.projectId, table.id],
    }).onDelete("no action"),
    index("project_page_project_parent_idx").on(
      table.projectId,
      table.parentId,
    ),
    check("project_page_version_positive", sql.raw("version >= 1")),
    check("project_page_title_not_blank", sql.raw("length(btrim(title)) > 0")),
    check(
      "project_page_not_own_parent",
      sql.raw("parent_id IS DISTINCT FROM id"),
    ),
  ],
);

/**
 * PG-4: a version snapshot. Immutable (an UPDATE trigger refuses edits), except that autosave
 * coalescing (0212, Thomas 31 Oct 2026) may update the page's latest "edit" version by its author.
 */
export const projectPageVersionTable = pgTable(
  "project_page_version",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    pageId: text("page_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: jsonb("body").notNull(),
    bodyText: text("body_text").default("").notNull(),
    /** How the version came to exist: `create`, `edit` or `restore`. */
    kind: text("kind").notNull().default("edit"),
    restoredFrom: integer("restored_from"),
    createdBy: text("created_by").references(() => personTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    /** Set when later saves were coalesced into this version (0212); NULL otherwise. */
    updatedAt: timestamp("updated_at", tz),
  },
  (table) => [
    foreignKey({
      name: "project_page_version_page_id_fk",
      columns: [table.pageId],
      foreignColumns: [projectPageTable.id],
    }).onDelete("cascade"),
    unique("project_page_version_page_number_unique").on(
      table.pageId,
      table.number,
    ),
    check("project_page_version_number_positive", sql.raw("number >= 1")),
    check(
      "project_page_version_kind_allowed",
      sql.raw("kind IN ('create', 'edit', 'restore')"),
    ),
  ],
);
