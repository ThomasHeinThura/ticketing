import { sql } from "drizzle-orm";
import { num, selectRows, tstz } from "../context";
import { countValue, ratePercent } from "../logic";
import type { ReportDefinition, Row } from "../types";
import { cell, col, emptyBody, MIN } from "./shared";

/**
 * KB-10: opening an article from the request form is a candidate; abandoning the form afterwards
 * counts as a deflection. An article scoped to a project is only reported to callers who reach it.
 */
const kbDeflection: ReportDefinition = {
  key: "kb_deflection",
  category: "knowledge",
  title: "Knowledge base deflection",
  feature: "feature.knowledge_base",
  async compute(ctx) {
    const rows = await selectRows<{
      article_id: string;
      title: string;
      opened: string;
      deflected: string;
      helpful: string;
      unhelpful: string;
    }>(sql`SELECT a.id AS article_id, a.title,
        count(d.id) AS opened,
        count(d.id) FILTER (WHERE d.abandoned_at IS NOT NULL) AS deflected,
        (SELECT count(*) FROM kb_article_feedback f WHERE f.article_id = a.id AND f.helpful) AS helpful,
        (SELECT count(*) FROM kb_article_feedback f WHERE f.article_id = a.id AND NOT f.helpful) AS unhelpful
      FROM deflection_event d
      JOIN kb_article a ON a.id = d.kb_article_id
      LEFT JOIN project p ON p.id = a.project_id
      WHERE d.workspace_id = ${ctx.workspaceId}
        AND (a.project_id IS NULL OR (p.deleted_at IS NULL AND ${ctx.reach}))
        AND d.created_at >= ${tstz(ctx.window.from)} AND d.created_at < ${tstz(ctx.window.to)}
      GROUP BY a.id, a.title
      ORDER BY count(d.id) FILTER (WHERE d.abandoned_at IS NOT NULL) DESC, count(d.id) DESC
      LIMIT 200`);
    const [outside] = await selectRows<{ n: string }>(sql`SELECT count(*) AS n
      FROM deflection_event d
      JOIN kb_article a ON a.id = d.kb_article_id
      LEFT JOIN project p ON p.id = a.project_id
      WHERE d.workspace_id = ${ctx.workspaceId}
        AND (a.project_id IS NULL OR (p.deleted_at IS NULL AND ${ctx.reach}))
        AND NOT (d.created_at >= ${tstz(ctx.window.from)} AND d.created_at < ${tstz(ctx.window.to)})`);
    const opened = rows.reduce((sum, row) => sum + num(row.opened), 0);
    const deflected = rows.reduce((sum, row) => sum + num(row.deflected), 0);
    const table: Row[] = rows.map((row) => {
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
      population: opened,
      outsideWindow: num(outside?.n),
    });
  },
};

export const kbReports: ReportDefinition[] = [kbDeflection];
