import {
  isSingleMembershipRole,
  membershipRoleProblem,
} from "@taskdesk/permissions";
import type { Context } from "hono";
import db from "../database";
import { resolveMembershipRole } from "./workspace-member-roles";

/**
 * The compatibility boundary in front of the still-mounted better-auth `organization()`
 * plugin — issue #82, scope items "plugin compatibility behaviour" and "S7 write routes must
 * never create a multi-role value. Enforced at the route, not by convention."
 *
 * ## The problem this exists to close
 *
 * `organization()` is still mounted (unmounting is retrofit S10, which has not started), so
 * TWO authorization evaluators read `workspace_member.role` at the same time and they read
 * it differently:
 *
 * | on the stored value `"owner,admin"` | verdict |
 * | --- | --- |
 * | better-auth `permission.mjs:2-11` | comma-SPLITS and **ORs** — the union of both roles |
 * | TaskDesk `require-workspace-permission.ts` | exact match — no such role, denied |
 *
 * Issue #82 forbids closing that gap the easy way round: the native evaluator must NOT learn
 * to comma-split, because the union is the vulnerability. The gap therefore has to close from
 * the other side — by making sure the plugin never sees a value it would read as a union. That
 * is what this middleware does, in two halves, and both halves are needed:
 *
 * **1. No request may CREATE a multi-role value.** Every plugin route that writes a role
 * takes it as `z.union([z.string(), z.array(z.string())])` and comma-joins an array
 * (`parseRoles`, `organization.mjs:18-20`); worse, `crud-members.mjs:259` splits any STRING
 * on comma too, so the array-vs-string distinction in the body schema buys nothing and
 * `role: "admin,viewer"` lands in the column exactly like `role: ["admin","viewer"]`. Both
 * shapes are refused here, before the handler runs, with `400`.
 *
 * **2. No request may READ a multi-role value.** The write half cannot help a deployment that
 * ALREADY has such a row — migration `0050` repairs the unambiguous ones and `RAISE`s on the
 * rest, and `startServer` exits non-zero when a migration fails, so a deployment holding an
 * unrepairable `"owner,admin"` does not serve at all until an administrator resolves it. (An
 * earlier version of this paragraph said such an operator "may be sitting on" that row while
 * the application ran. False, and it overstated the case for this half.) The half is still
 * warranted: it is what makes the two evaluators agree on any malformed row that reaches a
 * running process — one written before `0050`'s CHECK was validated, or in a deployment where
 * that constraint has since been dropped. While such a row exists the plugin would still OR
 * it, so any organization
 * route on which the caller's own role is an authorization input is refused `409` when that
 * role is malformed. This is what makes the two evaluators agree rather than merely making
 * one of them stricter: native denies, and the plugin is never asked.
 *
 * ## What is deliberately NOT guarded, and why
 *
 * `EXEMPT_FROM_MEMBERSHIP_CHECK` below lists the organization routes where the caller's
 * existing role in the active organization is not an authorization input. Guarding those
 * would take a real defect — a corrupt row in workspace A — and turn it into an unrelated
 * outage: unable to create workspace B, unable to list their own invitations, unable even to
 * leave the workspace whose row is broken. Fail-closed means refusing the decisions that
 * depend on the corrupt value, not bricking the account that holds it. Note the write half
 * still applies to every path, exempt or not: `accept-invitation` is exempt from the
 * membership READ check and still cannot write a multi-role value.
 *
 * ## Bounding the claim
 *
 * This is a boundary control over an inherited surface, not a redesign of it. It does not
 * make the plugin's split-and-OR correct, and it does not remove it; it removes the inputs on
 * which that logic differs from TaskDesk's. The durable fix is S10 unmounting `organization()`
 * altogether, and the `CHECK` constraint from migration `0050` is the backstop underneath
 * both — so a route this middleware has not anticipated still cannot persist a union.
 */

/**
 * Organization routes where the caller's own membership role is NOT an authorization input,
 * so a malformed row of theirs must not refuse the request. Each entry is a path suffix
 * under `/organization/`.
 */
const EXEMPT_FROM_MEMBERSHIP_CHECK = new Set([
  // Acts on no existing organization at all.
  "create",
  "check-slug",
  // Scoped to the caller's own user, not to a role in an organization.
  "list",
  "set-active",
  "list-user-invitations",
  "get-invitation",
  // Creates or declines a membership; the caller's EXISTING role is not consulted, and
  // better-auth runs its own last-owner guard on `leave`.
  "accept-invitation",
  "reject-invitation",
  "leave",
]);

/**
 * Body fields that carry a role and are written to `workspace_member.role` or to
 * `workspace_role.role`. `role` covers `add-member`, `invite-member` and
 * `update-member-role` (a member's assignment) and `create-role` (a role's NAME — a name
 * containing a comma would produce a `workspace_role` row that can only ever be referenced
 * by a value this invariant forbids). `roleName` covers `update-role`, at the top level and
 * inside its `data` object.
 */
const ROLE_BEARING_FIELDS = ["role", "roleName"] as const;

type RoleWriteProblem = { field: string; message: string };

/**
 * What this guard could establish about the request's body.
 *
 * ## The bypass this replaces
 *
 * This middleware is the write boundary that stops a multi-role value ever reaching
 * `workspace_member.role`, because better-auth's evaluator comma-SPLITS that column and ORs
 * the parts while TaskDesk's matches it exactly. It used to decide whether to look at the
 * body like this:
 *
 *     const contentType = c.req.header("content-type") ?? "";
 *     if (!contentType.includes("application/json")) return null;   // = "nothing to check"
 *
 * `String.includes` is case-SENSITIVE. RFC 9110 §8.3 makes a media type's type and subtype
 * case-INSENSITIVE, **and better-auth agrees with the specification** — it accepts and parses
 * `Content-Type: Application/JSON`. So that one spelling was parsed by better-auth and skipped
 * by the guard, and `role: "owner,admin"` landed in the column. A privilege escalation
 * reachable by changing one character of a header.
 *
 * ## What better-auth actually does — read at source, after two wrong answers
 *
 * The first draft of this fix asserted that better-auth "reads the body with `request.json()`
 * and never consults `Content-Type`". **Wrong** — the oracle in
 * `multi-role-membership-content-type.test.ts` caught it: `text/plain`, `garbage` and an
 * absent header all get **415** and are never parsed, so they were never bypass vectors.
 *
 * The second draft then measured fifteen media types, saw that every accepted one began
 * `application/json`, and wrote `startsWith("application/json")` down as "better-auth's
 * rule". **Also wrong** — an inference from a sample, stated as a measurement. An independent
 * review found a spelling where the two disagree: `application/x+jsonapplication/json` is
 * parsed by better-auth and was classified not-parsed here.
 *
 * So the rule below is not inferred. It is `better-call@1.3.7`'s `getBody`
 * (`dist/utils.mjs:4-55`), read directly, with `allowedMediaTypes: ["application/json"]` as
 * `better-auth/dist/api/index.mjs:161` configures it. Two stages:
 *
 *   1. **the 415 gate** — `contentType.toLowerCase().split(";")[0].trim()` must **contain**
 *      the substring `application/json`. Otherwise `getBody` throws
 *      `415 UNSUPPORTED_MEDIA_TYPE` and the body is never read at all.
 *   2. **the JSON branch** — the body is parsed as JSON iff
 *      `/^application\/([a-z0-9.+-]*\+)?json/i` matches the lower-cased header, parameters
 *      included. A type that clears the gate but fails this regex falls through to
 *      better-call's form and text branches, where a `role` key cannot survive.
 *
 * Neither stage is `startsWith`. Stage 1 admits `application/json.`, `application/json/`,
 * `application/jsonx` and `application/x+jsonapplication/json`, and rejects
 * `application/vnd.api+json` and `text/json`, which look JSON-ish and are not accepted.
 * Stage 2 is what excludes `x-application/json`, which clears stage 1.
 *
 * ## The rule here
 *
 * `betterAuthWillParseBody` mirrors the table above, so the guard inspects everything
 * better-auth would parse. Within that set, a body whose shape cannot be established is
 * **refused** rather than waved through — fail-closed, because a control whose failure mode is
 * silence must not fail open.
 *
 * Outside that set, the guard still *tries* to parse, and still refuses a role-bearing object
 * it finds there. That is deliberate defence in depth: it means this boundary does not derive
 * its safety from better-auth continuing to answer 415, which is exactly the kind of
 * borrowed-authority assumption that produced the original defect. What it does not do is
 * invent a new refusal for bodies better-auth will reject anyway — a `text/plain` request with
 * no role in it still gets better-auth's own 415, unchanged.
 *
 * Reads the body WITHOUT consuming the request: `buildAuthRequest` forwards the original to
 * better-auth as `new Request(c.req.raw, { headers })`, which reuses `c.req.raw`'s body stream.
 * Reading that stream here — including via Hono's own `c.req.json()`, which delegates to
 * `this.raw.json()` — would leave the forwarded request with a spent body and every guarded
 * route would break. Cloning first is what keeps the original intact.
 */
type BodyPeek =
  | { kind: "none" }
  | { kind: "object"; body: Record<string, unknown> }
  | { kind: "unreadable"; reason: string };

/** Methods that carry no body, so this guard has nothing to inspect on them. */
const BODILESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * better-call's JSON branch, copied from `better-call@1.3.7/dist/utils.mjs:4`, kept as a
 * named constant so the two stages below read as the two stages they mirror.
 */
const BETTER_CALL_JSON_MEDIA_TYPE = /^application\/([a-z0-9.+-]*\+)?json/i;

/**
 * Whether better-auth will parse this request's body as JSON — the two stages documented
 * above, in better-call's own order.
 *
 * What pins this to better-auth's behaviour is **not** the ORACLE group, despite an earlier
 * comment here saying so. The review that found this function wrong also found that the
 * ORACLE group *cannot* detect the error, because it drives only well-formed bodies, which
 * the right rule and the wrong one both accept. What discriminates is the **UNREADABLE
 * group's malformed-JSON probes** — the only requests whose refusal depends on whether this
 * function says better-auth would have parsed that body. They are parametrised over the whole
 * media-type table for exactly that reason.
 */
function betterAuthWillParseBody(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  // Stage 1 — better-call's 415 gate, against the media type without its parameters.
  // `split` always yields at least one element, so `?? normalized` is unreachable; it is
  // here because `noUncheckedIndexedAccess` types the index access as possibly undefined,
  // and the safe fallback is the whole header rather than the empty string.
  const essence = (normalized.split(";")[0] ?? normalized).trim();
  if (!essence.includes("application/json")) return false;
  // Stage 2 — its JSON branch, against the whole header, parameters included.
  return BETTER_CALL_JSON_MEDIA_TYPE.test(normalized);
}

async function peekJsonBody(c: Context): Promise<BodyPeek> {
  if (BODILESS_METHODS.has(c.req.method.toUpperCase())) return { kind: "none" };

  const willParse = betterAuthWillParseBody(c.req.header("content-type"));

  let raw: string;
  try {
    raw = await c.req.raw.clone().text();
  } catch {
    return willParse
      ? { kind: "unreadable", reason: "the request body could not be read" }
      : { kind: "none" };
  }

  // No body at all carries no role, and better-auth's own schema will reject the request if
  // the route needed one. Failing closed here would break every bodiless route for no gain.
  if (raw.trim() === "") return { kind: "none" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Fail closed only where better-auth WOULD have parsed it. Elsewhere its 415 is the
    // right answer and this guard has nothing to add.
    return willParse
      ? {
          kind: "unreadable",
          reason:
            "the request declares a JSON media type and its body is not valid JSON",
        }
      : { kind: "none" };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return willParse
      ? { kind: "unreadable", reason: "the request body is not a JSON object" }
      : { kind: "none" };
  }

  // A JSON object, whatever the header claimed. Inspected either way: see the
  // defence-in-depth paragraph above.
  return { kind: "object", body: value as Record<string, unknown> };
}

/** The refusal reason for one role-bearing value, or `null` when it is exactly one role. */
function roleValueProblem(
  field: string,
  value: unknown,
): RoleWriteProblem | null {
  if (Array.isArray(value)) {
    // The array form is the shape better-auth comma-JOINS. A one-element array is not a
    // union and is allowed through, after its single element is checked like any string.
    if (value.length !== 1) {
      return {
        field,
        message: `"${field}" must name exactly one role. One workspace membership holds exactly one role (issue #82); an array of ${value.length} roles is stored comma-joined and then read back as the union of those roles.`,
      };
    }
    return roleValueProblem(field, value[0]);
  }

  if (typeof value !== "string") {
    // Not a shape this guard understands; better-auth's own zod schema will reject it.
    return null;
  }

  if (isSingleMembershipRole(value)) return null;

  const problem = membershipRoleProblem(value);
  const detail =
    problem === "multi-valued"
      ? "it contains a comma, and a comma-joined value is read back as the union of its parts"
      : problem === "empty"
        ? "it names no role at all"
        : "it carries leading or trailing whitespace, which no role name may";
  return {
    field,
    message: `"${field}" must name exactly one role (issue #82): ${detail}.`,
  };
}

/** Every role-bearing field in this body, top level and inside `data`. */
function roleWriteProblems(
  body: Record<string, unknown>,
): RoleWriteProblem | null {
  for (const field of ROLE_BEARING_FIELDS) {
    if (field in body) {
      const problem = roleValueProblem(field, body[field]);
      if (problem) return problem;
    }
  }

  const data = body.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const field of ROLE_BEARING_FIELDS) {
      const nested = data as Record<string, unknown>;
      if (field in nested) {
        const problem = roleValueProblem(`data.${field}`, nested[field]);
        if (problem) return problem;
      }
    }
  }

  return null;
}

/**
 * **Every** organization this request could be acting on — not the first one that resolves.
 *
 * The single-value version of this function was steerable, and the escalation was
 * demonstrated rather than theorised. It resolved body → query → session-active and returned
 * the first hit. But better-auth's `update-member-role` resolves
 * `ctx.body.organizationId || session.session.activeOrganizationId` and **never reads the
 * query string** (`crud-members.mjs:256`). So appending `?organizationId=<any id>` to a body
 * that omits `organizationId` pointed this guard at an organization the caller holds no row
 * in — which resolves to `no-membership`, a state half 2 deliberately does not refuse — while
 * better-auth went on to act on the caller's **session-active** organization, whose row was
 * the malformed one. Measured: the control request returned `409
 * MALFORMED_MEMBERSHIP_ROLE`; the same request with `?organizationId=<random id>` returned
 * **200 and the write landed.**
 *
 * The mismatch is not confined to one route. `add-member`, `invite-member`, `remove-member`,
 * `create-team` and `update-team` are body-only like `update-member-role`, and
 * `list-invitations`, `get-full-organization`, `list-roles`, `get-role` and
 * `get-active-member` read the query — so a guard preferring either source is wrong for the
 * other half of the surface.
 *
 * Rather than encode a per-route table of which source each better-auth handler happens to
 * consult — a table that would go stale the first time better-auth changed one — this returns
 * all of them and the caller refuses if **any** resolves to a malformed role. A request that
 * names two different organizations is already outside anything the product does; refusing on
 * the union of them costs nothing real and cannot be steered by adding a parameter the target
 * handler ignores.
 */
function candidateOrganizationIds(
  body: Record<string, unknown> | null,
  c: Context,
  activeOrganizationId: string | null,
): string[] {
  const candidates: string[] = [];
  const fromBody = body?.organizationId;
  if (typeof fromBody === "string" && fromBody.length > 0)
    candidates.push(fromBody);
  const fromQuery = c.req.query("organizationId");
  if (fromQuery) candidates.push(fromQuery);
  if (activeOrganizationId) candidates.push(activeOrganizationId);
  return [...new Set(candidates)];
}

type SessionReader = (
  headers: Headers,
) => Promise<{ userId: string; activeOrganizationId: string | null } | null>;

/**
 * Returns the refusal this request has earned, or `null` to let it through.
 *
 * WHY A PLAIN FUNCTION AND NOT HONO MIDDLEWARE, because it looks like middleware and the
 * difference is load-bearing. Registering `api.use("/auth/*", ...)` adds a router entry keyed
 * `ALL /api/auth/*`, and `packages/permissions`'s route-coverage gate counts every entry it
 * does not recognise as a ROUTE on the `auth` surface — so the middleware form failed
 * `pnpm test:permissions` with `auth: expected 7 to be 8`, an undeclared endpoint with no
 * policy. The gate is right to do that: `DECLARED_ROUTER_MIDDLEWARE` is a hand-reviewed list
 * whose own comment says "growing this list is a decision, not an inference", and
 * `packages/permissions` is a shared contract this lane does not own. Calling this from
 * inside the existing `/auth/*` handler adds no router entry at all, so the route inventory
 * — and the gate's baseline — are untouched by a security fix that has no business changing
 * either.
 *
 * That placement loses nothing: every `/auth/organization/*` request reaches better-auth
 * through that one catch-all. The two `/auth/**` routes registered separately
 * (`/auth/get-session` and `/auth/device`) are neither organization routes nor role-bearing.
 *
 * @param readSession injected rather than importing `auth` directly, so this module stays
 *        free of the auth graph (which imports half the application) and so the membership
 *        half can be exercised without standing up a session in a unit test.
 */
export function organizationPluginRoleGuard(readSession: SessionReader) {
  return async (c: Context): Promise<Response | null> => {
    const path = c.req.path;
    const marker = "/organization/";
    const markerIndex = path.indexOf(marker);
    if (markerIndex === -1) return null;
    const action = path.slice(markerIndex + marker.length);

    const peek = await peekJsonBody(c);

    // Fail closed. A body this guard could not read is a body it could not check, and
    // better-auth does not need a well-formed `Content-Type` to parse one — so letting it
    // through is the bypass, not the courtesy.
    if (peek.kind === "unreadable") {
      return c.json(
        {
          error: "UNREADABLE_REQUEST_BODY",
          message: `This request cannot be checked against the one-membership-one-role invariant (issue #82), so it is refused: ${peek.reason}. Send a JSON object body with \`Content-Type: application/json\`.`,
        },
        400,
      );
    }

    const body = peek.kind === "object" ? peek.body : null;

    // Half 1 — no request may CREATE a multi-role value. Applies to every organization
    // route, including the ones exempt from the membership check below.
    if (body) {
      const problem = roleWriteProblems(body);
      if (problem) {
        return c.json(
          {
            error: "INVALID_ROLE_VALUE",
            message: problem.message,
            field: problem.field,
          },
          400,
        );
      }
    }

    if (EXEMPT_FROM_MEMBERSHIP_CHECK.has(action)) return null;

    // Half 2 — no request may READ a multi-role value.
    const session = await readSession(c.req.raw.headers);
    if (!session) return null; // Unauthenticated: better-auth's own 401 to issue.

    const organizationIds = candidateOrganizationIds(
      body,
      c,
      session.activeOrganizationId,
    );
    if (organizationIds.length === 0) return null;

    // Refuse if ANY candidate resolves to a malformed role. Checking only the one this
    // guard guesses the handler will use is what made the single-value version steerable.
    for (const organizationId of organizationIds) {
      const membership = await resolveMembershipRole(
        db,
        organizationId,
        session.userId,
      );
      if (membership.ok === false && membership.reason === "malformed-role") {
        return c.json(
          {
            error: "MALFORMED_MEMBERSHIP_ROLE",
            message:
              "This workspace membership does not hold exactly one role, so no authorization decision can be made from it. An administrator must reassign a single role to this member.",
            problem: membership.problem,
          },
          409,
        );
      }
    }

    return null;
  };
}
