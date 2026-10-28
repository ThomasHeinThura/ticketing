import type { Capability } from "@taskdesk/permissions";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { getConfiguredCustomerOrigin } from "../auth";
import db from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import {
  listReachOf,
  requireReachFilteredList,
} from "../utils/reach-filtered-list";
import { rejectNulByte } from "../utils/reject-nul-byte";
import { requireApiKeyPermissionScope } from "../utils/require-api-key-permission-scope";
import {
  assertCallerHasCapability,
  capabilityCredential,
  requireWorkspaceCapability,
} from "../utils/require-workspace-capability";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { KB_CATEGORY_DELETION_ROUTE } from "./deletion-target";
import { deflectionQuery } from "./logic";
import {
  abandonDeflectionCandidate,
  portalCategories,
  portalDeflection,
  portalDetail,
  portalFeedback,
  portalList,
  recordDeflectionCandidate,
} from "./portal-repository";
import {
  articleFeedback,
  categoryDeletionBlockers,
  createArticle,
  createCategory,
  getArticle,
  getArticleWorkspace,
  getCategory,
  getCategoryWorkspace,
  getVersion,
  type KbActor,
  KbVersionConflict,
  kbReport,
  listArticles,
  listCategories,
  listVersions,
  personIdOfUser,
  relatedArticles,
  restoreVersion,
  reviewStepEnabled,
  searchArticles,
  setReviewStepEnabled,
  staffDeflection,
  transitionArticle,
  updateArticle,
  updateCategory,
} from "./repository";
import {
  articleDetailSchema,
  articleDetailWithRelatedSchema,
  articleListSchema,
  articleSuggestionsSchema,
  categoryListSchema,
  categorySchema,
  conflictSchema,
  deflectionRecordedSchema,
  feedbackSummarySchema,
  okSchema,
  portalCategoriesSchema,
  portalDetailSchema,
  portalListSchema,
  portalSuggestionsSchema,
  reportSchema,
  settingsSchema,
  staffSuggestionsSchema,
  versionDetailSchema,
  versionListSchema,
} from "./response";
import {
  articleIdParam,
  categoryIdParam,
  createArticleBody,
  createCategoryBody,
  deflectionIdParam,
  deflectionQueryParams,
  feedbackBody,
  listArticlesQuery,
  portalDeflectionQuery,
  portalListQuery,
  recordDeflectionBody,
  searchQuery,
  transitionBody,
  updateArticleBody,
  updateCategoryBody,
  updateSettingsBody,
  versionParam,
  workspaceIdQuery,
} from "./schema";
import {
  type PortalKbScope,
  portalKbScope,
  requireKbEnabled,
} from "./visibility";

type KbVariables = BaseVariables & {
  workspaceId: string;
  workspaceIdSource: "request" | "row";
};
type PortalVariables = BaseVariables & {
  portalPredicateSatisfied: boolean;
  policyOrganisationId: string;
  policyOrganisationIdSource: "row";
  portalKb: PortalKbScope;
};

async function actorOf(c: Context): Promise<KbActor> {
  const apiKey = c.get("apiKey") as { id: string } | undefined;
  const userId = c.get("userId") as string;
  return {
    userId,
    personId: await personIdOfUser(userId),
    actorType: apiKey ? "api_key" : "person",
    apiKeyId: apiKey?.id ?? null,
  };
}

async function holds(c: Context, capability: Capability): Promise<boolean> {
  try {
    await assertCallerHasCapability(
      c.get("workspaceId") as string,
      c.get("userId") as string,
      capability,
      capabilityCredential(c.get("apiKey")),
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

/** The feature gate: with `feature.knowledge_base` off every agent route is a 404. */
async function featureGate(c: Context, next: Next) {
  await requireKbEnabled(c.get("workspaceId") as string);
  await next();
}

/** Resolve the article's workspace from the row; a foreign row is a 404. */
async function articleReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing article id" });
  rejectNulByte(id, "Article id");
  const row = await getArticleWorkspace(id);
  if (!row) throw new HTTPException(404, { message: "Article not found" });
  await resolveRowWorkspace(c, row.workspaceId, "Article not found");
  await next();
}

async function categoryReach(c: Context, next: Next) {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "Missing category id" });
  rejectNulByte(id, "Category id");
  const row = await getCategoryWorkspace(id);
  if (!row) throw new HTTPException(404, { message: "Category not found" });
  await resolveRowWorkspace(c, row.workspaceId, "Category not found");
  await next();
}

async function resolveRowWorkspace(
  c: Context,
  workspaceId: string,
  message: string,
) {
  try {
    await validateWorkspaceAccess(
      c.get("userId"),
      workspaceId,
      c.get("apiKey")?.id,
    );
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403)
      throw new HTTPException(404, { message });
    throw error;
  }
  c.set("workspaceId", workspaceId);
  c.set("workspaceIdSource", "row");
}

const scoped = (action: "read" | "write" | "publish") =>
  [
    requireApiKeyPermissionScope({ kb_article: [action] }),
    requireWorkspaceCapability(`kb_article:${action}` as Capability),
  ] as const;
const manageSettings = [
  requireApiKeyPermissionScope({ workspace: ["manage_settings"] }),
  requireWorkspaceCapability("workspace:manage_settings"),
] as const;

const byRequest = (...rest: readonly ((c: Context, next: Next) => unknown)[]) =>
  [workspaceAccess.fromQuery(), featureGate, ...rest] as const;

async function reachableOf(c: Context) {
  return listReachOf(c).reachableProjectIds([c.get("workspaceId") as string]);
}
function projectReaches(c: Context) {
  return (project: {
    id: string;
    workspaceId: string;
    organisationId: string | null;
  }) =>
    listReachOf(c).reaches({
      projectId: project.id,
      workspaceId: project.workspaceId,
      organisationId: project.organisationId,
    });
}

const conflict403 = errorResponse("Missing the required capability");
const notFound = (what: string) => errorResponse(`${what} not found`);

// ---------------------------------------------------------------------------------------
// Agent routes

const listRoute = createRoute({
  method: "get",
  path: "/kb/articles",
  operationId: "listKbArticles",
  tags: ["Knowledge base"],
  summary: "List articles",
  middleware: [
    ...byRequest(...scoped("read")),
    requireReachFilteredList,
  ] as const,
  request: { query: listArticlesQuery },
  responses: {
    200: jsonResponse("Articles the caller may see", articleListSchema),
    403: conflict403,
    404: notFound("Workspace"),
  },
});
const createRouteDef = createRoute({
  method: "post",
  path: "/kb/articles",
  operationId: "createKbArticle",
  tags: ["Knowledge base"],
  summary: "Create a draft article",
  middleware: [
    workspaceAccess.fromBody(),
    featureGate,
    ...scoped("write"),
    requireReachFilteredList,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createArticleBody } },
    },
  },
  responses: {
    200: jsonResponse("The new draft", articleDetailSchema),
    400: errorResponse("The body is not a usable document"),
    403: conflict403,
    404: notFound("Project, category or owner"),
  },
});
const detailRoute = createRoute({
  method: "get",
  path: "/kb/articles/{id}",
  operationId: "getKbArticle",
  tags: ["Knowledge base"],
  summary: "Get an article with related articles",
  middleware: [
    articleReach,
    featureGate,
    ...scoped("read"),
    requireReachFilteredList,
  ] as const,
  request: { params: articleIdParam },
  responses: {
    200: jsonResponse("The article", articleDetailWithRelatedSchema),
    403: conflict403,
    404: notFound("Article"),
  },
});
const updateRouteDef = createRoute({
  method: "patch",
  path: "/kb/articles/{id}",
  operationId: "updateKbArticle",
  tags: ["Knowledge base"],
  summary: "Edit an article",
  description:
    "Optimistic concurrency: `version` must match, otherwise 409 with the current article. Changing customer visibility or project scope needs `kb_article:publish`.",
  middleware: [
    articleReach,
    featureGate,
    ...scoped("write"),
    requireReachFilteredList,
  ] as const,
  request: {
    params: articleIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateArticleBody } },
    },
  },
  responses: {
    200: jsonResponse("Updated article", articleDetailSchema),
    409: jsonResponse(
      "The article changed since it was loaded",
      conflictSchema,
    ),
    400: errorResponse("The body is not a usable document"),
    403: conflict403,
    404: notFound("Article"),
  },
});

function transitionRoute(
  action: "submit" | "publish" | "unpublish" | "archive" | "restore",
  capability: "write" | "publish",
  summary: string,
) {
  return createRoute({
    method: "post",
    path: `/kb/articles/{id}/${action}`,
    operationId: `${action}KbArticle`,
    tags: ["Knowledge base"],
    summary,
    middleware: [
      articleReach,
      featureGate,
      ...scoped(capability),
      requireReachFilteredList,
    ] as const,
    request: {
      params: articleIdParam,
      body: {
        required: true,
        content: { "application/json": { schema: transitionBody } },
      },
    },
    responses: {
      200: jsonResponse("The article", articleDetailSchema),
      409: jsonResponse(
        "The article changed since it was loaded",
        conflictSchema,
      ),
      403: conflict403,
      404: notFound("Article"),
    },
  });
}
const submitRoute = transitionRoute(
  "submit",
  "write",
  "Submit an article for review",
);
const publishRoute = transitionRoute(
  "publish",
  "publish",
  "Publish an article (creates an immutable version)",
);
const unpublishRoute = transitionRoute(
  "unpublish",
  "publish",
  "Unpublish an article back to draft",
);
const archiveRoute = transitionRoute(
  "archive",
  "publish",
  "Archive an article",
);
const restoreArticleRoute = transitionRoute(
  "restore",
  "publish",
  "Restore an archived article to draft",
);

const versionsRoute = createRoute({
  method: "get",
  path: "/kb/articles/{id}/versions",
  operationId: "listKbArticleVersions",
  tags: ["Knowledge base"],
  summary: "Version history",
  middleware: [
    articleReach,
    featureGate,
    ...scoped("read"),
    requireReachFilteredList,
  ] as const,
  request: { params: articleIdParam },
  responses: {
    200: jsonResponse("Versions, newest first", versionListSchema),
    404: notFound("Article"),
  },
});
const versionRoute = createRoute({
  method: "get",
  path: "/kb/articles/{id}/versions/{number}",
  operationId: "getKbArticleVersion",
  tags: ["Knowledge base"],
  summary: "One immutable version",
  middleware: [
    articleReach,
    featureGate,
    ...scoped("read"),
    requireReachFilteredList,
  ] as const,
  request: { params: versionParam },
  responses: {
    200: jsonResponse("The version", versionDetailSchema),
    404: notFound("Version"),
  },
});
const restoreRoute = createRoute({
  method: "post",
  path: "/kb/articles/{id}/versions/{number}/restore",
  operationId: "restoreKbArticleVersion",
  tags: ["Knowledge base"],
  summary: "Restore a version into the working copy",
  middleware: [
    articleReach,
    featureGate,
    ...scoped("write"),
    requireReachFilteredList,
  ] as const,
  request: {
    params: versionParam,
    body: {
      required: true,
      content: { "application/json": { schema: transitionBody } },
    },
  },
  responses: {
    200: jsonResponse("The article", articleDetailSchema),
    409: jsonResponse(
      "The article changed since it was loaded",
      conflictSchema,
    ),
    404: notFound("Version"),
  },
});
const feedbackRoute = createRoute({
  method: "get",
  path: "/kb/articles/{id}/feedback",
  operationId: "getKbArticleFeedback",
  tags: ["Knowledge base"],
  summary: "Helpfulness answers for an article",
  middleware: [
    articleReach,
    featureGate,
    ...scoped("read"),
    requireReachFilteredList,
  ] as const,
  request: { params: articleIdParam },
  responses: {
    200: jsonResponse("Feedback summary", feedbackSummarySchema),
    404: notFound("Article"),
  },
});
const searchRoute = createRoute({
  method: "get",
  path: "/kb/search",
  operationId: "searchKbArticles",
  tags: ["Knowledge base"],
  summary: "Search articles",
  middleware: [
    ...byRequest(...scoped("read")),
    requireReachFilteredList,
  ] as const,
  request: { query: searchQuery },
  responses: {
    200: jsonResponse("Ranked matches, titles first", articleSuggestionsSchema),
    403: conflict403,
  },
});
const deflectionRoute = createRoute({
  method: "get",
  path: "/kb/deflection",
  operationId: "getKbDeflectionSuggestions",
  tags: ["Knowledge base"],
  summary: "Suggestions while triaging (KB-12)",
  middleware: [
    ...byRequest(...scoped("read")),
    requireReachFilteredList,
  ] as const,
  request: { query: deflectionQueryParams },
  responses: {
    200: jsonResponse(
      "Published articles matching the text",
      staffSuggestionsSchema,
    ),
    403: conflict403,
  },
});
const reportRoute = createRoute({
  method: "get",
  path: "/kb/report",
  operationId: "getKbReport",
  tags: ["Knowledge base"],
  summary: "Overdue reviews, unhelpful articles and deflection",
  middleware: [
    ...byRequest(...scoped("read")),
    requireReachFilteredList,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: { 200: jsonResponse("Report", reportSchema), 403: conflict403 },
});
const settingsRoute = createRoute({
  method: "get",
  path: "/kb/settings",
  operationId: "getKbSettings",
  tags: ["Knowledge base"],
  summary: "Knowledge base settings",
  middleware: [...byRequest(...scoped("read"))] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Settings", settingsSchema),
    403: conflict403,
  },
});
const updateSettingsRoute = createRoute({
  method: "patch",
  path: "/kb/settings",
  operationId: "updateKbSettings",
  tags: ["Knowledge base"],
  summary: "Turn the review step on or off",
  middleware: [...byRequest(...manageSettings)] as const,
  request: {
    query: workspaceIdQuery,
    body: {
      required: true,
      content: { "application/json": { schema: updateSettingsBody } },
    },
  },
  responses: {
    200: jsonResponse("Settings", settingsSchema),
    403: errorResponse("Missing workspace:manage_settings permission"),
  },
});
const categoriesRoute = createRoute({
  method: "get",
  path: "/kb/categories",
  operationId: "listKbCategories",
  tags: ["Knowledge base"],
  summary: "Category tree with article counts",
  middleware: [
    ...byRequest(...scoped("read")),
    requireReachFilteredList,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Categories", categoryListSchema),
    403: conflict403,
  },
});
const createCategoryRoute = createRoute({
  method: "post",
  path: "/kb/categories",
  operationId: "createKbCategory",
  tags: ["Knowledge base"],
  summary: "Create a category",
  middleware: [
    workspaceAccess.fromBody(),
    featureGate,
    ...scoped("publish"),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createCategoryBody } },
    },
  },
  responses: {
    200: jsonResponse("Category", categorySchema),
    403: conflict403,
    404: notFound("Parent category"),
    409: errorResponse("Invalid parent"),
  },
});
const updateCategoryRoute = createRoute({
  method: "patch",
  path: "/kb/categories/{id}",
  operationId: "updateKbCategory",
  tags: ["Knowledge base"],
  summary: "Rename or move a category",
  middleware: [categoryReach, featureGate, ...scoped("publish")] as const,
  request: {
    params: categoryIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateCategoryBody } },
    },
  },
  responses: {
    200: jsonResponse("Category", categorySchema),
    403: conflict403,
    404: notFound("Category"),
    409: errorResponse("Invalid parent"),
  },
});
const deleteCategoryRoute = createRoute({
  method: "delete",
  path: "/kb/categories/{id}",
  operationId: "deleteKbCategory",
  tags: ["Knowledge base"],
  summary: "Delete a category",
  description:
    "Request deletion (202 pending action, click approval). Refused while the category still has articles or sub-categories.",
  middleware: [categoryReach, featureGate, ...scoped("publish")] as const,
  request: { params: categoryIdParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: conflict403,
    404: notFound("Category"),
    409: errorResponse("The category still has articles"),
  },
});

function asConflict<T>(run: () => Promise<T>) {
  return run().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => {
      if (error instanceof KbVersionConflict)
        return { ok: false as const, current: error.current };
      throw error;
    },
  );
}

/** The customer portal's public origin, as the server resolves it for sign-in and CORS. */
function portalBaseUrl() {
  return getConfiguredCustomerOrigin();
}

async function settingsOf(c: Context) {
  return {
    reviewStepEnabled: await reviewStepEnabled(c.get("workspaceId") as string),
    canWrite: await holds(c, "kb_article:write"),
    canPublish: await holds(c, "kb_article:publish"),
    canManageSettings: await holds(c, "workspace:manage_settings"),
  };
}

const agentRouter = apiRouter<KbVariables>()
  .openapi(listRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      await listArticles({
        workspaceId: query.workspaceId,
        reachableProjectIds: await reachableOf(c),
        q: query.q || undefined,
        state: query.state,
        categoryId: query.categoryId,
        ownerId: query.ownerId,
        overdue: query.overdue === "true",
        sort: query.sort,
        limit: query.limit,
        offset: query.offset,
      }),
      200,
    );
  })
  .openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    const mayExpose = await holds(c, "kb_article:publish");
    if (body.customerVisible === true && !mayExpose)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const article = await createArticle({
      workspaceId: body.workspaceId,
      title: body.title,
      body: body.body,
      projectId: body.projectId,
      categoryId: body.categoryId,
      customerVisible: body.customerVisible,
      ownerId: body.ownerId,
      reviewDueAt: body.reviewDueAt,
      actor: await actorOf(c),
      projectReaches: projectReaches(c),
    });
    return c.json(article, 200);
  })
  .openapi(detailRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const reachable = await reachableOf(c);
    const article = await getArticle(
      c.req.valid("param").id,
      workspaceId,
      reachable,
    );
    if (!article)
      throw new HTTPException(404, { message: "Article not found" });
    return c.json(
      {
        article,
        related: await relatedArticles(article, workspaceId, reachable),
        canPublish: await holds(c, "kb_article:publish"),
        canWrite: await holds(c, "kb_article:write"),
        reviewStepEnabled: await reviewStepEnabled(workspaceId),
      },
      200,
    );
  })
  .openapi(updateRouteDef, async (c) => {
    const { version, ...changes } = c.req.valid("json");
    const outcome = await asConflict(async () =>
      updateArticle({
        id: c.req.valid("param").id,
        workspaceId: c.get("workspaceId"),
        reachableProjectIds: await reachableOf(c),
        version,
        changes,
        actor: await actorOf(c),
        projectReaches: projectReaches(c),
        mayChangeExposure: await holds(c, "kb_article:publish"),
      }),
    );
    if (!outcome.ok)
      return c.json(
        { error: "version_conflict" as const, current: outcome.current },
        409,
      );
    if (!outcome.value)
      throw new HTTPException(404, { message: "Article not found" });
    return c.json(outcome.value, 200);
  })
  .openapi(submitRoute, (c) => handleTransition(c, "submit"))
  .openapi(publishRoute, (c) => handleTransition(c, "publish"))
  .openapi(unpublishRoute, (c) => handleTransition(c, "unpublish"))
  .openapi(archiveRoute, (c) => handleTransition(c, "archive"))
  .openapi(restoreArticleRoute, (c) => handleTransition(c, "restore"))
  .openapi(versionsRoute, async (c) => {
    const versions = await listVersions(
      c.req.valid("param").id,
      c.get("workspaceId"),
      await reachableOf(c),
    );
    if (!versions)
      throw new HTTPException(404, { message: "Article not found" });
    return c.json({ versions }, 200);
  })
  .openapi(versionRoute, async (c) => {
    const { id, number } = c.req.valid("param");
    const found = await getVersion(
      id,
      c.get("workspaceId"),
      await reachableOf(c),
      number,
    );
    if (!found) throw new HTTPException(404, { message: "Version not found" });
    return c.json(found, 200);
  })
  .openapi(restoreRoute, async (c) => {
    const { id, number } = c.req.valid("param");
    const outcome = await asConflict(async () =>
      restoreVersion({
        id,
        workspaceId: c.get("workspaceId"),
        reachableProjectIds: await reachableOf(c),
        number,
        version: c.req.valid("json").version,
        actor: await actorOf(c),
      }),
    );
    if (!outcome.ok)
      return c.json(
        { error: "version_conflict" as const, current: outcome.current },
        409,
      );
    if (!outcome.value)
      throw new HTTPException(404, { message: "Article not found" });
    return c.json(outcome.value, 200);
  })
  .openapi(feedbackRoute, async (c) => {
    const summary = await articleFeedback(
      c.req.valid("param").id,
      c.get("workspaceId"),
      await reachableOf(c),
    );
    if (!summary)
      throw new HTTPException(404, { message: "Article not found" });
    return c.json(summary, 200);
  })
  .openapi(searchRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      {
        articles: await searchArticles({
          workspaceId: query.workspaceId,
          reachableProjectIds: await reachableOf(c),
          q: query.q,
          limit: query.limit,
        }),
      },
      200,
    );
  })
  .openapi(deflectionRoute, async (c) => {
    const query = c.req.valid("query");
    return c.json(
      {
        articles: await staffDeflection({
          workspaceId: query.workspaceId,
          reachableProjectIds: await reachableOf(c),
          q: query.q,
        }),
        portalBaseUrl: portalBaseUrl(),
      },
      200,
    );
  })
  .openapi(reportRoute, async (c) =>
    c.json(
      await kbReport(c.req.valid("query").workspaceId, await reachableOf(c)),
      200,
    ),
  )
  .openapi(settingsRoute, async (c) => c.json(await settingsOf(c), 200))
  .openapi(updateSettingsRoute, async (c) => {
    await setReviewStepEnabled(
      c.req.valid("query").workspaceId,
      c.req.valid("json").reviewStepEnabled,
      await actorOf(c),
    );
    return c.json(await settingsOf(c), 200);
  })
  .openapi(categoriesRoute, async (c) =>
    c.json(
      {
        categories: await listCategories(
          c.req.valid("query").workspaceId,
          await reachableOf(c),
        ),
      },
      200,
    ),
  )
  .openapi(createCategoryRoute, async (c) => {
    const body = c.req.valid("json");
    return c.json(
      await createCategory({
        workspaceId: body.workspaceId,
        name: body.name,
        parentId: body.parentId,
        position: body.position,
        actor: await actorOf(c),
      }),
      200,
    );
  })
  .openapi(updateCategoryRoute, async (c) => {
    const updated = await updateCategory({
      id: c.req.valid("param").id,
      workspaceId: c.get("workspaceId"),
      changes: c.req.valid("json"),
      actor: await actorOf(c),
    });
    if (!updated)
      throw new HTTPException(404, { message: "Category not found" });
    return c.json(updated, 200);
  })
  .openapi(deleteCategoryRoute, async (c) => {
    const id = c.req.valid("param").id;
    const category = await getCategory(id, c.get("workspaceId"));
    if (!category)
      throw new HTTPException(404, { message: "Category not found" });
    const blockers = await categoryDeletionBlockers(db, id);
    if (blockers.length > 0)
      throw new HTTPException(409, { message: blockers.join(" ") });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: KB_CATEGORY_DELETION_ROUTE,
      targetType: "kb_category",
      id,
      workspaceId: c.get("workspaceId"),
    });
    return c.json(pending, 202);
  });

async function handleTransition(
  c: Context,
  action: "submit" | "publish" | "unpublish" | "archive" | "restore",
) {
  const outcome = await asConflict(async () =>
    transitionArticle({
      id: c.req.param("id") as string,
      workspaceId: c.get("workspaceId") as string,
      reachableProjectIds: await reachableOf(c),
      version: ((await c.req.json()) as { version: number }).version,
      action,
      actor: await actorOf(c),
    }),
  );
  if (!outcome.ok)
    return c.json(
      { error: "version_conflict" as const, current: outcome.current },
      409,
    );
  if (!outcome.value)
    throw new HTTPException(404, { message: "Article not found" });
  return c.json(outcome.value, 200);
}

// ---------------------------------------------------------------------------------------
// Portal routes: one scope (KB-2), one 404.

async function portalScopeMiddleware(c: Context, next: Next) {
  const scope = await portalKbScope(c.get("userId") as string);
  c.set("portalKb", scope);
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", scope.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}
const portalScopeOf = (c: Context) => c.get("portalKb") as PortalKbScope;

const portalListRoute = createRoute({
  method: "get",
  path: "/portal/kb",
  operationId: "listPortalKbArticles",
  tags: ["Portal knowledge base"],
  summary: "Browse and search published articles",
  middleware: [portalScopeMiddleware] as const,
  request: { query: portalListQuery },
  responses: { 200: jsonResponse("Visible articles", portalListSchema) },
});
const portalCategoriesRoute = createRoute({
  method: "get",
  path: "/portal/kb/categories",
  operationId: "listPortalKbCategories",
  tags: ["Portal knowledge base"],
  summary: "Categories that hold visible articles",
  middleware: [portalScopeMiddleware] as const,
  responses: {
    200: jsonResponse("Categories", portalCategoriesSchema),
  },
});
const portalDeflectionRoute = createRoute({
  method: "get",
  path: "/portal/kb/deflection",
  operationId: "getPortalKbDeflectionSuggestions",
  tags: ["Portal knowledge base"],
  summary: "Suggestions while a request summary is typed",
  middleware: [portalScopeMiddleware] as const,
  request: { query: portalDeflectionQuery },
  responses: {
    200: jsonResponse("Matching visible articles", portalSuggestionsSchema),
  },
});
const recordDeflectionRoute = createRoute({
  method: "post",
  path: "/portal/kb/deflection",
  operationId: "recordPortalKbDeflectionCandidate",
  tags: ["Portal knowledge base"],
  summary: "Record that an article was opened from the request form",
  middleware: [portalScopeMiddleware] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: recordDeflectionBody } },
    },
  },
  responses: {
    200: jsonResponse("Candidate recorded", deflectionRecordedSchema),
    404: notFound("Article"),
  },
});
const abandonDeflectionRoute = createRoute({
  method: "post",
  path: "/portal/kb/deflection/{id}/abandon",
  operationId: "abandonPortalKbDeflectionCandidate",
  tags: ["Portal knowledge base"],
  summary: "The customer left the request form: count the deflection",
  middleware: [portalScopeMiddleware] as const,
  request: { params: deflectionIdParam },
  responses: {
    200: jsonResponse("Recorded", okSchema),
    404: notFound("Candidate"),
  },
});
const portalDetailRoute = createRoute({
  method: "get",
  path: "/portal/kb/{id}",
  operationId: "getPortalKbArticle",
  tags: ["Portal knowledge base"],
  summary: "Read a published article",
  middleware: [portalScopeMiddleware] as const,
  request: { params: articleIdParam },
  responses: {
    200: jsonResponse("The published version", portalDetailSchema),
    404: notFound("Article"),
  },
});
const portalFeedbackRoute = createRoute({
  method: "post",
  path: "/portal/kb/{id}/feedback",
  operationId: "submitPortalKbFeedback",
  tags: ["Portal knowledge base"],
  summary: "Was this helpful?",
  middleware: [portalScopeMiddleware] as const,
  request: {
    params: articleIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: feedbackBody } },
    },
  },
  responses: {
    200: jsonResponse("Recorded", okSchema),
    404: notFound("Article"),
  },
});

const portalRouter = apiRouter<PortalVariables>()
  .openapi(portalListRoute, async (c) =>
    c.json(await portalList(portalScopeOf(c), c.req.valid("query")), 200),
  )
  .openapi(portalCategoriesRoute, async (c) =>
    c.json({ categories: await portalCategories(portalScopeOf(c)) }, 200),
  )
  .openapi(portalDeflectionRoute, async (c) => {
    const q = deflectionQuery(c.req.valid("query").q);
    return c.json(
      { articles: q ? await portalDeflection(portalScopeOf(c), q) : [] },
      200,
    );
  })
  .openapi(recordDeflectionRoute, async (c) =>
    c.json(
      await recordDeflectionCandidate(portalScopeOf(c), c.req.valid("json")),
      200,
    ),
  )
  .openapi(abandonDeflectionRoute, async (c) =>
    c.json(
      await abandonDeflectionCandidate(
        portalScopeOf(c),
        c.req.valid("param").id,
      ),
      200,
    ),
  )
  .openapi(portalDetailRoute, async (c) =>
    c.json(await portalDetail(portalScopeOf(c), c.req.valid("param").id), 200),
  )
  .openapi(portalFeedbackRoute, async (c) =>
    c.json(
      await portalFeedback(
        portalScopeOf(c),
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
      200,
    ),
  );

const router = apiRouter().route("/", agentRouter).route("/", portalRouter);

export default router;
