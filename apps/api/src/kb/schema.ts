import { z } from "../openapi";

const id = z.string().min(1).max(128);
const body = z.record(z.string(), z.unknown());

export const workspaceIdQuery = z.object({ workspaceId: id });
export const articleIdParam = z.object({ id });
export const versionParam = z.object({
  id,
  number: z.coerce.number().int().min(1),
});
export const categoryIdParam = z.object({ id });

const limit = z.coerce.number().int().min(1).max(100).default(25);
const offset = z.coerce.number().int().min(0).max(100_000).default(0);

export const listArticlesQuery = z.object({
  workspaceId: id,
  q: z.string().trim().max(200).optional(),
  state: z.enum(["draft", "in_review", "published", "archived"]).optional(),
  categoryId: id.optional(),
  ownerId: id.optional(),
  overdue: z.enum(["true", "false"]).optional(),
  sort: z.enum(["updated", "views", "title"]).default("updated"),
  limit,
  offset,
});

export const searchQuery = z.object({
  workspaceId: id,
  q: z.string().trim().min(1).max(200),
  limit,
});

export const deflectionQueryParams = z.object({
  workspaceId: id,
  q: z.string().max(500).default(""),
});

export const createArticleBody = z.object({
  workspaceId: id,
  title: z.string().trim().min(1).max(200),
  body: body.optional(),
  projectId: id.nullable().optional(),
  categoryId: id.nullable().optional(),
  customerVisible: z.boolean().optional(),
  ownerId: id.nullable().optional(),
  reviewDueAt: z.string().datetime().nullable().optional(),
});

export const updateArticleBody = z
  .object({
    version: z.number().int().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    body: body.optional(),
    projectId: id.nullable().optional(),
    categoryId: id.nullable().optional(),
    customerVisible: z.boolean().optional(),
    ownerId: id.nullable().optional(),
    reviewDueAt: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== "version"), {
    message: "Provide at least one field to change",
  });

export const transitionBody = z.object({ version: z.number().int().min(1) });

export const createCategoryBody = z.object({
  workspaceId: id,
  name: z.string().trim().min(1).max(120),
  parentId: id.nullable().optional(),
  position: z.number().int().min(0).max(10_000).optional(),
});
export const updateCategoryBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    parentId: id.nullable().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to change",
  });

export const updateSettingsBody = z.object({
  reviewStepEnabled: z.boolean(),
});

export const portalListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: id.optional(),
  sort: z.enum(["recent", "popular"]).default("recent"),
  limit,
  offset,
});

export const portalDeflectionQuery = z.object({
  q: z.string().max(500).default(""),
});

export const feedbackBody = z.object({
  helpful: z.boolean(),
  comment: z.string().trim().max(2000).optional(),
});

export const recordDeflectionBody = z.object({
  articleId: id,
  requestTypeKey: z.string().max(128).optional(),
  query: z.string().max(500).default(""),
});
export const deflectionIdParam = z.object({ id });
