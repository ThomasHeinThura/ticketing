import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { AUDIT_ONLY_ACTIONS } from "../audit/actions";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  personTable,
  projectTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import {
  deflectionEventTable,
  kbArticleFeedbackTable,
  kbArticleTable,
  kbArticleVersionTable,
  kbCategoryTable,
} from "../database/schema-p5-kb";
import { assertRowNotUnderLegalHold } from "../utils/workspace-legal-hold";
import { kbFullText } from "./full-text";
import {
  type ArticleAction,
  type ArticleState,
  nextState,
  reviewOverdue,
  searchTerms,
  snippet,
  TransitionError,
} from "./logic";
import {
  EMPTY_BODY,
  extractText,
  KbBodyError,
  type KbNode,
  sanitiseKbBody,
  toCustomerBody,
} from "./sanitise";

export type KbActor = {
  userId: string;
  personId: string | null;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

/** Thrown on a stale `version`; carries the current article so the caller can show a diff. */
export class KbVersionConflict extends Error {
  constructor(readonly current: ArticleDetail) {
    super("version_conflict");
  }
}

type ArticleRow = typeof kbArticleTable.$inferSelect;

async function audit(
  tx: Executor,
  actor: KbActor,
  input: {
    action: string;
    workspaceId: string;
    entityType: string;
    entityId: string;
    projectId?: string | null;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  // The actions are part of the closed catalogue; fail loudly in development if they drift.
  if (!AUDIT_ONLY_ACTIONS.has(input.action))
    throw new Error(`Unregistered audit action ${input.action}`);
  await appendAuditLog(tx, {
    actorId: actor.userId,
    actorType: actor.actorType,
    apiKeyId: actor.apiKeyId,
    workspaceId: input.workspaceId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}

// ---------------------------------------------------------------------------------------
// Reach and lookups

/** Articles a caller may see: workspace-wide ones plus those of projects within their reach. */
export function staffScope(workspaceId: string, reachableProjectIds: string[]) {
  return and(
    eq(kbArticleTable.workspaceId, workspaceId),
    reachableProjectIds.length > 0
      ? or(
          isNull(kbArticleTable.projectId),
          inArray(kbArticleTable.projectId, reachableProjectIds),
        )
      : isNull(kbArticleTable.projectId),
  );
}

export async function getArticleWorkspace(id: string) {
  const [row] = await db
    .select({
      id: kbArticleTable.id,
      workspaceId: kbArticleTable.workspaceId,
      projectId: kbArticleTable.projectId,
    })
    .from(kbArticleTable)
    .where(eq(kbArticleTable.id, id))
    .limit(1);
  return row;
}

export async function getCategoryWorkspace(id: string) {
  const [row] = await db
    .select({
      id: kbCategoryTable.id,
      workspaceId: kbCategoryTable.workspaceId,
    })
    .from(kbCategoryTable)
    .where(eq(kbCategoryTable.id, id))
    .limit(1);
  return row;
}

export async function personIdOfUser(userId: string) {
  const [row] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(and(eq(personTable.userId, userId), eq(personTable.side, "staff")))
    .limit(1);
  return row?.id ?? null;
}

async function personNames(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  const rows = await db
    .select({
      id: personTable.id,
      displayName: personTable.displayName,
      userName: userTable.name,
    })
    .from(personTable)
    .leftJoin(userTable, eq(userTable.id, personTable.userId))
    .where(inArray(personTable.id, wanted));
  for (const row of rows)
    names.set(row.id, row.displayName ?? row.userName ?? "");
  return names;
}

export async function reviewStepEnabled(
  workspaceId: string,
  executor: Executor = db,
) {
  const [row] = await executor
    .select({ enabled: workspaceTable.kbReviewStepEnabled })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  return row?.enabled ?? false;
}

export async function setReviewStepEnabled(
  workspaceId: string,
  enabled: boolean,
  actor: KbActor,
) {
  return db.transaction(async (tx) => {
    const before = await reviewStepEnabled(workspaceId, tx);
    await tx
      .update(workspaceTable)
      .set({ kbReviewStepEnabled: enabled })
      .where(eq(workspaceTable.id, workspaceId));
    if (before !== enabled)
      await audit(tx, actor, {
        action: "kb.settings_changed",
        workspaceId,
        entityType: "workspace",
        entityId: workspaceId,
        before: { reviewStepEnabled: before },
        after: { reviewStepEnabled: enabled },
      });
    return { reviewStepEnabled: enabled };
  });
}

// ---------------------------------------------------------------------------------------
// Shapes

export type ArticleSummary = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  categoryId: string | null;
  title: string;
  snippet: string;
  state: ArticleState;
  customerVisible: boolean;
  ownerId: string | null;
  ownerName: string | null;
  authorId: string | null;
  authorName: string | null;
  reviewDueAt: string | null;
  overdue: boolean;
  viewCount: number;
  publishedAt: string | null;
  publishedVersion: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ArticleDetail = ArticleSummary & {
  body: unknown;
  hasUnpublishedChanges: boolean;
  versionCount: number;
  categoryName: string | null;
};

function summarise(
  row: ArticleRow,
  names: Map<string, string>,
  now: Date,
): ArticleSummary {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    categoryId: row.categoryId,
    title: row.title,
    snippet: snippet(row.bodyText),
    state: row.state as ArticleState,
    customerVisible: row.customerVisible,
    ownerId: row.ownerId,
    ownerName: row.ownerId ? (names.get(row.ownerId) ?? null) : null,
    authorId: row.authorId,
    authorName: row.authorId ? (names.get(row.authorId) ?? null) : null,
    reviewDueAt: row.reviewDueAt?.toISOString() ?? null,
    overdue: row.state !== "archived" && reviewOverdue(row.reviewDueAt, now),
    viewCount: row.viewCount,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishedVersion: row.publishedVersion,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function summaries(rows: ArticleRow[]) {
  const names = await personNames(
    rows.flatMap((row) => [row.ownerId, row.authorId]),
  );
  const now = new Date();
  return rows.map((row) => summarise(row, names, now));
}

async function detail(
  row: ArticleRow,
  executor: Executor = db,
): Promise<ArticleDetail> {
  const [summary] = await summaries([row]);
  if (!summary) throw new Error("unreachable");
  const [versions] = await executor
    .select({ total: count() })
    .from(kbArticleVersionTable)
    .where(eq(kbArticleVersionTable.articleId, row.id));
  let hasUnpublishedChanges = false;
  if (row.state === "published" && row.publishedVersion !== null) {
    const [published] = await executor
      .select({
        title: kbArticleVersionTable.title,
        body: kbArticleVersionTable.body,
      })
      .from(kbArticleVersionTable)
      .where(
        and(
          eq(kbArticleVersionTable.articleId, row.id),
          eq(kbArticleVersionTable.number, row.publishedVersion),
        ),
      )
      .limit(1);
    hasUnpublishedChanges =
      !published ||
      published.title !== row.title ||
      JSON.stringify(published.body) !== JSON.stringify(row.body);
  }
  let categoryName: string | null = null;
  if (row.categoryId) {
    const [category] = await executor
      .select({ name: kbCategoryTable.name })
      .from(kbCategoryTable)
      .where(eq(kbCategoryTable.id, row.categoryId))
      .limit(1);
    categoryName = category?.name ?? null;
  }
  return {
    ...summary,
    body: row.body,
    hasUnpublishedChanges,
    versionCount: versions?.total ?? 0,
    categoryName,
  };
}

// ---------------------------------------------------------------------------------------
// Relevance (KB-9): shared weighted Postgres full-text search, with title weight A and body B.

export function relevance(
  terms: string[],
  title: SQLWrapper,
  body: SQLWrapper,
) {
  const fullText = kbFullText(terms, title, body);
  return {
    titleHits: sql`(CASE WHEN ${fullText.titleMatches} THEN 1 ELSE 0 END)`,
    score: fullText.score,
    matches: fullText.matches,
    hasQuery: fullText.query !== undefined,
  };
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "how",
  "can",
  "you",
  "not",
  "are",
  "was",
  "this",
  "that",
  "have",
  "from",
  "has",
  "does",
  "why",
  "what",
  "when",
  "where",
  "who",
  "but",
  "all",
  "any",
  "our",
  "your",
  "need",
  "help",
  "please",
  "get",
  "got",
]);

/** Words of a request summary that are worth matching on. */
export function deflectionTerms(query: string) {
  return searchTerms(query).filter(
    (term) => term.length >= 3 && !STOP_WORDS.has(term),
  );
}

// ---------------------------------------------------------------------------------------
// Agent reads

export async function listArticles(input: {
  workspaceId: string;
  reachableProjectIds: string[];
  q?: string;
  state?: ArticleState;
  categoryId?: string;
  ownerId?: string;
  overdue?: boolean;
  sort: "updated" | "views" | "title";
  limit: number;
  offset: number;
}) {
  const terms = input.q ? searchTerms(input.q) : [];
  const rel = relevance(terms, kbArticleTable.title, kbArticleTable.bodyText);
  const conditions = [
    staffScope(input.workspaceId, input.reachableProjectIds),
    input.state ? eq(kbArticleTable.state, input.state) : undefined,
    input.categoryId
      ? eq(kbArticleTable.categoryId, input.categoryId)
      : undefined,
    input.ownerId ? eq(kbArticleTable.ownerId, input.ownerId) : undefined,
    input.overdue
      ? and(
          ne(kbArticleTable.state, "archived"),
          isNotNull(kbArticleTable.reviewDueAt),
          lt(kbArticleTable.reviewDueAt, new Date()),
        )
      : undefined,
    input.q?.trim() ? (rel.hasQuery ? rel.matches : sql`false`) : undefined,
  ];
  const where = and(...conditions);
  const order =
    terms.length > 0
      ? [desc(rel.score), desc(kbArticleTable.updatedAt)]
      : input.sort === "views"
        ? [desc(kbArticleTable.viewCount), desc(kbArticleTable.updatedAt)]
        : input.sort === "title"
          ? [asc(sql`lower(${kbArticleTable.title})`)]
          : [desc(kbArticleTable.updatedAt)];
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(kbArticleTable)
      .where(where)
      .orderBy(...order, asc(kbArticleTable.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ total: count() }).from(kbArticleTable).where(where),
  ]);
  return { articles: await summaries(rows), total: total?.total ?? 0 };
}

/** KB-13: staff search across title and body, reach-filtered, ranked with titles first. */
export async function searchArticles(input: {
  workspaceId: string;
  reachableProjectIds: string[];
  projectId?: string;
  q: string;
  limit: number;
}) {
  const terms = searchTerms(input.q);
  const rel = relevance(terms, kbArticleTable.title, kbArticleTable.bodyText);
  if (!rel.hasQuery) return [];
  const rows = await db
    .select({ article: kbArticleTable, relevanceScore: rel.score })
    .from(kbArticleTable)
    .where(
      and(
        staffScope(input.workspaceId, input.reachableProjectIds),
        input.projectId
          ? or(
              isNull(kbArticleTable.projectId),
              eq(kbArticleTable.projectId, input.projectId),
            )
          : undefined,
        rel.matches,
      ),
    )
    .orderBy(
      desc(rel.score),
      desc(kbArticleTable.updatedAt),
      asc(kbArticleTable.id),
    )
    .limit(input.limit);
  const articles = await summaries(rows.map((row) => row.article));
  return articles.map((article, index) => ({
    ...article,
    relevanceScore: Number(rows[index]?.relevanceScore ?? 0),
  }));
}

export async function getArticle(
  id: string,
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const [row] = await db
    .select()
    .from(kbArticleTable)
    .where(
      and(
        eq(kbArticleTable.id, id),
        staffScope(workspaceId, reachableProjectIds),
      ),
    )
    .limit(1);
  return row ? detail(row) : undefined;
}

/** KB-15: same category first, then shared title words; only what the caller may see. */
export async function relatedArticles(
  article: { id: string; categoryId: string | null; title: string },
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const terms = deflectionTerms(article.title).filter((t) => t.length >= 4);
  const rel = relevance(terms, kbArticleTable.title, kbArticleTable.bodyText);
  const sameCategory = article.categoryId
    ? sql`(CASE WHEN ${kbArticleTable.categoryId} = ${article.categoryId} THEN 1 ELSE 0 END)`
    : sql`0`;
  const rows = await db
    .select()
    .from(kbArticleTable)
    .where(
      and(
        staffScope(workspaceId, reachableProjectIds),
        ne(kbArticleTable.id, article.id),
        ne(kbArticleTable.state, "archived"),
        or(
          article.categoryId
            ? eq(kbArticleTable.categoryId, article.categoryId)
            : undefined,
          rel.hasQuery ? sql`(${rel.titleHits}) >= 1` : undefined,
        ),
      ),
    )
    .orderBy(
      desc(sql`(${sameCategory}) * 5 + (${rel.titleHits})`),
      desc(kbArticleTable.viewCount),
      asc(kbArticleTable.id),
    )
    .limit(5);
  return summaries(rows);
}

/** KB-12: published articles that match a request summary, for triage. */
export async function staffDeflection(input: {
  workspaceId: string;
  reachableProjectIds: string[];
  q: string;
}) {
  const terms = deflectionTerms(input.q);
  if (terms.length === 0) return [];
  const rel = relevance(terms, kbArticleTable.title, kbArticleTable.bodyText);
  const rows = await db
    .select()
    .from(kbArticleTable)
    .where(
      and(
        staffScope(input.workspaceId, input.reachableProjectIds),
        eq(kbArticleTable.state, "published"),
        rel.matches,
      ),
    )
    .orderBy(
      desc(rel.score),
      desc(kbArticleTable.viewCount),
      asc(kbArticleTable.id),
    )
    .limit(5);
  return summaries(rows);
}

// ---------------------------------------------------------------------------------------
// Agent writes

async function validateScope(
  executor: Executor,
  workspaceId: string,
  input: {
    projectId?: string | null;
    categoryId?: string | null;
    ownerId?: string | null;
  },
  projectReaches: (project: {
    id: string;
    workspaceId: string;
    organisationId: string | null;
  }) => Promise<boolean>,
) {
  if (input.projectId) {
    const [project] = await executor
      .select({
        id: projectTable.id,
        workspaceId: projectTable.workspaceId,
        organisationId: projectTable.organisationId,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.id, input.projectId),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .limit(1);
    // An unreachable project is answered like a missing one.
    if (!project || !(await projectReaches(project)))
      throw new HTTPException(404, { message: "Project not found" });
  }
  if (input.categoryId) {
    const [category] = await executor
      .select({ id: kbCategoryTable.id })
      .from(kbCategoryTable)
      .where(
        and(
          eq(kbCategoryTable.id, input.categoryId),
          eq(kbCategoryTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!category)
      throw new HTTPException(404, { message: "Category not found" });
  }
  if (input.ownerId) {
    const [owner] = await executor
      .select({ id: personTable.id })
      .from(personTable)
      .innerJoin(
        workspaceUserTable,
        and(
          eq(workspaceUserTable.userId, personTable.userId),
          eq(workspaceUserTable.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(personTable.id, input.ownerId),
          eq(personTable.side, "staff"),
          eq(personTable.active, true),
        ),
      )
      .limit(1);
    if (!owner) throw new HTTPException(404, { message: "Owner not found" });
  }
}

function cleanBody(raw: unknown): { doc: KbNode; text: string } {
  try {
    return sanitiseKbBody(raw ?? EMPTY_BODY);
  } catch (error) {
    if (error instanceof KbBodyError)
      throw new HTTPException(400, { message: error.message });
    throw error;
  }
}

function articleAudit(row: ArticleRow) {
  return {
    title: row.title,
    state: row.state,
    customerVisible: row.customerVisible,
    projectId: row.projectId,
    categoryId: row.categoryId,
    ownerId: row.ownerId,
    version: row.version,
    publishedVersion: row.publishedVersion,
  };
}

export async function createArticle(input: {
  workspaceId: string;
  title: string;
  body?: unknown;
  projectId?: string | null;
  categoryId?: string | null;
  customerVisible?: boolean;
  ownerId?: string | null;
  reviewDueAt?: string | null;
  actor: KbActor;
  projectReaches: Parameters<typeof validateScope>[3];
}) {
  const cleaned = cleanBody(input.body);
  return db.transaction(async (tx) => {
    await validateScope(tx, input.workspaceId, input, input.projectReaches);
    const [row] = await tx
      .insert(kbArticleTable)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        categoryId: input.categoryId ?? null,
        title: input.title,
        body: cleaned.doc,
        bodyText: cleaned.text,
        customerVisible: input.customerVisible ?? false,
        authorId: input.actor.personId,
        ownerId: input.ownerId ?? input.actor.personId,
        reviewDueAt: input.reviewDueAt ? new Date(input.reviewDueAt) : null,
      })
      .returning();
    if (!row) throw new Error("article insert failed");
    await audit(tx, input.actor, {
      action: "kb_article.created",
      workspaceId: row.workspaceId,
      entityType: "kb_article",
      entityId: row.id,
      after: articleAudit(row),
    });
    return detail(row, tx);
  });
}

async function lockArticle(
  tx: Executor,
  id: string,
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const [row] = await tx
    .select()
    .from(kbArticleTable)
    .where(
      and(
        eq(kbArticleTable.id, id),
        staffScope(workspaceId, reachableProjectIds),
      ),
    )
    .for("update")
    .limit(1);
  return row;
}

export async function updateArticle(input: {
  id: string;
  workspaceId: string;
  reachableProjectIds: string[];
  version: number;
  changes: {
    title?: string;
    body?: unknown;
    projectId?: string | null;
    categoryId?: string | null;
    customerVisible?: boolean;
    ownerId?: string | null;
    reviewDueAt?: string | null;
  };
  actor: KbActor;
  projectReaches: Parameters<typeof validateScope>[3];
  /** Raised when the caller changes exposure (customer visibility, project) without publish. */
  mayChangeExposure: boolean;
}) {
  const cleaned =
    input.changes.body === undefined ? null : cleanBody(input.changes.body);
  return db.transaction(async (tx) => {
    const current = await lockArticle(
      tx,
      input.id,
      input.workspaceId,
      input.reachableProjectIds,
    );
    if (!current) return undefined;
    const changesExposure =
      (input.changes.customerVisible !== undefined &&
        input.changes.customerVisible !== current.customerVisible) ||
      (input.changes.projectId !== undefined &&
        input.changes.projectId !== current.projectId);
    if (changesExposure && !input.mayChangeExposure)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    if (current.version !== input.version)
      throw new KbVersionConflict(await detail(current, tx));
    await validateScope(
      tx,
      input.workspaceId,
      input.changes,
      input.projectReaches,
    );
    const set: Partial<typeof kbArticleTable.$inferInsert> = {
      version: current.version + 1,
      updatedAt: new Date(),
    };
    const { changes } = input;
    if (changes.title !== undefined) set.title = changes.title;
    if (cleaned) {
      set.body = cleaned.doc;
      set.bodyText = cleaned.text;
    }
    if (changes.projectId !== undefined) set.projectId = changes.projectId;
    if (changes.categoryId !== undefined) set.categoryId = changes.categoryId;
    if (changes.customerVisible !== undefined)
      set.customerVisible = changes.customerVisible;
    if (changes.ownerId !== undefined) set.ownerId = changes.ownerId;
    if (changes.reviewDueAt !== undefined)
      set.reviewDueAt = changes.reviewDueAt
        ? new Date(changes.reviewDueAt)
        : null;
    const [row] = await tx
      .update(kbArticleTable)
      .set(set)
      .where(eq(kbArticleTable.id, current.id))
      .returning();
    if (!row) throw new Error("article update failed");
    await audit(tx, input.actor, {
      action: "kb_article.updated",
      workspaceId: row.workspaceId,
      entityType: "kb_article",
      entityId: row.id,
      before: articleAudit(current),
      after: articleAudit(row),
    });
    return detail(row, tx);
  });
}

const TRANSITION_AUDIT: Record<ArticleAction, string> = {
  submit: "kb_article.submitted",
  publish: "kb_article.published",
  unpublish: "kb_article.unpublished",
  archive: "kb_article.archived",
  restore: "kb_article.restored",
};

export async function transitionArticle(input: {
  id: string;
  workspaceId: string;
  reachableProjectIds: string[];
  version: number;
  action: ArticleAction;
  actor: KbActor;
}) {
  return db.transaction(async (tx) => {
    const current = await lockArticle(
      tx,
      input.id,
      input.workspaceId,
      input.reachableProjectIds,
    );
    if (!current) return undefined;
    if (current.version !== input.version)
      throw new KbVersionConflict(await detail(current, tx));
    let state: ArticleState;
    try {
      state = nextState(
        current.state as ArticleState,
        input.action,
        await reviewStepEnabled(current.workspaceId, tx),
      );
    } catch (error) {
      if (error instanceof TransitionError)
        throw new HTTPException(409, { message: error.message });
      throw error;
    }
    const set: Partial<typeof kbArticleTable.$inferInsert> = {
      state,
      version: current.version + 1,
      updatedAt: new Date(),
    };
    if (input.action === "publish") {
      const [latest] = await tx
        .select({
          number: sql<number>`coalesce(max(${kbArticleVersionTable.number}), 0)`,
        })
        .from(kbArticleVersionTable)
        .where(eq(kbArticleVersionTable.articleId, current.id));
      const number = (latest?.number ?? 0) + 1;
      await tx.insert(kbArticleVersionTable).values({
        articleId: current.id,
        number,
        title: current.title,
        body: current.body,
        // Portal search and snippets read this column, so it holds the customer's view of the
        // text: internal callouts and work item references must not be searchable or quoted.
        bodyText: extractText(toCustomerBody(current.body as KbNode)),
        createdBy: input.actor.personId,
      });
      set.publishedVersion = number;
      set.publishedAt = new Date();
    } else if (input.action === "unpublish" || input.action === "archive") {
      set.publishedVersion = null;
    }
    const [row] = await tx
      .update(kbArticleTable)
      .set(set)
      .where(eq(kbArticleTable.id, current.id))
      .returning();
    if (!row) throw new Error("article transition failed");
    await audit(tx, input.actor, {
      action: TRANSITION_AUDIT[input.action],
      workspaceId: row.workspaceId,
      entityType: "kb_article",
      entityId: row.id,
      before: articleAudit(current),
      after: articleAudit(row),
    });
    return detail(row, tx);
  });
}

export async function listVersions(
  id: string,
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const article = await getArticleRow(id, workspaceId, reachableProjectIds);
  if (!article) return undefined;
  const rows = await db
    .select({
      number: kbArticleVersionTable.number,
      title: kbArticleVersionTable.title,
      createdBy: kbArticleVersionTable.createdBy,
      createdAt: kbArticleVersionTable.createdAt,
    })
    .from(kbArticleVersionTable)
    .where(eq(kbArticleVersionTable.articleId, id))
    .orderBy(desc(kbArticleVersionTable.number));
  const names = await personNames(rows.map((row) => row.createdBy));
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    current: row.number === article.publishedVersion,
  }));
}

async function getArticleRow(
  id: string,
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const [row] = await db
    .select()
    .from(kbArticleTable)
    .where(
      and(
        eq(kbArticleTable.id, id),
        staffScope(workspaceId, reachableProjectIds),
      ),
    )
    .limit(1);
  return row;
}

export async function getVersion(
  id: string,
  workspaceId: string,
  reachableProjectIds: string[],
  number: number,
) {
  const article = await getArticleRow(id, workspaceId, reachableProjectIds);
  if (!article) return undefined;
  const [row] = await db
    .select()
    .from(kbArticleVersionTable)
    .where(
      and(
        eq(kbArticleVersionTable.articleId, id),
        eq(kbArticleVersionTable.number, number),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return {
    number: row.number,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    current: row.number === article.publishedVersion,
  };
}

/** KB-3: restoring copies a past version into the working copy; it does not publish. */
export async function restoreVersion(input: {
  id: string;
  workspaceId: string;
  reachableProjectIds: string[];
  number: number;
  version: number;
  actor: KbActor;
}) {
  return db.transaction(async (tx) => {
    const current = await lockArticle(
      tx,
      input.id,
      input.workspaceId,
      input.reachableProjectIds,
    );
    if (!current) return undefined;
    if (current.version !== input.version)
      throw new KbVersionConflict(await detail(current, tx));
    const [past] = await tx
      .select()
      .from(kbArticleVersionTable)
      .where(
        and(
          eq(kbArticleVersionTable.articleId, current.id),
          eq(kbArticleVersionTable.number, input.number),
        ),
      )
      .limit(1);
    if (!past) throw new HTTPException(404, { message: "Version not found" });
    const [row] = await tx
      .update(kbArticleTable)
      .set({
        title: past.title,
        body: past.body,
        bodyText: sanitiseKbBody(past.body).text,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(kbArticleTable.id, current.id))
      .returning();
    if (!row) throw new Error("restore failed");
    await audit(tx, input.actor, {
      action: "kb_article.version_restored",
      workspaceId: row.workspaceId,
      entityType: "kb_article",
      entityId: row.id,
      before: { version: current.version },
      after: { version: row.version, restoredNumber: input.number },
    });
    return detail(row, tx);
  });
}

// ---------------------------------------------------------------------------------------
// Categories

export type CategoryRow = {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  position: number;
  articleCount: number;
};

export async function listCategories(
  workspaceId: string,
  reachableProjectIds: string[],
): Promise<CategoryRow[]> {
  const [categories, counts] = await Promise.all([
    db
      .select()
      .from(kbCategoryTable)
      .where(eq(kbCategoryTable.workspaceId, workspaceId))
      .orderBy(asc(kbCategoryTable.position), asc(kbCategoryTable.name)),
    db
      .select({ categoryId: kbArticleTable.categoryId, total: count() })
      .from(kbArticleTable)
      .where(
        and(
          staffScope(workspaceId, reachableProjectIds),
          isNotNull(kbArticleTable.categoryId),
          ne(kbArticleTable.state, "archived"),
        ),
      )
      .groupBy(kbArticleTable.categoryId),
  ]);
  const totals = new Map(counts.map((row) => [row.categoryId, row.total]));
  return categories.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    parentId: row.parentId,
    position: row.position,
    articleCount: totals.get(row.id) ?? 0,
  }));
}

const MAX_CATEGORY_DEPTH = 4;

async function assertParentOk(
  tx: Executor,
  workspaceId: string,
  parentId: string | null | undefined,
  selfId: string | null,
) {
  if (!parentId) return;
  const rows = await tx
    .select({ id: kbCategoryTable.id, parentId: kbCategoryTable.parentId })
    .from(kbCategoryTable)
    .where(eq(kbCategoryTable.workspaceId, workspaceId));
  const byId = new Map(rows.map((row) => [row.id, row.parentId]));
  if (!byId.has(parentId))
    throw new HTTPException(404, { message: "Category not found" });
  let depth = 1;
  let cursor: string | null | undefined = parentId;
  while (cursor) {
    if (cursor === selfId)
      throw new HTTPException(409, {
        message: "A category cannot be moved under itself",
      });
    depth += 1;
    cursor = byId.get(cursor);
    if (depth > MAX_CATEGORY_DEPTH + 1) break;
  }
  if (depth > MAX_CATEGORY_DEPTH)
    throw new HTTPException(409, {
      message: "Categories nest at most four levels",
    });
}

export async function createCategory(input: {
  workspaceId: string;
  name: string;
  parentId?: string | null;
  position?: number;
  actor: KbActor;
}) {
  return db.transaction(async (tx) => {
    await assertParentOk(tx, input.workspaceId, input.parentId, null);
    const [row] = await tx
      .insert(kbCategoryTable)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        parentId: input.parentId ?? null,
        position: input.position ?? 0,
      })
      .returning();
    if (!row) throw new Error("category insert failed");
    await audit(tx, input.actor, {
      action: "kb_category.created",
      workspaceId: row.workspaceId,
      entityType: "kb_category",
      entityId: row.id,
      after: { name: row.name, parentId: row.parentId },
    });
    return toCategory(row);
  });
}

function toCategory(row: typeof kbCategoryTable.$inferSelect): CategoryRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    parentId: row.parentId,
    position: row.position,
    articleCount: 0,
  };
}

export async function updateCategory(input: {
  id: string;
  workspaceId: string;
  changes: { name?: string; parentId?: string | null; position?: number };
  actor: KbActor;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(kbCategoryTable)
      .where(
        and(
          eq(kbCategoryTable.id, input.id),
          eq(kbCategoryTable.workspaceId, input.workspaceId),
        ),
      )
      .for("update")
      .limit(1);
    if (!current) return undefined;
    if (input.changes.parentId !== undefined)
      await assertParentOk(
        tx,
        input.workspaceId,
        input.changes.parentId,
        current.id,
      );
    const [row] = await tx
      .update(kbCategoryTable)
      .set({ ...input.changes, updatedAt: new Date() })
      .where(eq(kbCategoryTable.id, current.id))
      .returning();
    if (!row) throw new Error("category update failed");
    await audit(tx, input.actor, {
      action: "kb_category.updated",
      workspaceId: row.workspaceId,
      entityType: "kb_category",
      entityId: row.id,
      before: { name: current.name, parentId: current.parentId },
      after: { name: row.name, parentId: row.parentId },
    });
    return toCategory(row);
  });
}

/** Edge case: a category with articles (or sub-categories) is refused until they move. */
export async function categoryDeletionBlockers(
  executor: Executor,
  id: string,
): Promise<string[]> {
  const [[articles], [children]] = await Promise.all([
    executor
      .select({ total: count() })
      .from(kbArticleTable)
      .where(eq(kbArticleTable.categoryId, id)),
    executor
      .select({ total: count() })
      .from(kbCategoryTable)
      .where(eq(kbCategoryTable.parentId, id)),
  ]);
  const blockers: string[] = [];
  if ((articles?.total ?? 0) > 0)
    blockers.push("The category still has articles; move them first.");
  if ((children?.total ?? 0) > 0)
    blockers.push("The category still has sub-categories; move them first.");
  return blockers;
}

export async function getCategory(id: string, workspaceId: string) {
  const [row] = await db
    .select()
    .from(kbCategoryTable)
    .where(
      and(
        eq(kbCategoryTable.id, id),
        eq(kbCategoryTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return row;
}

export async function deleteCategoryRow(
  tx: Executor,
  id: string,
  workspaceId: string,
  actor: KbActor,
) {
  // PA-12: a category carries no person data of its own; the organisation of its workspace is held.
  await assertRowNotUnderLegalHold(tx, { workspaceId });
  const [row] = await tx
    .delete(kbCategoryTable)
    .where(
      and(
        eq(kbCategoryTable.id, id),
        eq(kbCategoryTable.workspaceId, workspaceId),
      ),
    )
    .returning();
  if (!row) return false;
  await audit(tx, actor, {
    action: "kb_category.deleted",
    workspaceId,
    entityType: "kb_category",
    entityId: id,
    before: { name: row.name, parentId: row.parentId },
  });
  return true;
}

// ---------------------------------------------------------------------------------------
// Feedback and reports (KB-7, KB-17)

export async function articleFeedback(
  id: string,
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const article = await getArticleRow(id, workspaceId, reachableProjectIds);
  if (!article) return undefined;
  const rows = await db
    .select({
      helpful: kbArticleFeedbackTable.helpful,
      comment: kbArticleFeedbackTable.comment,
      updatedAt: kbArticleFeedbackTable.updatedAt,
    })
    .from(kbArticleFeedbackTable)
    .where(eq(kbArticleFeedbackTable.articleId, id))
    .orderBy(desc(kbArticleFeedbackTable.updatedAt));
  return {
    helpful: rows.filter((row) => row.helpful).length,
    notHelpful: rows.filter((row) => !row.helpful).length,
    comments: rows
      .filter((row) => row.comment)
      .slice(0, 50)
      .map((row) => ({
        helpful: row.helpful,
        comment: row.comment as string,
        createdAt: row.updatedAt.toISOString(),
      })),
  };
}

export async function kbReport(
  workspaceId: string,
  reachableProjectIds: string[],
) {
  const scope = staffScope(workspaceId, reachableProjectIds);
  const now = new Date();
  const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const [overdueRows, feedbackRows, deflectionRows, deflectionTotals] =
    await Promise.all([
      db
        .select()
        .from(kbArticleTable)
        .where(
          and(
            scope,
            ne(kbArticleTable.state, "archived"),
            isNotNull(kbArticleTable.reviewDueAt),
            lt(kbArticleTable.reviewDueAt, now),
          ),
        )
        .orderBy(asc(kbArticleTable.reviewDueAt))
        .limit(50),
      db
        .select({
          id: kbArticleTable.id,
          title: kbArticleTable.title,
          viewCount: kbArticleTable.viewCount,
          helpful: sql<number>`count(*) filter (where ${kbArticleFeedbackTable.helpful})::int`,
          notHelpful: sql<number>`count(*) filter (where not ${kbArticleFeedbackTable.helpful})::int`,
        })
        .from(kbArticleFeedbackTable)
        .innerJoin(
          kbArticleTable,
          eq(kbArticleTable.id, kbArticleFeedbackTable.articleId),
        )
        .where(scope)
        .groupBy(kbArticleTable.id)
        .having(
          sql`count(*) filter (where not ${kbArticleFeedbackTable.helpful}) > 0`,
        )
        .orderBy(
          desc(
            sql`count(*) filter (where not ${kbArticleFeedbackTable.helpful})`,
          ),
        )
        .limit(25),
      db
        .select({
          id: kbArticleTable.id,
          title: kbArticleTable.title,
          candidates: sql<number>`count(*)::int`,
          deflected: sql<number>`count(*) filter (where ${deflectionEventTable.abandonedAt} is not null)::int`,
        })
        .from(deflectionEventTable)
        .innerJoin(
          kbArticleTable,
          eq(kbArticleTable.id, deflectionEventTable.kbArticleId),
        )
        .where(and(scope, gt(deflectionEventTable.createdAt, since)))
        .groupBy(kbArticleTable.id)
        .orderBy(
          desc(
            sql`count(*) filter (where ${deflectionEventTable.abandonedAt} is not null)`,
          ),
        )
        .limit(25),
      db
        .select({
          candidates: sql<number>`count(*)::int`,
          deflected: sql<number>`count(*) filter (where ${deflectionEventTable.abandonedAt} is not null)::int`,
        })
        .from(deflectionEventTable)
        .innerJoin(
          kbArticleTable,
          eq(kbArticleTable.id, deflectionEventTable.kbArticleId),
        )
        .where(and(scope, gt(deflectionEventTable.createdAt, since))),
    ]);
  const names = await personNames(
    overdueRows.flatMap((row) => [row.ownerId, row.authorId]),
  );
  return {
    overdue: overdueRows.map((row) => summarise(row, names, now)),
    unhelpful: feedbackRows,
    deflection: {
      windowDays: 90,
      candidates: deflectionTotals[0]?.candidates ?? 0,
      deflected: deflectionTotals[0]?.deflected ?? 0,
      articles: deflectionRows,
    },
  };
}
