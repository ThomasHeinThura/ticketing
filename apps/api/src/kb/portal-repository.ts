import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  organisationRequestTypeTable,
  requestTypeTable,
} from "../database/schema";
import {
  deflectionEventTable,
  kbArticleFeedbackTable,
  kbArticleTable,
  kbArticleVersionTable,
  kbCategoryTable,
} from "../database/schema-p5-kb";
import { escapeLikePattern } from "../search/like-pattern";
import { searchTerms, snippet } from "./logic";
import { deflectionTerms, relevance } from "./repository";
import { type KbNode, toCustomerBody } from "./sanitise";
import type { PortalKbScope } from "./visibility";

/**
 * Every portal read below filters with `scope.visible` (KB-2) and reads the immutable published
 * version, never the working copy. Anything outside the scope is a constant-shape 404 for the
 * caller, whatever the reason (draft, internal, other organisation, feature off).
 */
const notFound = () => new HTTPException(404, { message: "Article not found" });

const version = kbArticleVersionTable;
const publishedJoin = and(
  eq(version.articleId, kbArticleTable.id),
  eq(version.number, kbArticleTable.publishedVersion),
);

const portalColumns = {
  id: kbArticleTable.id,
  title: version.title,
  bodyText: version.bodyText,
  categoryId: kbArticleTable.categoryId,
  publishedAt: kbArticleTable.publishedAt,
};

type PortalRow = {
  id: string;
  title: string;
  bodyText: string;
  categoryId: string | null;
  publishedAt: Date | null;
};

function toSummary(row: PortalRow) {
  return {
    id: row.id,
    title: row.title,
    snippet: snippet(row.bodyText),
    categoryId: row.categoryId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

async function categoryTree(workspaceIds: string[]) {
  if (workspaceIds.length === 0) return [];
  return db
    .select()
    .from(kbCategoryTable)
    .where(inArray(kbCategoryTable.workspaceId, workspaceIds))
    .orderBy(asc(kbCategoryTable.position), asc(kbCategoryTable.name));
}

function withDescendants(
  rows: { id: string; parentId: string | null }[],
  root: string,
) {
  const ids = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (row.parentId && ids.has(row.parentId) && !ids.has(row.id)) {
        ids.add(row.id);
        grew = true;
      }
  }
  return [...ids];
}

export async function portalList(
  scope: PortalKbScope,
  input: {
    q?: string;
    categoryId?: string;
    sort: "recent" | "popular";
    limit: number;
    offset: number;
  },
) {
  const terms = input.q ? searchTerms(input.q) : [];
  const rel = relevance(terms, version.title, version.bodyText);
  let categoryIds: string[] | null = null;
  if (input.categoryId) {
    const tree = await categoryTree(scope.workspaceIds);
    categoryIds = tree.some((row) => row.id === input.categoryId)
      ? withDescendants(tree, input.categoryId)
      : [];
  }
  const where = and(
    scope.visible,
    categoryIds
      ? categoryIds.length > 0
        ? inArray(kbArticleTable.categoryId, categoryIds)
        : sql`false`
      : undefined,
    ...terms.map((term) => {
      const like = `%${escapeLikePattern(term)}%`;
      return sql`(lower(${version.title}) LIKE ${like} OR lower(${version.bodyText}) LIKE ${like})`;
    }),
  );
  const order =
    terms.length > 0
      ? [desc(rel.score), desc(kbArticleTable.publishedAt)]
      : input.sort === "popular"
        ? [desc(kbArticleTable.viewCount), desc(kbArticleTable.publishedAt)]
        : [desc(kbArticleTable.publishedAt)];
  const [rows, [total]] = await Promise.all([
    db
      .select(portalColumns)
      .from(kbArticleTable)
      .innerJoin(version, publishedJoin)
      .where(where)
      .orderBy(...order, asc(kbArticleTable.id))
      .limit(input.limit)
      .offset(input.offset),
    db
      .select({ total: count() })
      .from(kbArticleTable)
      .innerJoin(version, publishedJoin)
      .where(where),
  ]);
  return { articles: rows.map(toSummary), total: total?.total ?? 0 };
}

/** Categories that hold at least one visible article, plus their ancestors. */
export async function portalCategories(scope: PortalKbScope) {
  const [tree, used] = await Promise.all([
    categoryTree(scope.workspaceIds),
    db
      .select({ categoryId: kbArticleTable.categoryId, total: count() })
      .from(kbArticleTable)
      .where(and(scope.visible, sql`${kbArticleTable.categoryId} is not null`))
      .groupBy(kbArticleTable.categoryId),
  ]);
  const totals = new Map(used.map((row) => [row.categoryId, row.total]));
  const byId = new Map(tree.map((row) => [row.id, row]));
  const keep = new Set<string>();
  for (const id of totals.keys()) {
    let cursor: string | null | undefined = id;
    while (cursor && !keep.has(cursor)) {
      keep.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
  }
  return tree
    .filter((row) => keep.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      position: row.position,
      articleCount: totals.get(row.id) ?? 0,
    }));
}

export async function portalDetail(scope: PortalKbScope, id: string) {
  const [row] = await db
    .select({ ...portalColumns, body: version.body })
    .from(kbArticleTable)
    .innerJoin(version, publishedJoin)
    .where(and(scope.visible, eq(kbArticleTable.id, id)))
    .limit(1);
  if (!row) throw notFound();
  // KB-16: view counts are a plain atomic increment; they do not touch `updated_at`.
  await db
    .update(kbArticleTable)
    .set({ viewCount: sql`${kbArticleTable.viewCount} + 1` })
    .where(eq(kbArticleTable.id, id));
  let categoryName: string | null = null;
  if (row.categoryId) {
    const [category] = await db
      .select({ name: kbCategoryTable.name })
      .from(kbCategoryTable)
      .where(eq(kbCategoryTable.id, row.categoryId))
      .limit(1);
    categoryName = category?.name ?? null;
  }
  const [feedback] = await db
    .select({
      helpful: kbArticleFeedbackTable.helpful,
      comment: kbArticleFeedbackTable.comment,
    })
    .from(kbArticleFeedbackTable)
    .where(
      and(
        eq(kbArticleFeedbackTable.articleId, id),
        eq(kbArticleFeedbackTable.personId, scope.personId),
      ),
    )
    .limit(1);
  return {
    ...toSummary(row),
    categoryName,
    body: toCustomerBody(row.body as KbNode),
    related: await portalRelated(scope, {
      id,
      categoryId: row.categoryId,
      title: row.title,
    }),
    myFeedback: feedback
      ? { helpful: feedback.helpful, comment: feedback.comment }
      : null,
  };
}

/** KB-15 for customers: only articles the customer can see themselves. */
async function portalRelated(
  scope: PortalKbScope,
  article: { id: string; categoryId: string | null; title: string },
) {
  const terms = deflectionTerms(article.title).filter((t) => t.length >= 4);
  const rel = relevance(terms, version.title, version.bodyText);
  const sameCategory = article.categoryId
    ? sql`(CASE WHEN ${kbArticleTable.categoryId} = ${article.categoryId} THEN 1 ELSE 0 END)`
    : sql`0`;
  const rows = await db
    .select(portalColumns)
    .from(kbArticleTable)
    .innerJoin(version, publishedJoin)
    .where(
      and(
        scope.visible,
        ne(kbArticleTable.id, article.id),
        or(
          article.categoryId
            ? eq(kbArticleTable.categoryId, article.categoryId)
            : undefined,
          terms.length > 0 ? sql`(${rel.titleHits}) >= 1` : undefined,
        ),
      ),
    )
    .orderBy(
      desc(sql`(${sameCategory}) * 5 + (${rel.titleHits})`),
      desc(kbArticleTable.viewCount),
      asc(kbArticleTable.id),
    )
    .limit(5);
  return rows.map(toSummary);
}

export async function portalFeedback(
  scope: PortalKbScope,
  id: string,
  input: { helpful: boolean; comment?: string },
) {
  const [visible] = await db
    .select({ id: kbArticleTable.id })
    .from(kbArticleTable)
    .where(and(scope.visible, eq(kbArticleTable.id, id)))
    .limit(1);
  if (!visible) throw notFound();
  await db
    .insert(kbArticleFeedbackTable)
    .values({
      articleId: id,
      personId: scope.personId,
      helpful: input.helpful,
      comment: input.comment || null,
    })
    .onConflictDoUpdate({
      target: [
        kbArticleFeedbackTable.articleId,
        kbArticleFeedbackTable.personId,
      ],
      set: {
        helpful: input.helpful,
        comment: input.comment || null,
        updatedAt: new Date(),
      },
    });
  return { ok: true as const };
}

/** KB-8 / KB-9: suggestions for a request summary; read-only, nothing is recorded here. */
export async function portalDeflection(scope: PortalKbScope, q: string) {
  const terms = deflectionTerms(q);
  if (terms.length === 0) return [];
  const rel = relevance(terms, version.title, version.bodyText);
  const rows = await db
    .select(portalColumns)
    .from(kbArticleTable)
    .innerJoin(version, publishedJoin)
    .where(
      and(
        scope.visible,
        sql`((${rel.titleHits}) >= 1 OR (${rel.bodyHits}) >= 2)`,
      ),
    )
    .orderBy(
      desc(rel.score),
      desc(kbArticleTable.viewCount),
      asc(kbArticleTable.id),
    )
    .limit(5);
  return rows.map(toSummary);
}

const CANDIDATE_REUSE_MS = 30 * 60 * 1000;

/** KB-10: opening an article from the request form records a deflection candidate. */
export async function recordDeflectionCandidate(
  scope: PortalKbScope,
  input: { articleId: string; requestTypeKey?: string; query: string },
) {
  const [article] = await db
    .select({
      id: kbArticleTable.id,
      workspaceId: kbArticleTable.workspaceId,
    })
    .from(kbArticleTable)
    .where(and(scope.visible, eq(kbArticleTable.id, input.articleId)))
    .limit(1);
  if (!article) throw notFound();
  let requestTypeId: string | null = null;
  if (input.requestTypeKey) {
    const [type] = await db
      .select({ id: requestTypeTable.id })
      .from(organisationRequestTypeTable)
      .innerJoin(
        requestTypeTable,
        eq(requestTypeTable.id, organisationRequestTypeTable.requestTypeId),
      )
      .where(
        and(
          eq(organisationRequestTypeTable.organisationId, scope.organisationId),
          eq(requestTypeTable.workspaceId, article.workspaceId),
          eq(requestTypeTable.key, input.requestTypeKey),
          eq(requestTypeTable.published, true),
          eq(requestTypeTable.customerVisible, true),
        ),
      )
      .limit(1);
    requestTypeId = type?.id ?? null;
  }
  const [recent] = await db
    .select({ id: deflectionEventTable.id })
    .from(deflectionEventTable)
    .where(
      and(
        eq(deflectionEventTable.personId, scope.personId),
        eq(deflectionEventTable.kbArticleId, article.id),
        isNull(deflectionEventTable.abandonedAt),
        gt(
          deflectionEventTable.createdAt,
          new Date(Date.now() - CANDIDATE_REUSE_MS),
        ),
      ),
    )
    .orderBy(desc(deflectionEventTable.createdAt))
    .limit(1);
  if (recent) return { id: recent.id };
  const [row] = await db
    .insert(deflectionEventTable)
    .values({
      workspaceId: article.workspaceId,
      personId: scope.personId,
      requestTypeId,
      kbArticleId: article.id,
      query: input.query.slice(0, 500),
    })
    .returning({ id: deflectionEventTable.id });
  if (!row) throw new Error("deflection insert failed");
  return { id: row.id };
}

/** The customer left the form without submitting: the candidate counts as a deflection. */
export async function abandonDeflectionCandidate(
  scope: PortalKbScope,
  id: string,
) {
  const [row] = await db
    .update(deflectionEventTable)
    .set({
      abandonedAt: sql`coalesce(${deflectionEventTable.abandonedAt}, now())`,
    })
    .where(
      and(
        eq(deflectionEventTable.id, id),
        eq(deflectionEventTable.personId, scope.personId),
      ),
    )
    .returning({ id: deflectionEventTable.id });
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return { ok: true as const };
}
