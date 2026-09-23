import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Session, User } from "better-auth/types";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { compress } from "hono/compress";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import activity from "./activity";
import { auth } from "./auth";
import capabilities from "./capabilities";
import column from "./column";
import comment from "./comment";
import config from "./config";
import db, {
  closeMigrationPool,
  getDatabase,
  getMigrationDatabase,
  schema,
} from "./database";
import { assertApplicationRoleIsNotPrivileged } from "./database/assert-application-role-is-not-privileged";
import { ensureApplicationRole } from "./database/ensure-application-role";
import { prepareDatabaseStartup } from "./database/prepare-database-startup";
import { resolveMigrationDatabaseConfig } from "./database/resolve-database-url";
import { waitForDatabase } from "./database/wait-for-database";
import { eventContext } from "./events";
import externalLink from "./external-link";
import getInstanceStatus from "./instance/controllers/get-instance-status";
import { ensureSetupToken } from "./instance/setup-token";
import invitation from "./invitation";
import label from "./label";
import { migrateColumns } from "./migrations/column-migration";
import notification from "./notification";
import notificationPreferences from "./notification-preferences";
import oauth from "./oauth";
import { createRoute, errorResponse, jsonResponse, z } from "./openapi";
import { initializePlugins } from "./plugins";
// Importing this constructs and validates the registry at module load, so an invalid policy
// refuses boot (#8 Slice 0). Keep the import even if its one use below moves: without a use,
// the bundler drops it and the check silently stops running.
import { policyRegistry } from "./policy-registry";
import project from "./project";
import { initializeScheduler, shutdownScheduler } from "./scheduler";
import search from "./search";
import { getPrivateObject, getStorageDriver } from "./storage";
import { StoragePathError, writeUploadedObject } from "./storage/filesystem";
import task from "./task";
import taskRelation from "./task-relation";
import timeEntry from "./time-entry";
import user from "./user";
import getAvatar from "./user/controllers/get-avatar";
import { buildAuthRequest } from "./utils/auth-request";
import { authenticateApiRequest } from "./utils/authenticate-api-request";
import { authorizeAssetAccess } from "./utils/authorize-asset-access";
import { getInvitationDetails } from "./utils/check-registration-allowed";
import { migrateApiKeyReferenceId } from "./utils/migrate-apikey-reference-id";
import { migrateNotificationPreferencesSchema } from "./utils/migrate-notification-preferences-schema";
import { migrateSessionColumn } from "./utils/migrate-session-column";
import { migrateWorkspaceUserEmail } from "./utils/migrate-workspace-user-email";
import { normalizeApiServerUrl } from "./utils/openapi-spec";
import { rejectNulByte } from "./utils/reject-nul-byte";
import { seedDefaultWorkspaceRoles } from "./utils/seed-default-workspace-roles";
import { seedInternalOrganisationAndStaffPersons } from "./utils/seed-internal-organisation";
import { validateWorkspaceAccess } from "./utils/validate-workspace-access";
import workItem from "./work-item";
import workflowRule from "./workflow-rule";
import workspace from "./workspace";
import {
  addConnection,
  addUserConnection,
  initializeWebSocketAdapter,
  removeConnection,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "./ws";

type ApiKey = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
};

type AppVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    apiKey?: ApiKey;
  };
};

type ApiVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    userEmail: string;
    apiKey?: ApiKey;
  };
};

const SAFE_INLINE_ASSET_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function buildContentDisposition(filename: string, inline: boolean) {
  const normalized = filename
    .normalize("NFC")
    .replace(/[\r\n"]/g, "")
    .trim();
  const safeFilename = normalized || "file";
  const asciiFallback =
    safeFilename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/]/g, "-")
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file";
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

/**
 * Where the built web app can be found, relative to this module's own file
 * rather than `process.cwd()` — the process is started from a different
 * working directory in every environment that matters:
 *
 *  - Production (the shipped Dockerfile): `node apps/api/dist/index.js` runs
 *    from `WORKDIR /app`, and the web bundle is copied to `/app/public`
 *    (see docs/05-operations/container-image.md and the Dockerfile's
 *    `runtime` stage) — three directories up from the bundled file, then
 *    into `public`.
 *  - Local dev/build (`tsx watch` on `src/index.ts`, or a plain `node
 *    apps/api/dist/index.js` run outside the image): the web app is still at
 *    its ordinary monorepo location, `apps/web/dist` — two directories up
 *    from either `apps/api/src` or `apps/api/dist`, then into `web/dist`.
 *
 * Both candidates are checked in order; the first that looks like a real
 * build (a directory containing `index.html`) wins.
 */
function defaultStaticRootCandidates(): string[] {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return [
    join(currentDir, "../../../public"),
    join(currentDir, "../../web/dist"),
  ];
}

/**
 * Resolves the directory the built web app should be served from, or
 * `undefined` when none of the candidates look like a real build (missing
 * entirely, or present without an `index.html`). Exported so a test can pass
 * its own fixture directory instead of depending on `apps/web/dist` actually
 * having been built.
 */
export function resolveStaticRoot(
  candidates: string[] = defaultStaticRootCandidates(),
): string | undefined {
  return candidates.find((candidate) => {
    try {
      return (
        statSync(candidate).isDirectory() &&
        statSync(join(candidate, "index.html")).isFile()
      );
    } catch {
      return false;
    }
  });
}

function isApiRequestPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

/**
 * Serves the built web app, if one is found, so the API process alone can
 * answer a real UAT deployment: real files served from disk with their real
 * content-type, and any unmatched non-API GET falls back to `index.html` so
 * client-side routing survives a hard refresh or a direct URL.
 *
 * Deliberately a no-op when no build is found (dev environments that only
 * run the API) rather than throwing — see `resolveStaticRoot`'s log line,
 * which fires exactly once, at startup, in that case.
 *
 * A request path under `/api` is never touched here, matched or not — that
 * surface keeps its own routing and its own 404s, unconditionally.
 *
 * This `app.use("*", ...)` registration is itself conditional on `staticRoot` being found —
 * it never runs, and never appears in `app.routes`, when no build is on disk. That matters to
 * `packages/permissions`: `DECLARED_ROUTER_MIDDLEWARE` in `route-coverage.ts` declares an
 * exact, unconditional count of 2 registrations at the same `"ALL /*"` key (CORS and
 * compress, above), so `pnpm test:permissions` must always run against a router built without
 * `apps/web/dist` present, or this registration voids that declaration for CORS/compress too
 * (issue #165 — see `tests/permissions/README.md` and `docs/04-engineering/ci-cd.md`).
 */
function registerStaticServing(
  app: Hono<AppVariables>,
  staticRootOverride?: string,
) {
  // An override still goes through the same "is this actually a build"
  // check as the real candidates, rather than being trusted blindly — a
  // test (or a future caller) that passes a directory with no `index.html`
  // gets the same graceful skip as the no-override, nothing-found case.
  const staticRoot = staticRootOverride
    ? resolveStaticRoot([staticRootOverride])
    : resolveStaticRoot();

  if (!staticRoot) {
    console.warn(
      "[static] No built web app found (checked the production /app/public location and apps/web/dist) — the API will not serve the web UI. Expected whenever only the API is running, e.g. before `pnpm --filter @taskdesk/web build` in local development.",
    );
    return;
  }

  console.log(`[static] Serving the built web app from ${staticRoot}`);

  const serveAsset = serveStatic({ root: staticRoot });
  const serveIndex = serveStatic({ root: staticRoot, path: "/index.html" });

  app.use("*", async (c, next) => {
    if (
      (c.req.method !== "GET" && c.req.method !== "HEAD") ||
      isApiRequestPath(c.req.path)
    ) {
      return next();
    }

    // `serveStatic`'s own "not found" signal is calling its `next` argument
    // (typed to return `void`, not a `Response`), so the decision below
    // can't be made from inside that callback's return value — it just
    // flags that no file matched, and the real branching happens after.
    let assetMissing = false;
    const result = await serveAsset(c, async () => {
      assetMissing = true;
    });

    if (!assetMissing) {
      return result;
    }

    // No matching file. A request whose last path segment has an extension
    // (".js", ".png", a stray ".env", ...) is a genuinely missing asset and
    // must stay a 404 — silently returning the SPA shell for it would turn
    // a broken or typo'd asset URL into a "successful" HTML response
    // instead of a loud failure. Anything else is a client-side route and
    // gets the SPA shell.
    const lastSegment = c.req.path.split("/").pop() ?? "";
    if (lastSegment.includes(".")) {
      return next();
    }
    return serveIndex(c, next);
  });
}

export function createApp(options: { staticRoot?: string } = {}) {
  const app = new Hono<AppVariables>();

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      // expected errors (401/404/...) are not reported; real failures are
      if (err.status >= 500) {
      }
      return err.getResponse();
    }
    return c.json({ message: "Internal Server Error" }, 500);
  });
  const nodeWs = createNodeWebSocket({ app });
  const { upgradeWebSocket, injectWebSocket } = nodeWs;
  const corsOriginSource = [
    process.env.CORS_ORIGINS,
    process.env.TASKDESK_AGENT_URL,
  ].find((value) => value?.trim());
  const corsOrigins = corsOriginSource
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Fail CLOSED. kaneo used `NODE_ENV !== "production"`, and "not production"
  // includes "unset" — the normal case for a self-hosted deployment, which is
  // exactly what TaskDesk ships. That reflected ANY origin back with
  // `credentials: true`, letting any website read a logged-in victim's
  // authenticated responses. Reflection is now an explicit development opt-in.
  // Issue #6.
  const reflectUnconfiguredOrigins = process.env.NODE_ENV === "development";

  if (!corsOrigins && !reflectUnconfiguredOrigins) {
    console.warn(
      "[cors] Neither CORS_ORIGINS nor TASKDESK_AGENT_URL is set, so cross-origin requests are refused. Same-origin deployments (the bundled image) are unaffected; set TASKDESK_AGENT_URL if the web app is served from another origin.",
    );
  }

  app.use(
    "*",
    cors({
      credentials: true,
      origin: (origin) => {
        // Reflecting an arbitrary origin alongside credentials lets any site
        // read authenticated responses, so it stays a development convenience.
        if (!corsOrigins) {
          return reflectUnconfiguredOrigins ? origin || "*" : null;
        }

        if (!origin) {
          return null;
        }

        return corsOrigins.includes(origin) ? origin : null;
      },
    }),
  );

  // Large boards return multi-MB JSON (board/task list responses embed
  // labels and external links per task); gzip cuts that by 85-95% since
  // JSON with repeated keys compresses extremely well.
  app.use(compress());

  const api = new OpenAPIHono<ApiVariables>();

  api.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  // Liveness: the process is up, touches no dependency. A Postgres blip must never
  // restart a healthy container — see docs/05-operations/deployment.md § Health and
  // readiness, and charts/taskdesk/values.yaml's comment on the same separation.
  api.get("/public/health/live", (c) => {
    return c.json({ status: "ok" });
  });

  // Readiness: database reachable. Migrations are a separate, earlier concern —
  // runStartupTasks() runs them and blocks serve() from ever accepting a connection
  // until they succeed, so by the time this handler can run at all, migrations have
  // already applied; a second check here would only re-assert what booting already
  // guaranteed.
  api.get("/public/health/ready", async (c) => {
    try {
      await getDatabase().execute(sql`SELECT 1`);
      return c.json({ status: "ok" });
    } catch (error) {
      console.error("Readiness check failed: database unreachable", error);
      return c.json({ status: "error" }, 503);
    }
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getInstanceStatus",
      path: "/instance/status",
      tags: ["Instance"],
      summary: "Get instance status",
      description:
        "Public liveness probe for the auth surface. Deliberately a constant shape (#18): it never reveals whether the instance has been claimed, so an unauthenticated caller cannot scan for an unclaimed instance to race for admin. First-run setup is reached through the one-time setup URL and token printed to the container log, not discovered from here.",
      security: [],
      responses: {
        200: jsonResponse(
          "Instance status",
          z.object({ status: z.literal("ok") }).openapi("InstanceStatus"),
        ),
      },
    }),
    async (c) => c.json(await getInstanceStatus(), 200),
  );

  const invitationPublicApi = api.get("/invitation/public/:id", async (c) => {
    const { id } = c.req.param();
    // #281 sweep: this id reaches a raw `eq(invitationTable.id, ...)` query inside
    // `getInvitationDetails`, unvalidated -- a NUL byte would otherwise 500 instead
    // of a clean 400.
    rejectNulByte(id, "Invitation id");
    const result = await getInvitationDetails(id);
    return c.json(result);
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getSession",
      path: "/auth/get-session",
      tags: ["Authentication"],
      summary: "Get session",
      description:
        "Get the current authenticated session, or null when the caller is not signed in. Served by Better Auth.",
      security: [],
      responses: {
        200: {
          description: "Current session details, or null when unauthenticated",
        },
      },
    }),
    async (c) => auth.handler(buildAuthRequest(c)),
  );

  api.openapi(
    createRoute({
      method: "put",
      operationId: "uploadFilesystemStorageObject",
      path: "/storage/filesystem-upload",
      tags: ["Assets"],
      summary: "Upload bytes to the filesystem storage driver",
      description:
        "The local equivalent of a presigned S3 PUT: accepts raw bytes for a short-lived, " +
        "key-scoped upload token minted by createTaskImageUploadUrl when " +
        "TASKDESK_STORAGE_DRIVER is filesystem (the default). Not authenticated by a browser " +
        "session — the signed token in the query string is the credential, the same way " +
        "possession of a presigned S3 URL is. 404s when the s3 driver is active, since that " +
        "driver never issues a URL pointing here.",
      security: [],
      request: {
        query: z.object({
          key: z.string().min(1),
          expires: z
            .string()
            .regex(/^\d+$/, "expires must be a unix timestamp"),
          token: z.string().min(1),
        }),
        body: {
          required: true,
          content: {
            "application/octet-stream": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
      },
      responses: {
        204: { description: "Stored" },
        400: errorResponse(
          "Invalid key, expired or invalid token, or the upload exceeds the configured limit",
        ),
        404: errorResponse("The filesystem storage driver is not active"),
      },
    }),
    async (c) => {
      if (getStorageDriver() !== "filesystem") {
        throw new HTTPException(404, {
          message: "The filesystem storage driver is not active.",
        });
      }

      const { key, expires, token } = c.req.valid("query");

      try {
        await writeUploadedObject({
          key,
          expires,
          token,
          body: c.req.raw.body,
        });
      } catch (error) {
        // StoragePathError's message is deliberately safe to return as-is (traversal
        // refused, token invalid/expired, upload too large, ...) — it never contains a
        // filesystem path. Anything else here is an unexpected raw fs error (e.g. EEXIST,
        // ENOTDIR, ENOSPC) that embeds the server's own absolute storage-root path, which a
        // caller holding nothing but a valid upload token has no business seeing.
        //
        // The generic case is logged here, server-side only, before the safe message
        // reaches the client — found by the independent Opus delta review (finding A): the
        // prior version of this fix discarded the raw error entirely once it stopped
        // forwarding it to the client, so an ENOSPC/EACCES/EDQUOT on the storage volume
        // would have surfaced to nobody. Detailed to the log, generic to the client.
        if (!(error instanceof StoragePathError)) {
          console.error(
            "storage/filesystem-upload: unexpected write failure",
            error,
          );
        }
        throw new HTTPException(400, {
          message:
            error instanceof StoragePathError
              ? error.message
              : "Upload failed.",
        });
      }

      return c.body(null, 204);
    },
  );

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getUserAvatar",
      path: "/user/avatar/{id}",
      tags: ["User"],
      summary: "Download avatar",
      description:
        "Download a user avatar by its avatar ID. Public, immutable, and cache-friendly: the id changes whenever the avatar is replaced.",
      security: [],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: "The avatar image",
          content: {
            "image/*": { schema: { type: "string", format: "binary" } },
          },
        },
        304: { description: "Not modified" },
        404: { description: "Avatar not found" },
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const avatar = await getAvatar(id);

      if (!avatar) {
        throw new HTTPException(404, { message: "Avatar not found" });
      }

      const etag = `"${avatar.id}"`;
      if (c.req.header("If-None-Match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }

      return new Response(new Uint8Array(avatar.data) as BodyInit, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": avatar.size.toString(),
          "Content-Type": avatar.mimeType,
          "X-Content-Type-Options": "nosniff",
          ETag: etag,
          "Last-Modified": avatar.updatedAt.toUTCString(),
        },
      });
    },
  );

  const configApi = api.route("/config", config);

  api.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description: "API key or session token (Bearer)",
  });

  api.get("/openapi", (c) => {
    const document = api.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "TaskDesk API",
        version: "1.0.0",
        description:
          "TaskDesk Project Management API - Manage projects, tasks, labels, and more",
      },
      servers: [
        {
          url: normalizeApiServerUrl(
            process.env.KANEO_API_URL || "https://cloud.taskdesk.app",
          ),
          description: "TaskDesk API Server",
        },
      ],
      security: [{ bearerAuth: [] }],
    });

    // Every authenticated route sits behind the same app-wide
    // authenticateApiRequest middleware, so the shared 401 is injected here
    // rather than repeated on all ~120 route definitions. Routes that opt out
    // of auth declare `security: []` and are skipped.
    const httpMethods = [
      "get",
      "post",
      "put",
      "delete",
      "patch",
      "options",
      "head",
      "trace",
    ];
    const paths = (document.paths ?? {}) as Record<
      string,
      Record<
        string,
        { responses?: Record<string, unknown>; security?: unknown[] }
      >
    >;
    for (const operations of Object.values(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!httpMethods.includes(method) || !operation.responses) continue;
        if (
          Array.isArray(operation.security) &&
          operation.security.length === 0
        ) {
          continue;
        }
        operation.responses["401"] ??= {
          description: "Missing or invalid credentials",
        };
      }
    }

    return c.json(document);
  });

  // Better Auth serves GET /auth/device as JSON. Browsers that open the API URL
  // directly expect a page, so redirect full document navigations to the web app.
  const authDeviceQuerySchema = z.object({
    user_code: z.string().optional().openapi({
      description: "The device authorization user code.",
    }),
    ui: z.enum(["1"]).optional().openapi({
      description:
        "Force a redirect to the web UI, for clients that do not send Sec-Fetch-* headers.",
    }),
  });

  api.openapi(
    createRoute({
      method: "get",
      operationId: "getDeviceAuthorizationPage",
      path: "/auth/device",
      tags: ["Authentication"],
      summary: "Device authorization page",
      description:
        "Better Auth serves this as JSON. A top-level browser navigation is redirected to the web app's device screen instead, so opening the URL by hand shows a page rather than a JSON blob.",
      security: [],
      request: { query: authDeviceQuerySchema },
      responses: {
        302: {
          description: "Redirects the browser to the web app device screen",
        },
        200: { description: "Device authorization payload from Better Auth" },
      },
    }),
    async (c) => {
      const { user_code: userCode, ui } = c.req.valid("query");
      const secFetchDest = c.req.header("Sec-Fetch-Dest");
      const forceUiRedirect = ui === "1";
      // Top-level browser tab / address bar (not `fetch()` / XHR from the SPA).
      // Optional `ui=1` forces redirect when Sec-Fetch-* headers are missing (e.g. some clients).
      if (forceUiRedirect || secFetchDest === "document") {
        const clientUrl = (
          process.env.TASKDESK_AGENT_URL || "http://localhost:5173"
        ).replace(/\/$/, "");
        const deviceUrl = new URL(`${clientUrl}/device`);
        if (userCode) {
          deviceUrl.searchParams.set("user_code", userCode);
        }
        return c.redirect(deviceUrl.toString(), 302);
      }
      return auth.handler(buildAuthRequest(c));
    },
  );

  api.on(["POST", "GET", "PUT", "PATCH", "DELETE"], "/auth/*", async (c) => {
    const authHeader = c.req.header("Authorization");
    const apiKeyHeader = c.req.header("x-api-key");
    const bearerToken = authHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];

    if (bearerToken && !apiKeyHeader) {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      // Preserve Better Auth bearer session tokens on auth routes.
      if (session?.session && session.user) {
        return auth.handler(buildAuthRequest(c));
      }

      const headers = new Headers(c.req.raw.headers);

      // Better Auth API key plugin validates from x-api-key by default.
      headers.set("x-api-key", bearerToken);

      return auth.handler(buildAuthRequest(c, headers));
    }

    return auth.handler(buildAuthRequest(c));
  });

  api.use("*", async (c, next) => {
    // No prefix exemptions. kaneo exempted /api/mcp, /api/.well-known/ and
    // /api/billing/webhook; all three surfaces are removed in issue #6, so
    // every route mounted below this guard is authenticated without exception.
    // Adding one back is a route-policy decision that belongs to #7, not a
    // string appended here.
    // kaneo wrapped this in Sentry.withIsolationScope(...). With Sentry gone the
    // wrapper has no purpose, so the body runs directly — it must NOT become an
    // uninvoked arrow function, or authenticateApiRequest never runs and every
    // request through this guard succeeds unauthenticated.
    try {
      await authenticateApiRequest(c);
      const windowId = c.req.header("X-TaskDesk-Window-Id");
      const userId = c.get("userId");
      const initiatorId = windowId ? `${userId}:${windowId}` : userId;
      return await eventContext.run({ initiatorId }, next);
    } catch (error) {
      if (!(error instanceof HTTPException)) {
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }
      throw error;
    }
  });

  // Registered below the app-wide auth guard (issue #8, H2 fix, `docs/07-planning/
  // security-reviews/21-policy-registry.md`): `authorizeAssetAccess` requires a real
  // bearer/API-key/session credential (`resolveAssetBearerOrCookie` throws 401 on none)
  // and then checks workspace membership, so this route was never actually public --
  // it just sat above the guard, where H2's `isWithinAuthGuardScope()` correctly refuses
  // a `capability` policy rather than let registration position launder an unauthenticated
  // route into a green coverage check. Moved here so the policy in
  // `apps/api/src/asset/policy.ts` describes what the runtime actually enforces.
  api.openapi(
    createRoute({
      method: "get",
      operationId: "getAsset",
      path: "/asset/{id}",
      tags: ["Assets"],
      summary: "Download asset",
      description:
        "Download an uploaded asset. Requires a real credential (session, personal API key, or MCP key) and membership of the asset's workspace; image types are served inline, everything else as an attachment.",
      request: { params: z.object({ id: z.string() }) },
      responses: {
        200: {
          description: "The requested asset binary stream",
          content: { "*/*": { schema: { type: "string", format: "binary" } } },
        },
        304: { description: "Not modified" },
        401: errorResponse("No credential at all"),
        403: errorResponse("No access to this asset"),
        404: errorResponse("Asset not found"),
      },
    }),
    async (c) => {
      const { id } = c.req.param();
      // #281 sweep: this id reaches a raw `eq(assetTable.id, ...)` query below,
      // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
      rejectNulByte(id, "Asset id");
      const [asset] = await db
        .select({
          id: schema.assetTable.id,
          objectKey: schema.assetTable.objectKey,
          mimeType: schema.assetTable.mimeType,
          filename: schema.assetTable.filename,
          workspaceId: schema.assetTable.workspaceId,
        })
        .from(schema.assetTable)
        // The join selects nothing now that `is_public` is gone, but it is kept
        // deliberately: it still requires the asset to belong to a real project,
        // so an orphaned asset row 404s rather than being served.
        .innerJoin(
          schema.projectTable,
          eq(schema.assetTable.projectId, schema.projectTable.id),
        )
        .where(eq(schema.assetTable.id, id))
        .limit(1);

      if (!asset) {
        throw new HTTPException(404, { message: "Asset not found" });
      }

      await authorizeAssetAccess(c, asset);

      try {
        const object = await getPrivateObject(asset.objectKey);
        const storedContentType =
          (object.contentType || asset.mimeType)
            .toLowerCase()
            .split(";")[0]
            ?.trim() ?? "";
        const inline = SAFE_INLINE_ASSET_TYPES.has(storedContentType);

        return new Response(object.body as BodyInit, {
          headers: {
            // Every asset is private: TaskDesk has no public-project read path.
            "Cache-Control": "private, max-age=120",
            "Content-Disposition": buildContentDisposition(
              asset.filename,
              inline,
            ),
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": inline
              ? storedContentType
              : "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            ETag: object.etag || "",
            "Last-Modified": object.lastModified?.toUTCString() || "",
          },
        });
      } catch (error) {
        console.error("Failed to stream asset:", error);
        throw new HTTPException(404, { message: "Asset object not found" });
      }
    },
  );

  const oauthApi = api.route("/oauth", oauth);
  const capabilitiesApi = api.route("/capabilities", capabilities);
  const projectApi = api.route("/project", project);
  const taskApi = api.route("/task", task);
  const columnApi = api.route("/column", column);
  const activityApi = api.route("/activity", activity);
  const commentApi = api.route("/comment", comment);
  const timeEntryApi = api.route("/time-entry", timeEntry);
  const labelApi = api.route("/label", label);
  const notificationApi = api.route("/notification", notification);
  const notificationPreferencesApi = api.route(
    "/notification-preferences",
    notificationPreferences,
  );
  const searchApi = api.route("/search", search);
  const taskRelationApi = api.route("/task-relation", taskRelation);
  const externalLinkApi = api.route("/external-link", externalLink);
  const workflowRuleApi = api.route("/workflow-rule", workflowRule);
  const invitationApi = api.route("/invitation", invitation);
  const workspaceApi = api.route("/workspace", workspace);
  // #23 -- mounted at the api root, not a feature prefix: the spec's own API table names
  // two different path shapes for this one resource (`/projects/{projectId}/work-items`,
  // `/work-items/{key}`), which `workItem`'s own routes already declare in full. See
  // `work-item/index.ts`'s file comment.
  const workItemApi = api.route("/", workItem);
  const userApi = api.route("/user", user);

  // User-scoped WebSocket endpoint; MUST be registered before /ws/:projectId
  // so the literal path "user" isn't consumed by the param route.
  api.get(
    "/ws/user",
    upgradeWebSocket(async (c) => {
      try {
        await authenticateApiRequest(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");
      let conn: ReturnType<typeof addUserConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (userId) {
            conn = addUserConnection(userId, ws);
          }
        },
        onMessage(evt) {
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : Buffer.isBuffer(evt.data)
                  ? evt.data.toString()
                  : null;
            if (raw) {
              const msg = JSON.parse(raw) as { type?: string };
              if (msg?.type === "ping") {
                // keepalive, no-op
              }
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose() {
          if (conn && userId) {
            removeUserConnection(userId, conn);
          }
        },
      };
    }),
  );

  api.get(
    "/ws/:projectId",
    upgradeWebSocket(async (c) => {
      const projectId = c.req.param("projectId");

      try {
        await authenticateApiRequest(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");

      if (projectId) {
        // #281 sweep: this id reaches a raw `eq(projectTable.id, ...)` query below,
        // unvalidated -- a NUL byte would otherwise 500 instead of a clean 400.
        rejectNulByte(projectId, "Project id");
        const [project] = await db
          .select({ workspaceId: schema.projectTable.workspaceId })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, projectId))
          .limit(1);

        if (!project) {
          throw new HTTPException(401, { message: "Unauthorized" });
        }

        await validateWorkspaceAccess(userId, project.workspaceId);
      }

      const windowId = c.req.query("windowId");
      const initiatorId = windowId ? `${userId}:${windowId}` : userId;
      let conn: ReturnType<typeof addConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (projectId) {
            conn = addConnection(projectId, ws, userId, initiatorId);
          }
        },
        onMessage(evt) {
          // Respond to client keepalive pings (sent every 30s to prevent
          // Cloudflare from closing idle connections at 100s timeout)
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : Buffer.isBuffer(evt.data)
                  ? evt.data.toString()
                  : null;
            if (raw) {
              const msg = JSON.parse(raw) as { type?: string };
              if (msg?.type === "ping") {
                // No-op: receiving the ping is enough to satisfy Cloudflare.
                // A pong response is optional but helps confirm liveness.
              }
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose() {
          if (conn && projectId) {
            removeConnection(projectId, conn);
          }
        },
      };
    }),
  );

  app.route("/api", api);
  registerStaticServing(app, options.staticRoot);

  return {
    app,
    api,
    injectWebSocket,
    activityApi,
    capabilitiesApi,
    columnApi,
    commentApi,
    configApi,
    externalLinkApi,
    invitationApi,
    invitationPublicApi,
    oauthApi,
    labelApi,
    notificationApi,
    notificationPreferencesApi,
    projectApi,
    searchApi,
    taskApi,
    taskRelationApi,
    timeEntryApi,
    userApi,
    workflowRuleApi,
    workItemApi,
    workspaceApi,
  };
}

export async function runStartupTasks() {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  // Issue #296: every DDL step below — the hand-written pre-migrate fixups,
  // Drizzle's own `migrate()`, and the role/grant bootstrap — runs on the
  // migration/owner connection (`TASKDESK_MIGRATION_DATABASE_URL`, falling back to
  // `TASKDESK_DATABASE_URL` when unset), never on the application connection
  // `getDatabase()` serves requests with. `waitForDatabase` also probes on the
  // migration connection: on a fresh deployment the application role does not
  // exist yet, and `ensureApplicationRole` (below) is what creates it — probing
  // with the application connection first would fail before it ever gets the
  // chance to.
  const migrationDb = getMigrationDatabase();

  await prepareDatabaseStartup({
    resolveConfig: resolveMigrationDatabaseConfig,
    waitForDatabase: async () => {
      await waitForDatabase({
        query: async () => {
          await migrationDb.execute(sql`SELECT 1`);
        },
      });
    },
    runStartupMigrations: async () => {
      await migrateWorkspaceUserEmail(migrationDb);
      await migrateSessionColumn(migrationDb);

      console.log("🔄 Migrating database...");
      await migrate(migrationDb, {
        migrationsFolder: `${currentDir}/../drizzle`,
      });
      console.log("✅ Database migrated successfully!");

      // After Drizzle migrations: apikey table must exist so we can align columns
      // with Better Auth (reference_id + nullable user_id).
      await migrateApiKeyReferenceId(migrationDb);
      await migrateNotificationPreferencesSchema(migrationDb);

      // Creates/repairs the non-superuser application role and its grants — must
      // run as the owner, after the schema it grants on exists, and before
      // anything below connects as the application role for the first time.
      await ensureApplicationRole(migrationDb);
    },
  });

  // Startup is done with the owner connection: nothing past this point runs DDL,
  // and holding a second pool open for the rest of the process's life would only
  // compete with the application pool for the database's max_connections.
  await closeMigrationPool();

  // First use of the application connection. `ensureApplicationRole` above just
  // created/fixed the role it authenticates as, so this is also the right moment
  // to assert the invariant every append-only/no-DDL control on this connection
  // depends on: it must not be a superuser, and it must not own a table.
  await assertApplicationRoleIsNotPrivileged(getDatabase());

  console.log(`🔐 ${policyRegistry.entries.length} policies loaded`);

  await migrateColumns();
  await seedDefaultWorkspaceRoles();
  await seedInternalOrganisationAndStaffPersons();

  // #18: print a fresh setup token (and invalidate the previous one) on
  // every boot while the instance is unclaimed. A no-op once
  // instance_setting.setup_completed_at is set.
  await ensureSetupToken();

  initializePlugins();
  initializeScheduler();
  await initializeWebSocketAdapter();
}

const DEFAULT_PORT = 5173;
const MAX_PORT = 65535;

/**
 * Resolves TASKDESK_PORT to a bindable port, falling back to DEFAULT_PORT for anything
 * outside the valid TCP range (1-65535) rather than passing it straight to
 * @hono/node-server's serve(), which throws a RangeError that becomes an unhandled
 * rejection and crashes the process instead of a graceful fallback.
 */
export function resolvePort(rawPort: string | undefined): {
  port: number;
  invalid: boolean;
} {
  const parsedPort = rawPort === undefined ? Number.NaN : Number(rawPort);
  const isValidPort =
    Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= MAX_PORT;
  return {
    port: isValidPort ? parsedPort : DEFAULT_PORT,
    invalid: rawPort !== undefined && !isValidPort,
  };
}

export async function startServer(
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"],
  port = DEFAULT_PORT,
) {
  try {
    await runStartupTasks();
  } catch (error) {
    console.error("❌ Database migration failed!", error);
    process.exit(1);
  }

  let shuttingDown = false;

  const server = serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      console.log(
        `⚡ API is running at ${process.env.KANEO_API_URL || `http://localhost:${port}`}`,
      );
    },
  );

  injectWebSocket(server);

  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("🛑 Shutting down gracefully...");
    shutdownScheduler();
    await shutdownWebSocketAdapter();
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });

  process.on("SIGINT", () => {
    void gracefulShutdown();
  });
}

const createdApp = createApp();
const {
  app,
  injectWebSocket,
  activityApi,
  capabilitiesApi,
  columnApi,
  commentApi,
  configApi,
  externalLinkApi,
  invitationApi,
  invitationPublicApi,
  oauthApi,
  labelApi,
  notificationApi,
  notificationPreferencesApi,
  projectApi,
  searchApi,
  taskApi,
  taskRelationApi,
  timeEntryApi,
  userApi,
  workflowRuleApi,
  workItemApi,
  workspaceApi,
} = createdApp;

const entrypoint = process.argv[1];
const isMainModule =
  entrypoint !== undefined &&
  entrypoint !== "" &&
  import.meta.url === pathToFileURL(entrypoint).href;

if (isMainModule) {
  const rawPort = process.env.TASKDESK_PORT;
  const { port, invalid } = resolvePort(rawPort);
  if (invalid) {
    console.warn(
      `⚠ TASKDESK_PORT="${rawPort}" is not a valid port (1-65535) — falling back to ${DEFAULT_PORT}`,
    );
  }
  void startServer(injectWebSocket, port);
}

export type AppType =
  | typeof configApi
  | typeof projectApi
  | typeof taskApi
  | typeof columnApi
  | typeof activityApi
  | typeof commentApi
  | typeof timeEntryApi
  | typeof labelApi
  | typeof notificationApi
  | typeof notificationPreferencesApi
  | typeof searchApi
  | typeof taskRelationApi
  | typeof externalLinkApi
  | typeof workflowRuleApi
  | typeof workItemApi
  | typeof invitationApi
  | typeof workspaceApi
  | typeof userApi
  | typeof invitationPublicApi
  | typeof oauthApi
  | typeof capabilitiesApi;

export default app;
