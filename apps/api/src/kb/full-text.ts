import { type SQLWrapper, sql } from "drizzle-orm";

/**
 * KB-9 / KB-13: keep the indexed expression identical to the weighted PostgreSQL GIN
 * expression on both `kb_article` and `kb_article_version`.
 */
export function prefixTsqueryText(input: string | readonly string[]) {
  const source = typeof input === "string" ? input : input.join(" ");
  const terms =
    source
      .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)
      ?.map((term) => term.toLowerCase()) ?? [];
  const uniqueTerms = [...new Set(terms)];
  return uniqueTerms.length > 0
    ? uniqueTerms.map((term) => `${term}:*`).join(" & ")
    : null;
}

/** Expressions shared by staff working-copy and customer published-version search. */
export function kbFullText(
  terms: readonly string[],
  title: SQLWrapper,
  bodyText: SQLWrapper,
) {
  const queryText = prefixTsqueryText(terms);
  const vector = sql`(
    setweight(to_tsvector('simple', coalesce(${title}, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(${bodyText}, '')), 'B')
  )`;
  const titleVector = sql`setweight(to_tsvector('simple', coalesce(${title}, '')), 'A')`;
  const query =
    queryText === null ? undefined : sql`to_tsquery('simple', ${queryText})`;

  return {
    query,
    vector,
    titleVector,
    matches: query ? sql`${vector} @@ ${query}` : sql`false`,
    titleMatches: query ? sql`${titleVector} @@ ${query}` : sql`false`,
    score: query
      ? sql<number>`(ts_rank_cd(${vector}, ${query}, 32) * 100)`
      : sql<number>`0`,
  };
}
