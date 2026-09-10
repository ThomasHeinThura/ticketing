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
 * draft of the fix assumed it did not, and the ORACLE group below is what caught that. Its
 * rule, measured against the real mounted route rather than read out of a bundled dependency,
 * is: **lower-case the header and check it starts with `application/json`.** So
 * `application/json-patch+json` and `application/JSON+foo` are parsed, while
 * `application/vnd.api+json` and `text/json` are not — which matters, because a guard matching
 * only the exact essence `application/json` would leave the first pair bypassable.
 *
 * `value: null` means no `Content-Type` header at all.
 */
const MEDIA_TYPES: ReadonlyArray<{
  label: string;
  value: string | null;
  /** What better-auth answers a legitimate single-role write under this media type. */
  betterAuth: 200 | 415;
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
   * `expected` is what the caller must see. Where better-auth WOULD have parsed the body,
   * this guard has to refuse it itself — that is the fail-closed requirement. Where
   * better-auth would answer 415 and never parse, its own refusal is the right answer and
   * the guard has nothing to add; inventing a second one would change behaviour for
   * requests that were never a threat.
   */
  const UNREADABLE: ReadonlyArray<{
    label: string;
    body: string;
    contentType: string | null;
    expected: 400 | 415;
  }> = [
    {
      label: "malformed JSON while declaring application/json",
      body: '{"organizationId":"x","role":["owner"',
      contentType: "application/json",
      expected: 400,
    },
    {
      label: "malformed JSON while declaring Application/JSON",
      body: "{not json at all",
      contentType: "Application/JSON",
      expected: 400,
    },
    {
      label:
        "malformed JSON while declaring application/json-patch+json (which better-auth parses)",
      body: "{{{",
      contentType: "application/json-patch+json",
      expected: 400,
    },
    {
      label: "a JSON array rather than an object",
      body: '[{"role":["owner","admin"]}]',
      contentType: "application/json",
      expected: 400,
    },
    {
      label: "a bare JSON string rather than an object",
      body: '"owner,admin"',
      contentType: "application/json",
      expected: 400,
    },
    {
      label: "JSON null rather than an object",
      body: "null",
      contentType: "application/json",
      expected: 400,
    },
    {
      label:
        "malformed JSON with no Content-Type — better-auth's 415 already refuses it",
      body: "{not json at all",
      contentType: null,
      expected: 415,
    },
    {
      label:
        "malformed JSON declaring text/plain — better-auth's 415 already refuses it",
      body: "role=owner,admin",
      contentType: "text/plain",
      expected: 415,
    },
  ];

  for (const probe of UNREADABLE) {
    it(`refuses ${probe.label} with ${probe.expected}`, async () => {
      const { app } = createApp();
      const { owner, workspace, target } = await scenario(app);

      const response = await updateMemberRoleViaPluginRaw(
        app,
        owner.cookie,
        probe.body,
        probe.contentType,
      );

      expect(response.status).toBe(probe.expected);
      if (probe.expected === 400) {
        const body = (await response.json()) as { error?: string };
        expect(body.error).toBe("UNREADABLE_REQUEST_BODY");
      }

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

      // THIS is the assertion that makes every refusal above meaningful. A guard that
      // simply refused everything would satisfy the rest of this file; a guard that
      // turned better-auth's 415s into its own 400s would too. Both are wrong, and only
      // this group can tell.
      expect(response.status).toBe(media.betterAuth);

      const after = await getMemberRole(workspace.id, target.user.id);
      expect(after.role).toBe(media.betterAuth === 200 ? "admin" : "viewer");
    });
  }

  it("pins better-auth's rule itself: it parses exactly the media types that lower-case to a prefix of application/json", () => {
    // If a better-auth upgrade widens or narrows this, the loop above fails and
    // `betterAuthWillParseBody` in organization-plugin-role-guard.ts must be re-measured
    // rather than left to drift out of agreement with it.
    for (const media of MEDIA_TYPES) {
      const parses = (media.value ?? "")
        .trim()
        .toLowerCase()
        .startsWith("application/json");
      expect(parses).toBe(media.betterAuth === 200);
    }
  });
});
