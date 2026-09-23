-- Issue #8, Slice 2: shadow-mode evidence storage. Coordinator decision, 2026-09-23
-- (relayed on the issue; recorded in the decision log by the orchestrating session).
--
-- Two tables. `policy_shadow_tally` counts EVERY request the shadow middleware evaluates,
-- agreements included -- this is what gives the addendum's "coverage" requirement a real
-- answer ("a router with unevaluated requests is not clean"). `policy_shadow_event` carries
-- one attributable row per NON-agree outcome, capped per bucket so a noisy route cannot
-- grow this table unbounded before anyone notices and fixes it; the tally keeps counting
-- past the cap regardless.
--
-- Both tables are queried and written from `apps/api/src/permissions/shadow-store.ts`
-- (issue #8's own lane), never from `apps/api/src/database/schema.ts` -- these are
-- declared as a standalone Drizzle table pair in
-- `apps/api/src/permissions/shadow-schema.ts` so this migration lands without touching a
-- file #308's lane owns. `pnpm check:vocabulary` still requires both names to be declared
-- in `docs/01-architecture/data-model.md`, which this change also updates.
--
-- No FK to `workspace`/`user`/`project`: shadow evidence must keep counting and recording
-- through the exact conditions it exists to catch (a stale/foreign id, a row the caller
-- cannot reach), and a row of evidence about a workspace that gets deleted a moment later
-- must not itself become undeletable or trigger a cascade into product data. `workspace_id`
-- is therefore a plain, unconstrained text column -- an id for grep, not a join target.
--
-- Written as the app role; no dedicated maintenance role exists in this deployment
-- (decision log, 2026-09-23, "audit_log is append-only by trigger, not by grant"). Pruning
-- (30-day retention, both tables) is done by the writer itself, at most once per UTC day
-- per process -- see `shadow-store.ts`'s doc comment for why (no job runner exists yet:
-- `apps/api/src/jobs/` is absent, `docs/01-architecture/background-jobs.md`'s list has
-- nothing to add this to) and the note that this belongs on a real job the day one exists.

CREATE TABLE "policy_shadow_tally" (
	"id" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"route_key" text NOT NULL,
	"router_group" text NOT NULL,
	"outcome" text NOT NULL,
	"reason_code" text,
	"count" bigint DEFAULT 1 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_shadow_tally_outcome_check" CHECK ("policy_shadow_tally"."outcome" IN (
		'agree', 'legacy_allow_policy_deny', 'legacy_deny_policy_allow', 'unevaluated', 'evaluator_error'
	)),
	CONSTRAINT "policy_shadow_tally_count_positive" CHECK ("policy_shadow_tally"."count" > 0),
	-- NULLS NOT DISTINCT (PG15+; this deployment runs 18 in production and 16 in CI, both
	-- covered) so two rows for the same (day, route_key, outcome) with a NULL reason_code
	-- collide into the same upsert target instead of silently duplicating -- reason_code is
	-- NULL for the overwhelming majority of rows (every `agree` row, and any non-agree
	-- outcome whose comparison logic did not assign a specific reason), so leaving NULLs
	-- distinct here would defeat the unique constraint for exactly the common case.
	CONSTRAINT "policy_shadow_tally_bucket_unique" UNIQUE NULLS NOT DISTINCT (
		"day", "route_key", "outcome", "reason_code"
	)
);

CREATE INDEX "policy_shadow_tally_route_key_day_idx" ON "policy_shadow_tally" ("route_key", "day");

CREATE TABLE "policy_shadow_event" (
	"id" text PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"route_key" text NOT NULL,
	"router_group" text NOT NULL,
	"policy_kind" text,
	"policy_capability" text,
	"outcome" text NOT NULL,
	"reason_code" text,
	"legacy_allowed" boolean,
	"legacy_status" integer,
	"policy_allowed" boolean,
	"policy_status" integer,
	"policy_code" text,
	"diagnostic" text,
	"identity_kind" text,
	"workspace_id" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_shadow_event_outcome_check" CHECK ("policy_shadow_event"."outcome" IN (
		'legacy_allow_policy_deny', 'legacy_deny_policy_allow', 'unevaluated', 'evaluator_error'
	))
);

CREATE INDEX "policy_shadow_event_route_key_created_at_idx" ON "policy_shadow_event" ("route_key", "created_at" DESC);
CREATE INDEX "policy_shadow_event_bucket_idx" ON "policy_shadow_event" ("day", "route_key", "outcome", "reason_code");
