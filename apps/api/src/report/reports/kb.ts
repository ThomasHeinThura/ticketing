import { sql } from "drizzle-orm";
import { num, selectRows, tstz } from "../context";
import { countValue, ratePercent } from "../logic";
import { loadFactRows } from "../snapshot.repository";
import type { ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, MIN, memoryPage, pageRows } from "./shared";

/**
 * KB-10: opening an article from the request form is a candidate; abandoning the form afterwards
 * counts as a deflection. An article scoped to a project is only reported to callers who reach it.
 */
const kbDeflection: ReportDefinition = {
  key: "kb_deflection",
  category: "knowledge",
  title: "Knowledge base deflection",
  feature: "feature.knowledge_base",
  pagedExport: true,
  async compute(ctx) {
    const facts = await loadFactRows(
      ctx,
      "kb_deflection",
      ctx.window.from,
      ctx.window.to,
    );
    const ids = [
      ...new Set(
        facts
          .map((fact) => fact.dimensions.articleId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const articles = ids.length
      ? await selectRows<{ id: string; title: string }>(
          sql`SELECT id,title FROM kb_article WHERE id IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
      : [];
    const titleById = new Map(articles.map((row) => [row.id, row.title]));
    const totals = new Map<
      string,
      { article_id: string; title: string; opened: number; deflected: number }
    >();
    for (const fact of facts) {
      const id = fact.dimensions.articleId;
      if (!id) continue;
      const row = totals.get(id) ?? {
        article_id: id,
        title: titleById.get(id) ?? "",
        opened: 0,
        deflected: 0,
      };
      row.opened += fact.measures.opened ?? 0;
      row.deflected += fact.measures.deflected ?? 0;
      totals.set(id, row);
    }
    const articleFacts = [...totals.values()];
    const feedbackIds = articleFacts.map((row) => sql`${row.article_id}`);
    const feedback = feedbackIds.length
      ? await selectRows<{
          article_id: string;
          helpful: string;
          unhelpful: string;
        }>(sql`SELECT article_id,
          count(*) FILTER (WHERE helpful) AS helpful,count(*) FILTER (WHERE NOT helpful) AS unhelpful
        FROM kb_article_feedback WHERE article_id IN (${sql.join(feedbackIds, sql`, `)}) GROUP BY article_id`)
      : [];
    ctx.snapshots.sources.liveComponents.add("all_time_feedback");
    ctx.snapshots.use.liveParts = true;
    const feedbackById = new Map(feedback.map((row) => [row.article_id, row]));
    const rows = articleFacts
      .map((row) => ({
        ...row,
        helpful: feedbackById.get(row.article_id)?.helpful ?? "0",
        unhelpful: feedbackById.get(row.article_id)?.unhelpful ?? "0",
      }))
      .sort(
        (a, b) =>
          num(b.deflected) - num(a.deflected) ||
          num(b.opened) - num(a.opened) ||
          a.title.localeCompare(b.title) ||
          a.article_id.localeCompare(b.article_id),
      );
    const page = pageRows(ctx, memoryPage(ctx, rows), 200);
    const [outside] = await selectRows<{ n: string }>(sql`SELECT count(*) AS n
      FROM deflection_event d
      JOIN kb_article a ON a.id = d.kb_article_id
      LEFT JOIN project p ON p.id = a.project_id
      WHERE d.workspace_id = ${ctx.workspaceId}
        AND (a.project_id IS NULL OR (p.deleted_at IS NULL AND ${ctx.reach}))
        AND NOT (d.created_at >= ${tstz(ctx.window.from)} AND d.created_at < ${tstz(ctx.window.to)})`);
    ctx.snapshots.sources.liveComponents.add("outside_window");
    const opened = page.rows.reduce((sum, row) => sum + num(row.opened), 0);
    const deflected = page.rows.reduce(
      (sum, row) => sum + num(row.deflected),
      0,
    );
    const table: Row[] = page.rows.map((row) => {
      const helpful = num(row.helpful);
      const unhelpful = num(row.unhelpful);
      return {
        article: row.title,
        opened: num(row.opened),
        deflected: num(row.deflected),
        deflection: cell(ratePercent(num(row.deflected), num(row.opened), MIN)),
        helpful: cell(ratePercent(helpful, helpful + unhelpful, MIN)),
      };
    });
    return emptyBody({
      metrics: [
        {
          key: "opened",
          label: "Articles opened from a request",
          unit: "count",
          ...countValue(opened),
        },
        {
          key: "deflected",
          label: "Requests not raised",
          unit: "count",
          ...countValue(deflected),
        },
        {
          key: "rate",
          label: "Deflection rate",
          unit: "percent",
          ...ratePercent(deflected, opened, MIN),
        },
      ],
      chart:
        opened > 0
          ? {
              type: "bar",
              unit: "count",
              categories: table.slice(0, 10).map((row) => String(row.article)),
              series: [
                {
                  key: "opened",
                  label: "Opened",
                  values: table.slice(0, 10).map((row) => Number(row.opened)),
                },
                {
                  key: "deflected",
                  label: "Deflected",
                  values: table
                    .slice(0, 10)
                    .map((row) => Number(row.deflected)),
                },
              ],
            }
          : null,
      columns: [
        col("article", "Article"),
        col("opened", "Opened", "number"),
        col("deflected", "Deflected", "number"),
        col("deflection", "Deflection rate", "percent"),
        col("helpful", "Found helpful", "percent"),
      ],
      rows: table,
      truncated: page.truncated,
      population: opened,
      outsideWindow: num(outside?.n),
    });
  },
};

export const kbReports: ReportDefinition[] = [kbDeflection];
