import type { PolicyMap } from "@taskdesk/permissions";

/**
 * User route policies.
 *
 * Covers the two routes in `apps/api/src/user/index.ts` -- avatar upload and delete. Both are
 * mounted at `const userApi = api.route("/user", user);` in `apps/api/src/index.ts`, well
 * below `api.use("*", ...)` (the app-wide auth guard) -- verified directly from the
 * registration order, not assumed. `GET /api/user/avatar/{id}` is a DIFFERENT route, registered
 * inline in `index.ts` itself (not in this sub-router), above the auth guard, with
 * `security: []` -- it is out of this lane's scope as briefed (the brief's route count for
 * this router, "user (2 routes)", already excludes it) and is left for whichever lane owns
 * `index.ts`'s inline routes.
 *
 * **Both are `self`, kind 2.** `saveAvatar`/`deleteAvatar` (`apps/api/src/user/controllers/
 * save-avatar.ts`, `delete-avatar.ts`) key every operation on `userId: c.get("userId")` --
 * `saveAvatar` upserts `userAvatarTable` on `target: userAvatarTable.userId` (the caller's own
 * row, `onConflictDoUpdate`), and `deleteAvatar` deletes `where(eq(userAvatarTable.userId,
 * userId))`. Neither takes a path or body parameter naming a different user -- there is no
 * capability question to ask, the same shape as `PUT /api/user/avatar`'s sibling routes in the
 * already-classified files this lane extends: `GET /api/workspace` (caller's own memberships),
 * `POST /api/invitation/{id}/accept` (caller's own invitation). `personParam` states the
 * `no_person_parameter` exemption for the same reason: the route names no person id at all --
 * the caller IS the person.
 *
 * Both writes are session-only under the explicit 2026-10-06 AK-9 decision: self-row
 * ownership is not an API-key write capability. The route middleware enforces the declaration;
 * avatar GET behavior is unchanged.
 */
export const userPolicies = {
  "PUT /api/user/avatar": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "replaces the caller's own stored avatar; the route names no person parameter because the caller is the person",
    },
  },

  "DELETE /api/user/avatar": {
    authenticated: true,
    self: true,
    sessionOnly: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "removes the caller's own stored avatar; the route names no person parameter because the caller is the person",
    },
  },
} as const satisfies PolicyMap;
