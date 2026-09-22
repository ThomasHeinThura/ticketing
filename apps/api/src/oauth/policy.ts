import type { PolicyMap } from "@taskdesk/permissions";

/**
 * OAuth route policy.
 *
 * `GET /api/oauth/id-token` (`apps/api/src/oauth/index.ts`) is mounted at
 * `const oauthApi = api.route("/oauth", oauth);` in `apps/api/src/index.ts`, well below
 * `api.use("*", ...)` (the app-wide auth guard) -- verified directly from the registration
 * order in `index.ts`, not assumed from the router's name. Every route below that guard is
 * authenticated without exception (the guard's own comment: "No prefix exemptions ... every
 * route mounted below this guard is authenticated without exception").
 *
 * **Not `delegated`.** The task brief for this lane flags `oauth` as worth checking carefully
 * against kind 5, and it was checked: `DELEGATED_SURFACES` (`packages/permissions/src/
 * policy.ts`) is a closed, explicitly-enumerated union -- `"better-auth" | "websocket" |
 * "metrics" | "scim"` -- and does not include `"oauth"`. This router is not a second
 * authentication surface the way kaneo's inherited `mcp`/`oauth` routers were flagged as a risk
 * in the pre-P0 review (`docs/07-planning/reviews/2026-09-05/pre-p0-check-fable/
 * L2-rbac-security.md`) -- that risk was about routers that themselves perform authentication
 * outside the session model. This router does not: `getIdToken` (`apps/api/src/oauth/
 * controllers/get-id-token.ts`) runs entirely inside the normal authenticated request path,
 * reading `c.get("userId")` the same way every other ordinary route does, and issues no
 * credential and starts no OAuth flow of its own -- it only reads back a token already stored
 * on the CALLER's own linked account row. Widening `DELEGATED_SURFACES` for it would be
 * inventing a sixth exception this router does not need and the closed union's own comment
 * ("adding a member is a decision-log entry, not an edit") does not authorise here.
 *
 * **`self`, kind 2.** `getIdToken(userId)` selects `accountTable.idToken` filtered to
 * `accountTable.userId = userId` and `providerId = "custom"` -- the caller's own linked custom
 * OAuth account, never another user's. There is no capability question to ask: any
 * authenticated identity may read back its own stored id_token, the same shape as
 * `GET /api/workspace` (the caller's own memberships) and `POST /api/invitation/{id}/accept`
 * (the caller's own invitation) in the already-classified files this lane extends alongside.
 * `personParam` states the `no_person_parameter` exemption for the same reason those routes do
 * -- the route names no person id at all; the caller IS the person, identified by their own
 * session/credential.
 *
 * No `sessionOnly`: the 2026-09-08 decision (`docs/07-planning/decision-log.md`, "Native
 * organization routes preserve inherited session-only reach") restricts personal-API-key reach
 * specifically to routes that replace a better-auth `organization()` route and touch
 * "workspace, membership, invitation or capability data". This route does none of that -- it
 * is a kaneo-inherited OAuth-account read, unrelated to the organization plugin -- and nothing
 * in `apps/api/src/oauth/index.ts` calls `requireSessionOnly()`, so declaring it here would be
 * the declared-and-inert shape `packages/permissions/src/policy.ts`'s own doc comment says this
 * registry exists to refuse.
 */
export const oauthPolicies = {
  "GET /api/oauth/id-token": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "returns the id_token stored on the caller's own linked custom OAuth account; the route names no person parameter because the caller is the person",
    },
  },
} as const satisfies PolicyMap;
