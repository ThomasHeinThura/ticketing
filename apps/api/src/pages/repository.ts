import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { personTable } from "../database/schema";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../database/schema-p5-pages";
import { KbBodyError, sanitiseKbBody } from "../kb/sanitise";
import { auditPage, type PageActor } from "./audit";
import {
  checkParent,
  isStale,
  PAGE_VERSION_COALESCE_WINDOW_MINUTES,
  type ParentRefusal,
  purgeDeadline,
  shouldCoalesceVersion,
  snippetOf,
} from "./logic";

export type PageRow = typeof projectPageTable.$inferSelect;
type Scope = { workspaceId: string; projectId: string };

/** PG-5: a stale save. Carries the current row's metadata for the 409 body. */
export class PageConflictError extends Error {
  constructor(readonly current: PageRow) {
    super("page_version_conflict");
  }
}

const PARENT_MESSAGES: Record<ParentRefusal, string> = {
  parent_is_self: "A page cannot be its own parent",
  parent_cycle: "A page cannot be moved under one of its own sub-pages",
  too_deep: "The page tree would be too deep",
};

/** Sanitise a client body with the knowledge-base allowlist; a rejected body is a 422. */
export function cleanBody(input: unknown) {
  try {
    return sanitiseKbBody(input);
  } catch (error) {
    if (error instanceof KbBodyError)
      throw new HTTPException(422, { message: error.message });
    throw error;
  }
}

const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };

async function peopleNames(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map<string, string | null>();
  const rows = await db
    .select({ id: personTable.id, name: personTable.displayName })
    .from(personTable)
    .where(inArray(personTable.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export function person(
  names: Map<string, string | null>,
  id: string | null,
): { id: string; name: string | null } | null {
  return id === null ? null : { id, name: names.get(id) ?? null };
}

export async function personFor(id: string | null) {
  return person(await peopleNames([id]), id);
}

/** Pages of a project, without bodies; deleted rows are returned only for recovery. */
export async function listPages(scope: Scope, deletedOnly = false) {
  const rows = await db
    .select({
      id: projectPageTable.id,
      projectId: projectPageTable.projectId,
      parentId: projectPageTable.parentId,
      title: projectPageTable.title,
      bodyText: projectPageTable.bodyText,
      version: projectPageTable.version,
      updatedBy: projectPageTable.updatedBy,
      createdAt: projectPageTable.createdAt,
      updatedAt: projectPageTable.updatedAt,
      deletedAt: projectPageTable.deletedAt,
      purgeAfter: projectPageTable.purgeAfter,
    })
    .from(projectPageTable)
    .where(
      and(
        eq(projectPageTable.workspaceId, scope.workspaceId),
        eq(projectPageTable.projectId, scope.projectId),
        deletedOnly
          ? isNotNull(projectPageTable.deletedAt)
          : isNull(projectPageTable.deletedAt),
      ),
    )
    .orderBy(asc(projectPageTable.title), asc(projectPageTable.id));
  const names = await peopleNames(rows.map((row) => row.updatedBy));
  return rows.map(({ bodyText, updatedBy, deletedAt, purgeAfter, ...row }) => ({
    ...row,
    snippet: snippetOf(bodyText),
    updatedBy: person(names, updatedBy),
    ...(deletedOnly ? { deletedAt, purgeAfter } : {}),
  }));
}

/** A live (not deleted) page of this project, or undefined. */
export async function findPage(scope: Scope, id: string, executor?: Executor) {
  const [row] = await (executor ?? db)
    .select()
    .from(projectPageTable)
    .where(
      and(
        eq(projectPageTable.id, id),
        eq(projectPageTable.workspaceId, scope.workspaceId),
        eq(projectPageTable.projectId, scope.projectId),
        isNull(projectPageTable.deletedAt),
      ),
    )
    .limit(1);
  return row;
}

async function lockPage(tx: Executor, scope: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(projectPageTable)
    .where(
      and(
        eq(projectPageTable.id, id),
        eq(projectPageTable.workspaceId, scope.workspaceId),
        eq(projectPageTable.projectId, scope.projectId),
        isNull(projectPageTable.deletedAt),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

async function liveTree(tx: Executor, scope: Scope) {
  return tx
    .select({ id: projectPageTable.id, parentId: projectPageTable.parentId })
    .from(projectPageTable)
    .where(
      and(
        eq(projectPageTable.projectId, scope.projectId),
        isNull(projectPageTable.deletedAt),
      ),
    );
}

/**
 * Serialises tree edits of one project. Lock order for every tree edit (move, delete, undelete):
 * this advisory lock FIRST, then the page row. Moving a child under P also key-shares P's row
 * (foreign key), so taking the row lock first would deadlock against a delete of P.
 */
export async function lockPageTree(tx: Executor, projectId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`project_page_tree:${projectId}`}))`,
  );
}

/** The parent must be a live page of the same project, and the move must keep the tree sound. */
async function assertParent(
  tx: Executor,
  scope: Scope,
  pageId: string | null,
  parentId: string | null,
) {
  if (parentId === null) return;
  // Serialise tree edits of one project, so two concurrent moves cannot form a cycle.
  await lockPageTree(tx, scope.projectId);
  const tree = await liveTree(tx, scope);
  if (!tree.some((page) => page.id === parentId))
    throw new HTTPException(422, { message: "The parent page was not found" });
  const refusal = checkParent(tree, pageId, parentId);
  if (refusal)
    throw new HTTPException(422, { message: PARENT_MESSAGES[refusal] });
}

async function writeVersion(
  tx: Executor,
  page: Pick<PageRow, "id" | "title" | "body" | "bodyText">,
  number: number,
  kind: "create" | "edit" | "restore",
  restoredFrom: number | null,
  personId: string,
) {
  await tx.insert(projectPageVersionTable).values({
    pageId: page.id,
    number,
    title: page.title,
    body: page.body,
    bodyText: page.bodyText,
    kind,
    restoredFrom,
    createdBy: personId,
  });
}

/** The page's latest version, with its coalescing window judged by the database clock. */
async function latestVersion(tx: Executor, pageId: string) {
  const [row] = await tx
    .select({
      id: projectPageVersionTable.id,
      kind: projectPageVersionTable.kind,
      number: projectPageVersionTable.number,
      createdBy: projectPageVersionTable.createdBy,
      withinWindow: sql<boolean>`${projectPageVersionTable.createdAt} > now() - make_interval(mins => ${PAGE_VERSION_COALESCE_WINDOW_MINUTES}::int)`,
    })
    .from(projectPageVersionTable)
    .where(eq(projectPageVersionTable.pageId, pageId))
    .orderBy(desc(projectPageVersionTable.number))
    .limit(1);
  return row;
}

/**
 * PG-4 autosave: writes the saved page into its latest version, renumbered to the page's new
 * version, so the latest history entry always matches the page. The caller holds the page row
 * lock, so the latest version cannot change in between.
 */
async function coalesceVersion(
  tx: Executor,
  versionId: string,
  page: Pick<PageRow, "title" | "body" | "bodyText">,
  number: number,
) {
  const [row] = await tx
    .update(projectPageVersionTable)
    .set({
      number,
      title: page.title,
      body: page.body,
      bodyText: page.bodyText,
      updatedAt: sql`now()`,
    })
    .where(eq(projectPageVersionTable.id, versionId))
    .returning({ id: projectPageVersionTable.id });
  if (!row) throw new Error("page version coalesce returned no row");
}

export async function createPage(
  scope: Scope,
  input: {
    title: string;
    body?: Record<string, unknown>;
    parentId?: string | null;
  },
  actor: PageActor,
) {
  const { doc, text } = input.body
    ? cleanBody(input.body)
    : { doc: EMPTY, text: "" };
  return db.transaction(async (tx) => {
    const parentId = input.parentId ?? null;
    await assertParent(tx, scope, null, parentId);
    const [row] = await tx
      .insert(projectPageTable)
      .values({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        parentId,
        title: input.title,
        body: doc,
        bodyText: text,
        version: 1,
        createdBy: actor.personId,
        updatedBy: actor.personId,
      })
      .returning();
    if (!row) throw new Error("page insert returned no row");
    await writeVersion(tx, row, 1, "create", null, actor.personId);
    await auditPage(tx, {
      action: "page.created",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      pageId: row.id,
      actor,
      after: { title: row.title, version: 1, parentId },
    });
    return row;
  });
}

export async function updatePage(
  scope: Scope,
  id: string,
  input: {
    expectedVersion: number;
    title?: string;
    body?: Record<string, unknown>;
    parentId?: string | null;
  },
  actor: PageActor,
): Promise<PageRow | undefined> {
  const cleaned = input.body ? cleanBody(input.body) : null;
  return db.transaction(async (tx) => {
    // A request that may re-parent the page takes the tree lock before the row lock.
    if (input.parentId !== undefined) await lockPageTree(tx, scope.projectId);
    const page = await lockPage(tx, scope, id);
    if (!page) return undefined;
    if (isStale(page.version, input.expectedVersion))
      throw new PageConflictError(page);
    const parentId =
      input.parentId === undefined ? page.parentId : input.parentId;
    if (parentId !== page.parentId) await assertParent(tx, scope, id, parentId);
    const next = page.version + 1;
    const [row] = await tx
      .update(projectPageTable)
      .set({
        title: input.title ?? page.title,
        body: cleaned ? cleaned.doc : page.body,
        bodyText: cleaned ? cleaned.text : page.bodyText,
        parentId,
        version: next,
        updatedBy: actor.personId,
        updatedAt: new Date(),
      })
      .where(eq(projectPageTable.id, id))
      .returning();
    if (!row) throw new Error("page update returned no row");
    // PG-4: the page version always advances (PG-5 chains on it); only the history row coalesces.
    const latest = await latestVersion(tx, id);
    const coalesced = shouldCoalesceVersion({
      latest,
      personId: actor.personId,
      pageVersion: page.version,
      titleChanged: row.title !== page.title,
      parentChanged: parentId !== page.parentId,
    });
    if (latest && coalesced) await coalesceVersion(tx, latest.id, row, next);
    else await writeVersion(tx, row, next, "edit", null, actor.personId);
    // PG-8: one audit row per save, coalesced or not; metadata only, never the body.
    await auditPage(tx, {
      action: "page.updated",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      pageId: id,
      actor,
      before: {
        title: page.title,
        version: page.version,
        parentId: page.parentId,
      },
      after: { title: row.title, version: next, parentId, coalesced },
    });
    return row;
  });
}

export async function listVersions(pageId: string) {
  const rows = await db
    .select({
      number: projectPageVersionTable.number,
      title: projectPageVersionTable.title,
      kind: projectPageVersionTable.kind,
      restoredFrom: projectPageVersionTable.restoredFrom,
      createdBy: projectPageVersionTable.createdBy,
      createdAt: projectPageVersionTable.createdAt,
      updatedAt: projectPageVersionTable.updatedAt,
    })
    .from(projectPageVersionTable)
    .where(eq(projectPageVersionTable.pageId, pageId))
    .orderBy(desc(projectPageVersionTable.number));
  const names = await peopleNames(rows.map((row) => row.createdBy));
  return rows.map(({ createdBy, kind, updatedAt, ...row }) => ({
    ...row,
    kind: kind as "create" | "edit" | "restore",
    createdBy: person(names, createdBy),
    // The time of the content this version holds: its last coalesced save, else its creation.
    updatedAt: updatedAt ?? row.createdAt,
  }));
}

export async function getVersion(pageId: string, number: number) {
  const [row] = await db
    .select()
    .from(projectPageVersionTable)
    .where(
      and(
        eq(projectPageVersionTable.pageId, pageId),
        eq(projectPageVersionTable.number, number),
      ),
    )
    .limit(1);
  return row;
}

/** PG-4: restoring copies an old version's title and body into a NEW version that is never coalesced. */
export async function restoreVersion(
  scope: Scope,
  id: string,
  input: { number: number; expectedVersion: number },
  actor: PageActor,
): Promise<PageRow | undefined | "version_missing"> {
  return db.transaction(async (tx) => {
    const page = await lockPage(tx, scope, id);
    if (!page) return undefined;
    if (isStale(page.version, input.expectedVersion))
      throw new PageConflictError(page);
    const [source] = await tx
      .select()
      .from(projectPageVersionTable)
      .where(
        and(
          eq(projectPageVersionTable.pageId, id),
          eq(projectPageVersionTable.number, input.number),
        ),
      )
      .limit(1);
    if (!source) return "version_missing";
    const next = page.version + 1;
    const [row] = await tx
      .update(projectPageTable)
      .set({
        title: source.title,
        body: source.body,
        bodyText: source.bodyText,
        version: next,
        updatedBy: actor.personId,
        updatedAt: new Date(),
      })
      .where(eq(projectPageTable.id, id))
      .returning();
    if (!row) throw new Error("page restore returned no row");
    await writeVersion(tx, row, next, "restore", input.number, actor.personId);
    await auditPage(tx, {
      action: "page.restored",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      pageId: id,
      actor,
      before: { version: page.version },
      after: { version: next, restoredFrom: input.number },
    });
    return row;
  });
}

/** Live child pages of a page: a page with children cannot be deleted (they must be moved first). */
export async function liveChildCount(tx: Executor, pageId: string) {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(projectPageTable)
    .where(
      and(
        eq(projectPageTable.parentId, pageId),
        isNull(projectPageTable.deletedAt),
      ),
    );
  return row?.count ?? 0;
}

export async function lockPageForDeletion(tx: Executor, id: string) {
  // Tree lock first (see lockPageTree), so a move under this page and its delete are serialised.
  const [found] = await tx
    .select({ projectId: projectPageTable.projectId })
    .from(projectPageTable)
    .where(eq(projectPageTable.id, id))
    .limit(1);
  if (!found) return undefined;
  await lockPageTree(tx, found.projectId);
  const [row] = await tx
    .select()
    .from(projectPageTable)
    .where(and(eq(projectPageTable.id, id), isNull(projectPageTable.deletedAt)))
    .for("update")
    .limit(1);
  return row;
}

/** PG-7: the soft delete the approved pending action runs. */
export async function softDeletePage(
  tx: Executor,
  page: PageRow,
  actor: PageActor,
): Promise<boolean> {
  const now = new Date();
  const [updated] = await tx
    .update(projectPageTable)
    .set({ deletedAt: now, purgeAfter: purgeDeadline(now) })
    .where(
      and(eq(projectPageTable.id, page.id), isNull(projectPageTable.deletedAt)),
    )
    .returning({ id: projectPageTable.id });
  if (!updated) return false;
  await auditPage(tx, {
    action: "page.deleted",
    workspaceId: page.workspaceId,
    projectId: page.projectId,
    pageId: page.id,
    actor,
    before: { title: page.title, version: page.version },
  });
  return true;
}

export type UndeleteRefusal =
  | "not_deleted"
  | "window_expired"
  | "parent_deleted";

/**
 * PG-7: restores a soft-deleted page inside its window. Delete only ever takes a page with no
 * live sub-pages, so the "subtree" of a deleted page is empty by construction; sub-pages deleted
 * earlier on their own stay deleted (their own window applies). The page keeps its parent: when
 * that parent has since been deleted the restore is refused rather than silently re-parenting,
 * and the caller restores the parent first. Contents and version are unchanged (no new version).
 */
export async function undeletePage(
  scope: Scope,
  id: string,
  actor: PageActor,
): Promise<PageRow | undefined | UndeleteRefusal> {
  return db.transaction(async (tx) => {
    await lockPageTree(tx, scope.projectId);
    const [page] = await tx
      .select()
      .from(projectPageTable)
      .where(
        and(
          eq(projectPageTable.id, id),
          eq(projectPageTable.workspaceId, scope.workspaceId),
          eq(projectPageTable.projectId, scope.projectId),
        ),
      )
      .for("update")
      .limit(1);
    if (!page) return undefined;
    if (page.deletedAt === null) return "not_deleted";
    const windowOpen =
      page.purgeAfter !== null && page.purgeAfter.getTime() > Date.now();
    if (!windowOpen) return "window_expired";
    if (page.parentId !== null) {
      // The tree lock taken above keeps the parent from being deleted under this restore.
      const [parent] = await tx
        .select({ id: projectPageTable.id })
        .from(projectPageTable)
        .where(
          and(
            eq(projectPageTable.id, page.parentId),
            isNull(projectPageTable.deletedAt),
          ),
        )
        .for("share")
        .limit(1);
      if (!parent) return "parent_deleted";
    }
    const [row] = await tx
      .update(projectPageTable)
      .set({ deletedAt: null, purgeAfter: null, updatedAt: new Date() })
      .where(eq(projectPageTable.id, id))
      .returning();
    if (!row) throw new Error("page undelete returned no row");
    await auditPage(tx, {
      action: "page.undeleted",
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      pageId: id,
      actor,
      before: { deletedAt: page.deletedAt.toISOString() },
      after: { title: row.title, version: row.version },
    });
    return row;
  });
}
