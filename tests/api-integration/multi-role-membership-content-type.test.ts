/**
 * Issue #82 — the role guard must not be steerable by the request's `Content-Type`.
 *
 * `organization-plugin-role-guard.ts` is the write boundary that stops a multi-role value
 * ever reaching `workspace_member.role`, because better-auth's evaluator comma-SPLITS that
 * column and ORs the parts while TaskDesk's matches it exactly. An earlier version of the
 * guard decided whether to look at the body from:
 *
 *     const contentType = c.req.header("content-type") ?? "";
 *     if (!contentType.includes("application/json")) return null;   // = "nothing to check"
 *
 * `String.includes` is case-SENSITIVE. RFC 9110 §8.3 makes a media type's type and subtype
 * case-INSENSITIVE. So `Content-Type: Application/JSON` — a spelling the specification says
 * is exactly the same media type — skipped the check entirely, and better-auth then parsed
 * the body anyway, because it reads it with `request.json()` and never consults the header.
 * A one-character change to a header was enough to write `role: "owner,admin"` and get the
 * union of both roles out of the plugin's evaluator.
 *
 * These probes pin the whole decision surface, not the one spelling that was broken:
 *
 *   §1  the media type is parsed, case-insensitively, with parameters tolerated;
 *   §2  a media type the guard does not recognise does NOT mean "nothing to check" —
 *       every body better-auth would parse is parsed here too;
 *   §3  a body whose shape cannot be established is REFUSED rather than waved through;
 *   §4  and the oracle, which is the reason the rest of the file means anything: a
 *       legitimate SINGLE-role write still succeeds under every one of those media types.
 *       Without §4 this file would pass just as happily against a guard that refused
 *       everything, which would be a different bug rather than a fix.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  inviteAndAcceptAsNewMember,
  plantLegacyMembershipRole,
  signUpUser,
  updateMemberRoleViaPluginRaw,
} from "./helpers/organization-http";

type App = ReturnType<typeof createApp>["app"];

async function getMemberRole(workspaceId: string, userId: string) {
  const [row] = await db
    .select({
      id: schema.workspaceUserTable.id,
      role: schema.workspaceUserTable.role,
    })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("getMemberRole: no row for that workspace/user");
  return row;
}

/**
 * An owner, a workspace, and a `viewer` member to aim writes at.
 *
 * `auth.ts` promotes the first user in an empty database to instance admin and
 * `resetTestDatabase()` empties it before each test, so a throwaway user takes that slot
 * first — otherwise the owner would also be an instance admin and would take a different
 * authorization branch than a plain workspace owner does.
 */
async function scenario(app: App) {
  await signUpUser(app); // consumes the instance-admin slot
  const owner = await signUpUser(app);
  const created = await createWorkspaceViaPlugin(app, owner.cookie);
  const workspace = (await created.json()) as { id: string };
  const target = await inviteAndAcceptAsNewMember(
    app,
    owner.cookie,
    workspace.id,
    "viewer",
  );
  const member = await getMemberRole(workspace.id, target.user.id);
  return { owner, workspace, target, memberId: member.id };
}

/**
 * Every media type this suite drives, each carrying **better-auth's own measured answer** to a
 * legitimate single-role write.
 *
 * That column is the point of the file. better-auth does consult `Content-Type` — an earlier
 * draft of the fix assumed it did not, and the ORACLE group below is what caught that.
 *
 * **Its rule is NOT "starts with `application/json`".** That was a second wrong answer: an
 * inference from a fifteen-type sample, written down as though it had been measured, and
 * falsified by a spelling the sample did not contain. The rule is `better-call@1.3.7`'s
 * `getBody` (`dist/utils.mjs:4-55`) with `allowedMediaTypes: ["application/json"]`, in two
 * stages — the media type minus its parameters must **contain** `application/json`, and only
 * then is the body parsed as JSON, iff `/^application\/([a-z0-9.+-]*\+)?json/i` matches.
 * `organization-plugin-role-guard.ts`'s `betterAuthWillParseBody` mirrors exactly that.
 *
 * So `application/json-patch+json` and `application/JSON+foo` are parsed while
 * `application/vnd.api+json` and `text/json` are not; `application/x+jsonapplication/json`
 * is parsed and is the case the two rules disagree on; and `x-application/json` clears
 * stage 1 but fails stage 2, which is why it has its own outcome below. A guard matching only
 * the exact essence `application/json` would leave several of these bypassable.
 *
 * `value: null` means no `Content-Type` header at all.
 */
const MEDIA_TYPES: ReadonlyArray<{
  label: string;
  value: string | null;
  /**
   * What better-auth answers a legitimate single-role write under this media type.
   *
   * `200` — parsed and written. `415` — refused at better-call's media-type gate, body never
   * read. `400` — cleared the gate, failed the JSON regex, so better-call fell through to its
   * text branch and better-auth's own schema rejected a string where an object was required.
   */
  betterAuth: 200 | 400 | 415;
}> = [
  {
    label: "application/json (the canonical spelling)",
    value: "application/json",
    betterAuth: 200,
  },
  {
    label:
      "Application/JSON (THE BYPASS — same media type per RFC 9110 §8.3, and better-auth agrees)",
    value: "Application/JSON",
    betterAuth: 200,
  },
  {
    label: "APPLICATION/JSON (upper-case)",
    value: "APPLICATION/JSON",
    betterAuth: 200,
  },
  {
    label: "application/json; charset=utf-8 (a valid parameter)",
    value: "application/json; charset=utf-8",
    betterAuth: 200,
  },
  {
    label: "application/json ; charset=UTF-8 (whitespace around the parameter)",
    value: "application/json ; charset=UTF-8",
    betterAuth: 200,
  },
  {
    label: "application/json;charset=utf-8 (no space)",
    value: "application/json;charset=utf-8",
    betterAuth: 200,
  },
  {
    label: "application/json-patch+json (better-auth parses this too)",
    value: "application/json-patch+json",
    betterAuth: 200,
  },
  {
    label: "application/JSON+foo (better-auth parses this too)",
    value: "application/JSON+foo",
    betterAuth: 200,
  },
  // The four below were missing from the first draft's fifteen-type sample, and the third is
  // the spelling on which the superseded `startsWith` rule and better-auth's real two-stage
  // rule actually disagree.
  {
    label:
      "application/json. (trailing dot — clears the gate, matches the regex)",
    value: "application/json.",
    betterAuth: 200,
  },
  {
    label:
      "application/jsonx (a longer subtype that still starts application/json)",
    value: "application/jsonx",
    betterAuth: 200,
  },
  {
    label:
      "application/x+jsonapplication/json (the superseded startsWith rule said no; better-auth parses it)",
    value: "application/x+jsonapplication/json",
    betterAuth: 200,
  },
  {
    label:
      "x-application/json (clears better-call's gate, FAILS its JSON regex — the case stage 2 exists for)",
    value: "x-application/json",
    betterAuth: 400,
  },
  {
    label: "application/vnd.api+json (a +json type better-auth does NOT parse)",
    value: "application/vnd.api+json",
    betterAuth: 415,
  },
  {
    label: "text/json (not application/*)",
    value: "text/json",
    betterAuth: 415,
  },
  {
    label: "text/plain (not JSON at all)",
    value: "text/plain",
    betterAuth: 415,
  },
  {
    label: "application/x-www-form-urlencoded",
    value: "application/x-www-form-urlencoded",
    betterAuth: 415,
  },
  {
    label: "garbage (a malformed media type)",
    value: "garbage",
    betterAuth: 415,
  },
  { label: "an empty Content-Type", value: "", betterAuth: 415 },
  { label: "no Content-Type header at all", value: null, betterAuth: 415 },
];

beforeEach(async () => {
  await resetTestDatabase();
});

describe("#82 the role guard is not steerable by Content-Type", () => {
  for (const media of MEDIA_TYPES) {
    it(`refuses a multi-role write sent as ${media.label}, and the row keeps its single role`, async () => {
      const { app } = createApp();
      const { owner, workspace, target, memberId } = await scenario(app);

      const response = await updateMemberRoleViaPluginRaw(
        app,
        owner.cookie,
        JSON.stringify({
          organizationId: workspace.id,
          memberId,
          role: ["owner", "admin"],
        }),
        media.value,
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe("INVALID_ROLE_VALUE");

      // The value the guard exists to prevent, checked in the column rather than
      // inferred from the status code.
      const after = await getMemberRole(workspace.id, target.user.id);
      expect(after.role).toBe("viewer");
      expect(after.role).not.toContain(",");
    });

    it(`refuses the comma-joined STRING form sent as ${media.label} too`, async () => {
      const { app } = createApp();
      const { owner, workspace, target, memberId } = await scenario(app);

      // `crud-members.mjs:259` splits a STRING on comma as well, so the array-vs-string
      // distinction in the body schema buys nothing: both shapes land the same value.
      const response = await updateMemberRoleViaPluginRaw(
        app,
        owner.cookie,
        JSON.stringify({
          organizationId: workspace.id,
          memberId,
          role: "owner,admin",
        }),
        media.value,
      );

      expect(response.status).toBe(400);
      const after = await getMemberRole(workspace.id, target.user.id);
      expect(after.role).toBe("viewer");
    });
  }
});

describe("#82 a body whose shape cannot be established is refused, not waved through", () => {
  /**
   * **This is the group that pins `betterAuthWillParseBody`**, and it is worth saying why,
   * because an earlier comment credited the ORACLE group and an independent review showed
   * that was wrong.
   *
   * The ORACLE drives well-formed bodies. A guard with the right media-type rule and a guard
   * with a wrong one both accept those, so the ORACLE cannot tell them apart. A **malformed**
   * body can: where better-auth would have parsed it, this guard must refuse it itself
   * (`400 UNREADABLE_REQUEST_BODY`), and where better-auth would not, better-auth's own
   * `415` is the right answer and the guard must stay out of the way. Getting the media-type
   * rule wrong swaps those two, on exactly the spellings where the rules disagree — so the
   * probe is parametrised over the full table rather than spot-checked.
   */
  for (const media of MEDIA_TYPES) {
    const expected = media.betterAuth === 415 ? 415 : 400;
    // WHO must refuse is the discriminating question, not merely the status code. This
    // guard owes a refusal only where better-auth would have PARSED the body — that is the
    // fail-closed obligation. Where better-auth clears its media-type gate but does not
    // treat the body as JSON (`x-application/json`), better-call falls through to its text
    // branch and better-auth's own schema returns a 400 of its own; the guard has nothing
    // to add and must not pre-empt it. An earlier version of this probe asserted
    // `UNREADABLE_REQUEST_BODY` for every 400 and failed on exactly that case.
    const guardMustRefuse = media.betterAuth === 200;
    it(`refuses a malformed body sent as ${media.label} with ${expected}, from ${guardMustRefuse ? "the guard" : "better-auth"}`, async () => {
      const { app } = createApp();
      const { owner, workspace, target } = await scenario(app);

      const response = await updateMemberRoleViaPluginRaw(
        app,
        owner.cookie,
        '{"organizationId":"x","role":["owner"',
        media.value,
      );

      expect(response.status).toBe(expected);
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (guardMustRefuse) {
        expect(body.error).toBe("UNREADABLE_REQUEST_BODY");
      } else {
        // Refused, but not by this guard.
        expect(body.error).not.toBe("UNREADABLE_REQUEST_BODY");
      }

      const after = await getMemberRole(workspace.id, target.user.id);
      expect(after.role).toBe("viewer");
    });
  }

  const NON_OBJECT: ReadonlyArray<{ label: string; body: string }> = [
    {
      label: "a JSON array rather than an object",
      body: '[{"role":["owner","admin"]}]',
    },
    {
      label: "a bare JSON string rather than an object",
      body: '"owner,admin"',
    },
    { label: "JSON null rather than an object", body: "null" },
  ];

  for (const probe of NON_OBJECT) {
    it(`refuses ${probe.label}`, async () => {
      const { app } = createApp();
      const { owner, workspace, target } = await scenario(app);

      const response = await updateMemberRoleViaPluginRaw(
        app,
        owner.cookie,
        probe.body,
        "application/json",
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: string };
      expect(body.error).toBe("UNREADABLE_REQUEST_BODY");

      const after = await getMemberRole(workspace.id, target.user.id);
      expect(after.role).toBe("viewer");
    });
  }

  it("lets an empty body through to better-auth's own schema, because there is no role in it", async () => {
    const { app } = createApp();
    const { owner } = await scenario(app);

    const response = await updateMemberRoleViaPluginRaw(
      app,
      owner.cookie,
      "",
      "application/json",
    );

    // Whatever better-auth answers, it must not be this guard's refusal: an absent body
    // carries no role, so failing closed on it would break every bodiless route for no
    // security gain.
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    expect(body.error).not.toBe("UNREADABLE_REQUEST_BODY");
  });
});

describe("#82 THE ORACLE — the guard admits everything better-auth admits, and nothing is silently broken", () => {
  for (const media of MEDIA_TYPES) {
    it(`a legitimate single-role write sent as ${media.label} gets better-auth's own ${media.betterAuth}`, async () => {
      const { app } = createApp();
      const { owner, workspace, target, memberId } = await scenario(app);

      const response = await updateMemberRoleViaPluginRaw(
        app,
        owner.cookie,
        JSON.stringify({
          organizationId: workspace.id,
          memberId,
          role: "admin",
        }),
        media.value,
      );

      // This group's job is to catch a guard that refuses more than it should — one that
      // failed closed on everything, or turned better-auth's 415s into its own 400s. It
      // CANNOT catch a wrong media-type rule: a well-formed body is accepted under either.
      // The UNREADABLE group above is what does that.
      expect(response.status).toBe(media.betterAuth);

      const after = await getMemberRole(workspace.id, target.user.id);
      expect(after.role).toBe(media.betterAuth === 200 ? "admin" : "viewer");
    });
  }
});

describe("#82 NB-1 — the read half cannot be steered by a query parameter the handler ignores", () => {
  /**
   * The escalation this pins, before it was closed:
   *
   * half 2 resolved the target organization as body → **query** → session-active and took the
   * first hit. better-auth's `update-member-role` resolves
   * `ctx.body.organizationId || session.session.activeOrganizationId` and never reads the
   * query (`crud-members.mjs:256`). So a body omitting `organizationId`, plus
   * `?organizationId=<any id>`, pointed the guard at an organization the caller holds no row
   * in — `no-membership`, which half 2 deliberately does not refuse — while better-auth acted
   * on the caller's session-active organization, whose row was the malformed one.
   *
   * Measured before the fix: the control returned 409, the steered request returned **200 and
   * the write landed.** The guard now checks every candidate and refuses if any is malformed.
   */
  it("refuses when the SESSION-ACTIVE membership is malformed, even though a query parameter names an unrelated workspace", async () => {
    const { app } = createApp();
    const { owner, workspace, target, memberId } = await scenario(app);

    // The actor's own row in the workspace better-auth will act on is the malformed one.
    await plantLegacyMembershipRole(workspace.id, owner.user.id, "owner,admin");

    const response = await updateMemberRoleViaPluginRaw(
      app,
      owner.cookie,
      // No `organizationId` in the body, so better-auth falls back to session-active.
      JSON.stringify({ memberId, role: "admin" }),
      "application/json",
      // A workspace the caller has no membership row in at all.
      "?organizationId=steered-at-an-unrelated-workspace",
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBe("MALFORMED_MEMBERSHIP_ROLE");

    // The oracle for this probe: the write must not have landed.
    const after = await getMemberRole(workspace.id, target.user.id);
    expect(after.role).toBe("viewer");
  });

  it("still refuses without the query parameter — the control the steered request was compared against", async () => {
    const { app } = createApp();
    const { owner, workspace, target, memberId } = await scenario(app);

    await plantLegacyMembershipRole(workspace.id, owner.user.id, "owner,admin");

    const response = await updateMemberRoleViaPluginRaw(
      app,
      owner.cookie,
      JSON.stringify({ memberId, role: "admin" }),
      "application/json",
    );

    expect(response.status).toBe(409);
    const after = await getMemberRole(workspace.id, target.user.id);
    expect(after.role).toBe("viewer");
  });

  it("a malformed role in a workspace named ONLY by the query is refused too, so neither source is trusted over the other", async () => {
    const { app } = createApp();
    const { owner, workspace, target, memberId } = await scenario(app);

    // A second workspace the caller owns, malformed there, named only in the query. The
    // query-reading plugin routes (`list-invitations`, `list-roles`, `get-role`, …) would act
    // on this one, so a guard that only looked at the body would miss it.
    const secondCreated = await createWorkspaceViaPlugin(app, owner.cookie);
    const second = (await secondCreated.json()) as { id: string };
    await plantLegacyMembershipRole(second.id, owner.user.id, "owner,admin");

    const response = await updateMemberRoleViaPluginRaw(
      app,
      owner.cookie,
      JSON.stringify({ organizationId: workspace.id, memberId, role: "admin" }),
      "application/json",
      `?organizationId=${second.id}`,
    );

    expect(response.status).toBe(409);
    const after = await getMemberRole(workspace.id, target.user.id);
    expect(after.role).toBe("viewer");
  });
});
