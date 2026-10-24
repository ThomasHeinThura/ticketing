import { z } from "../openapi";

const articleState = z.enum(["draft", "in_review", "published", "archived"]);

export const articleSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string().nullable(),
  categoryId: z.string().nullable(),
  title: z.string(),
  snippet: z.string(),
  state: articleState,
  customerVisible: z.boolean(),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  authorId: z.string().nullable(),
  authorName: z.string().nullable(),
  reviewDueAt: z.string().nullable(),
  overdue: z.boolean(),
  viewCount: z.number(),
  publishedAt: z.string().nullable(),
  publishedVersion: z.number().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const articleDetailSchema = articleSummarySchema.extend({
  body: z.unknown(),
  hasUnpublishedChanges: z.boolean(),
  versionCount: z.number(),
  categoryName: z.string().nullable(),
});

export const articleDetailWithRelatedSchema = z.object({
  article: articleDetailSchema,
  related: z.array(articleSummarySchema),
  canPublish: z.boolean(),
  canWrite: z.boolean(),
  reviewStepEnabled: z.boolean(),
});

export const articleListSchema = z.object({
  articles: z.array(articleSummarySchema),
  total: z.number(),
});
export const articleSuggestionsSchema = z.object({
  articles: z.array(articleSummarySchema),
});

/** KB-12: triage suggestions; `portalBaseUrl` lets the triager link a customer-visible article. */
export const staffSuggestionsSchema = z.object({
  articles: z.array(articleSummarySchema),
  portalBaseUrl: z.string().nullable(),
});

export const versionListSchema = z.object({
  versions: z.array(
    z.object({
      number: z.number(),
      title: z.string(),
      createdAt: z.string(),
      createdByName: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
});
export const versionDetailSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.unknown(),
  createdAt: z.string(),
  current: z.boolean(),
});

export const categorySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  position: z.number(),
  articleCount: z.number(),
});
export const categoryListSchema = z.object({
  categories: z.array(categorySchema),
});

export const feedbackSummarySchema = z.object({
  helpful: z.number(),
  notHelpful: z.number(),
  comments: z.array(
    z.object({
      helpful: z.boolean(),
      comment: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export const reportSchema = z.object({
  overdue: z.array(articleSummarySchema),
  unhelpful: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      viewCount: z.number(),
      helpful: z.number(),
      notHelpful: z.number(),
    }),
  ),
  deflection: z.object({
    windowDays: z.number(),
    candidates: z.number(),
    deflected: z.number(),
    articles: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        candidates: z.number(),
        deflected: z.number(),
      }),
    ),
  }),
});

export const settingsSchema = z.object({
  reviewStepEnabled: z.boolean(),
  canWrite: z.boolean(),
  canPublish: z.boolean(),
  canManageSettings: z.boolean(),
});

export const conflictSchema = z.object({
  error: z.literal("version_conflict"),
  current: articleDetailSchema,
});

export const okSchema = z.object({ ok: z.literal(true) });

// ---- portal

export const portalSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  snippet: z.string(),
  categoryId: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export const portalListSchema = z.object({
  articles: z.array(portalSummarySchema),
  total: z.number(),
});
export const portalSuggestionsSchema = z.object({
  articles: z.array(portalSummarySchema),
});
export const portalCategoriesSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parentId: z.string().nullable(),
      position: z.number(),
      articleCount: z.number(),
    }),
  ),
});
export const portalDetailSchema = portalSummarySchema.extend({
  categoryName: z.string().nullable(),
  body: z.unknown(),
  related: z.array(portalSummarySchema),
  myFeedback: z
    .object({ helpful: z.boolean(), comment: z.string().nullable() })
    .nullable(),
});
export const deflectionRecordedSchema = z.object({ id: z.string() });
