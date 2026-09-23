/**
 * The route-policy registry, assembled.
 *
 * Every feature folder owns a `policy.ts` exporting a `PolicyMap`; this file is the list of
 * them, plus the policies for the surfaces that are registered directly on the app in
 * `index.ts` and so have no feature folder of their own — the `/auth/*` mount, the websocket
 * upgrade routes and the health probe.
 *
 * `tests/permissions/route-coverage.test.ts` walks **Hono's actual router** and fails on any
 * route that is not in here. Adding a route without a policy therefore fails the build, which
 * is the whole point of ADR 0010 and the reason issue #7 gates Throttle 1.
 *
 * **Scope note.** The inherited kaneo surface is not classified here. Final route-by-route
 * classification of what survives #6 belongs to #8, and every inherited route still awaiting a
 * verdict is listed in `tests/permissions/inherited-uncovered.json`, which shrinks to nothing
 * as #8 lands. What is declared below is the machinery's proof of life: one of each surface
 * the coverage test has to account for.
 *
 * **`GET /api/asset/{id}` was moved below the auth guard** in `index.ts` as part of this
 * classification pass (issue #8), which is what H2's own text names as the fix for the
 * exact example it uses (`isWithinAuthGuardScope()`,
 * `packages/permissions/src/route-coverage.ts`) — its handler calls `authorizeAssetAccess`,
 * which requires a real bearer/API-key/session credential and then checks workspace
 * membership, so it was never actually public; it just sat above the guard. Its policy now
 * lives in `apps/api/src/asset/policy.ts`, wired below like every other feature folder.
 */

import {
  createPolicyRegistry,
  type PolicyMap,
  type PolicyRegistry,
} from "@taskdesk/permissions";
import { activityPolicies } from "./activity/policy";
import { assetPolicies } from "./asset/policy";
import { capabilitiesPolicies } from "./capabilities/policy";
import { columnPolicies } from "./column/policy";
import { commentPolicies } from "./comment/policy";
import { configPolicies } from "./config/policy";
import { externalLinkPolicies } from "./external-link/policy";
import { instancePolicies } from "./instance/policy";
import { invitationPolicies } from "./invitation/policy";
import { labelPolicies } from "./label/policy";
import { notificationPolicies } from "./notification/policy";
import { notificationPreferencesPolicies } from "./notification-preferences/policy";
import { oauthPolicies } from "./oauth/policy";
import { projectPolicies } from "./project/policy";
import { searchPolicies } from "./search/policy";
import { taskPolicies } from "./task/policy";
import { taskRelationPolicies } from "./task-relation/policy";
import { timeEntryPolicies } from "./time-entry/policy";
import { userPolicies } from "./user/policy";
import { workItemPolicies } from "./work-item/policy";
import { workflowRulePolicies } from "./workflow-rule/policy";
import { workspacePolicies } from "./workspace/policy";

/**
 * Routes registered directly on the app rather than in a feature router.
 *
 * These are exactly the surfaces the OpenAPI document cannot see, which is why the coverage
 * test enumerates the router instead.
 */
export const platformPolicies = {
  // The better-auth mount. One handler; its endpoint set is the plugin list, rebuilt at
  // runtime from database configuration, so the router shows a wildcard where dozens of
  // endpoints live. The allowlist assertion in better-auth-plugin-list.test.ts is what
  // closes that gap — this entry only records that the mount is a deliberate delegation.
  "GET /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "POST /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "PUT /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "PATCH /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },
  "DELETE /api/auth/*": {
    delegated: "better-auth",
    reason:
      "better-auth owns authentication; its endpoint set is the approved plugin list",
  },

  // The websocket surface. The upgrade handler authenticates the request itself before the
  // socket opens; there is no Hono response for a policy middleware to shape.
  "GET /api/ws/user": {
    delegated: "websocket",
    reason:
      "websocket upgrade; the handler authenticates the session before the socket opens",
  },
  "GET /api/ws/{projectId}": {
    delegated: "websocket",
    reason:
      "websocket upgrade; the handler authenticates the session before the socket opens",
  },

  // The liveness probe. Returns a constant, reads nothing.
  "GET /api/health": {
    public: true,
    reason:
      "liveness probe for the container runtime and load balancer; returns a constant",
  },

  // Documented contract (docs/05-operations/deployment.md § Health and readiness):
  // liveness touches no dependency so a database blip never restarts a healthy
  // container; readiness checks the database so the proxy stops routing to a pod
  // that can't actually serve a request.
  "GET /api/public/health/live": {
    public: true,
    reason: "liveness probe — process is up, touches no dependency",
  },
  "GET /api/public/health/ready": {
    public: true,
    reason: "readiness probe — checks database reachability",
  },

  // storage/filesystem.ts's local stand-in for a presigned S3 PUT: there is no browser
  // session to check because there is no browser involved in a S3-style direct-upload PUT.
  // The route's own short-lived, key-scoped HMAC token (derived from TASKDESK_AUTH_SECRET,
  // verified with a constant-time comparison — see writeUploadedObject) is the credential,
  // exactly the way holding a presigned S3 URL is the credential for the equivalent S3 PUT.
  // Registered above the auth guard in index.ts; unlike GET /api/asset/{id} (moved below the
  // guard in this same batch, see apps/api/src/asset/policy.ts), this route's authorization
  // genuinely does not depend on a session at all, so it stays public and above the guard.
  "PUT /api/storage/filesystem-upload": {
    public: true,
    reason:
      "no session applies to a direct-PUT upload; authorized instead by a short-lived, " +
      "key-scoped signed token in the query string, verified in writeUploadedObject",
  },

  // --- Issue #8 classification pass: inline routes in index.ts (below). GET /api/asset/{id}
  // is classified separately, in apps/api/src/asset/policy.ts, since it was moved below the
  // auth guard in this same batch and so is no longer one of this map's above-guard entries.

  // `GET /api/invitation/public/{id}` (index.ts ~line 372). Read-only preview of a pending
  // invitation for the recipient, who by definition has not signed in yet — that is the whole
  // point of a "public" invite-preview link. Registered above the guard; H2 permits public
  // here honestly because `getInvitationDetails` (apps/api/src/utils/
  // check-registration-allowed.ts) requires no credential and none is checked. The id is a
  // `createId()` cuid2 (apps/api/src/database/schema.ts's invitationTable) — collision-
  // resistant and non-sequential, not a guessable index — so the email address the response
  // includes is only reachable by whoever already holds the exact invitation link (which was
  // itself delivered to that same email address), the same trust model as a password-reset
  // link.
  "GET /api/invitation/public/{id}": {
    public: true,
    reason:
      "invitation preview for a recipient who has not signed in yet; the invitation id is a " +
      "non-guessable cuid2, so this is the same trust model as a password-reset link",
  },

  // `GET /api/auth/get-session` (index.ts ~line 378) and `GET /api/auth/device` (index.ts
  // ~line 691) are both explicit, OpenAPI-documented carve-outs of the same `/auth/*` mount
  // the two wildcard entries above already delegate — registered before the wildcard purely
  // so they get their own schema/description in the OpenAPI document, not because they run
  // different authorization logic. Both are genuinely unauthenticated-callable by design:
  // get-session is exactly what a caller with no session yet uses to find that out, and the
  // OAuth device-authorization flow this lane's `auth/device` participates in is defined to
  // work before the caller has signed in. `get-session` forwards to `auth.handler` with no
  // extra logic; `auth/device` redirects a top-level browser navigation to the web app's
  // device screen (no data disclosed beyond the request's own `user_code`/`ui` query
  // parameters echoed into the redirect URL) and otherwise forwards to `auth.handler` exactly
  // like get-session. Same delegated kind and reason as the wildcard above.
  "GET /api/auth/get-session": {
    delegated: "better-auth",
    reason:
      "better-auth's own session-introspection endpoint, carved out of the /auth/* wildcard " +
      "only for its OpenAPI documentation; same delegation as the wildcard entries above",
  },
  "GET /api/auth/device": {
    delegated: "better-auth",
    reason:
      "OAuth device-authorization flow, carved out of the /auth/* wildcard only for its " +
      "OpenAPI documentation; unauthenticated by definition (the caller has not signed in " +
      "yet) and otherwise forwards to auth.handler exactly like the wildcard entries above",
  },

  // `GET /api/user/avatar/{id}` (index.ts ~line 564) — download a user's avatar image by its
  // avatar id. Unlike GET /api/asset/{id}, the handler (`user/controllers/get-avatar.ts`)
  // calls no authorization function at all: it loads the avatar by id and serves the bytes,
  // full stop. `security: []` in its own OpenAPI route declaration and the response's
  // `Cache-Control: public, max-age=31536000, immutable` are both consistent with genuine,
  // deliberate public/CDN-cacheable design (an avatar `<img src>` cannot carry an
  // Authorization header). The id changes whenever the avatar is replaced
  // (getUserAvatar's own summary), so the immutable cache is safe.
  "GET /api/user/avatar/{id}": {
    public: true,
    reason:
      "user avatar image, served with a long-lived immutable cache for <img> embedding; " +
      "the handler performs no authorization check by design and the id changes on replace",
  },

  // `GET /api/openapi` (index.ts ~line 620). Serves this API's own OpenAPI 3.1 document — the
  // schema itself, not any tenant data. No credential is checked. Already named explicitly in
  // issue #8's own H2 section as pre-existing kaneo behaviour to be classified here.
  "GET /api/openapi": {
    public: true,
    reason:
      "serves the API's own OpenAPI document (schema only, no tenant data); pre-existing " +
      "kaneo behaviour, unauthenticated by design",
  },
} as const satisfies PolicyMap;

export const POLICY_SOURCES = [
  {
    name: "apps/api/src/policy-registry.ts (platform)",
    policies: platformPolicies,
  },
  { name: "apps/api/src/instance/policy.ts", policies: instancePolicies },
  { name: "apps/api/src/project/policy.ts", policies: projectPolicies },
  { name: "apps/api/src/workspace/policy.ts", policies: workspacePolicies },
  { name: "apps/api/src/invitation/policy.ts", policies: invitationPolicies },
  { name: "apps/api/src/work-item/policy.ts", policies: workItemPolicies },
  { name: "apps/api/src/time-entry/policy.ts", policies: timeEntryPolicies },
  {
    name: "apps/api/src/capabilities/policy.ts",
    policies: capabilitiesPolicies,
  },
  { name: "apps/api/src/task/policy.ts", policies: taskPolicies },
  { name: "apps/api/src/column/policy.ts", policies: columnPolicies },
  {
    name: "apps/api/src/task-relation/policy.ts",
    policies: taskRelationPolicies,
  },
  {
    name: "apps/api/src/workflow-rule/policy.ts",
    policies: workflowRulePolicies,
  },
  {
    name: "apps/api/src/external-link/policy.ts",
    policies: externalLinkPolicies,
  },
  { name: "apps/api/src/comment/policy.ts", policies: commentPolicies },
  { name: "apps/api/src/activity/policy.ts", policies: activityPolicies },
  {
    name: "apps/api/src/notification/policy.ts",
    policies: notificationPolicies,
  },
  {
    name: "apps/api/src/notification-preferences/policy.ts",
    policies: notificationPreferencesPolicies,
  },
  { name: "apps/api/src/search/policy.ts", policies: searchPolicies },
  { name: "apps/api/src/user/policy.ts", policies: userPolicies },
  { name: "apps/api/src/oauth/policy.ts", policies: oauthPolicies },
  { name: "apps/api/src/config/policy.ts", policies: configPolicies },
  { name: "apps/api/src/label/policy.ts", policies: labelPolicies },
  { name: "apps/api/src/asset/policy.ts", policies: assetPolicies },
];

/**
 * Built at module load, so an invalid entry among `POLICY_SOURCES` throws immediately — this
 * module's own validation is not deferred to the first request that happens to hit a bad
 * route.
 *
 * **Status, updated 2026-09-23 (#8 Slice 0).** `apps/api/src/index.ts` now imports
 * `policyRegistry` at module scope and reads it in `runStartupTasks()` (logging the loaded
 * policy count), so constructing this module is on the production boot path, not only the
 * permissions test suite's. An invalid entry among `POLICY_SOURCES` now throws
 * `PolicyRegistryError` before the real server ever calls `listen()`, per ADR 0010 §1. What
 * this slice does not yet do: no request is evaluated against a policy, and no middleware
 * consults `policyRegistry` on the request path — that is the remaining runtime-authorization
 * work tracked on issue #8.
 */
export const policyRegistry: PolicyRegistry =
  createPolicyRegistry(POLICY_SOURCES);
