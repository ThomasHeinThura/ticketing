import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../../../apps/api/src/utils/is-unique-violation";

describe("isUniqueViolation", () => {
  it("finds the driver error Drizzle wrapped in `cause`", () => {
    // Drizzle rethrows a `Failed query: …` Error and hangs the pg error off
    // `cause`, so reading `error.code` alone silently never matches — which
    // is how a slug collision became a 500 instead of a 409.
    const wrapped = new Error('Failed query: insert into "workspace" …', {
      cause: Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "workspace_slug_unique",
      }),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "workspace_slug_unique")).toBe(true);
  });

  it("matches an unwrapped driver error too", () => {
    const direct = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "workspace_slug_unique",
    });
    expect(isUniqueViolation(direct, "workspace_slug_unique")).toBe(true);
  });

  it("does not match a different unique constraint when a name is given", () => {
    const other = new Error("Failed query", {
      cause: Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "session_token_unique",
      }),
    });
    expect(isUniqueViolation(other, "workspace_slug_unique")).toBe(false);
    expect(isUniqueViolation(other)).toBe(true);
  });

  it("does not match other failures", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(
      isUniqueViolation(
        new Error("fk", {
          cause: Object.assign(new Error("fk"), { code: "23503" }),
        }),
      ),
    ).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const loop = new Error("loop") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });

  // Issue #269, filed from #23's mandatory Opus review of PR #261 (finding E7):
  // `create-work-item.ts`'s defense-in-depth catch used to check
  // `isUniqueViolation(error, "key")`, a SUBSTRING match against the constraint
  // name. That happened to be correct only because every unique-violation reachable
  // there is `work_item_key_claim`'s PRIMARY KEY, `work_item_key_claim_pkey`
  // (confirmed live: migrated a fresh Postgres database through every migration in
  // `apps/api/drizzle/` and read `pg_constraint` directly, then reproduced the
  // trigger's own raised error and confirmed its `constraint` field with
  // `GET STACKED DIAGNOSTICS ... = CONSTRAINT_NAME`). A substring match is fragile
  // against a future rename or an unrelated new `*_key_something` constraint added
  // near that insert; these two tests pin the exact-match behavior so that fragility
  // cannot silently return.
  it("matches the real work_item_key_claim primary key by its exact name", () => {
    const error = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "work_item_key_claim_pkey",
    });
    expect(isUniqueViolation(error, "work_item_key_claim_pkey")).toBe(true);
  });

  it("does NOT match by substring — a broadened match must fail this test", () => {
    // Issue #269's exact scenario: a future, unrelated constraint added near this
    // code path whose name happens to CONTAIN the expected exact name. If
    // `isUniqueViolation` were ever changed back to `constraint.includes(name)`, this
    // would start passing again — the hypothetical future constraint's name is
    // deliberately built by wrapping the real, exact name so a substring test would
    // wrongly match it and an exact-equality test correctly does not.
    const unrelatedFutureConstraint = Object.assign(
      new Error("duplicate key"),
      {
        code: "23505",
        constraint: "legacy_work_item_key_claim_pkey_v2",
      },
    );
    expect(
      isUniqueViolation(unrelatedFutureConstraint, "work_item_key_claim_pkey"),
    ).toBe(false);

    // The historical form of the exact same bug: the OLD call site passed the bare
    // fragment `"key"`, not a full constraint name. Under `.includes()`, that fragment
    // matched the real `work_item_key_claim_pkey` constraint only by coincidence, and
    // would have matched `work_item_key_claim_key_work_item_id_unique` (the claim
    // table's OTHER, non-reachable unique constraint) too, had that path ever been
    // hit. Under exact matching, a bare fragment can never equal a real constraint
    // name, so it correctly never matches.
    const realPrimaryKeyConstraint = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "work_item_key_claim_pkey",
    });
    expect(isUniqueViolation(realPrimaryKeyConstraint, "key")).toBe(false);
  });

  it("matches against any of several exact constraint names", () => {
    // `create-project.ts`'s own insert can raise either `project`'s
    // `project_slug_unique` or `project_slug_claim`'s PRIMARY KEY
    // (`project_slug_claim_pkey`) — both confirmed live against the schema.
    const claimPkey = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "project_slug_claim_pkey",
    });
    expect(
      isUniqueViolation(claimPkey, [
        "project_slug_unique",
        "project_slug_claim_pkey",
      ]),
    ).toBe(true);
    expect(isUniqueViolation(claimPkey, ["project_slug_unique"])).toBe(false);
  });
});
