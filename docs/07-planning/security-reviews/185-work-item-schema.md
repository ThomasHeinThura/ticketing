# Pre-merge security review — PR #185 (issue #23's first work-item schema slice: `work_item`, `work_item_type`, `state_template`, `state`, `work_item_key_alias`, `watcher`)

**Reviewed head:** `1ace881e501e6408bb259e9ead600f636fd5ac06`

**Status: CLEARED.** Both required ordinary reviews (PASS) and the mandatory Opus review
(CLEAR WITH FINDINGS, non-blocking) are recorded at this head. No gate is waived.

## What this PR adds

Six new tables — exactly what `data-model.md` §3/§4 specify for #23's first slice per the
2026-09-17 decision-log scoping entry — as purely additive schema with no route, no
controller, no policy-registry entry, no permission wiring. Zero existing table (kaneo's
`taskTable`/`columnTable` included) and zero existing route touched — deliberately, so the
old task/column surface keeps working unchanged while this schema exists alongside it,
unused, until a later PR builds real routes against it. `apps/api/src/database/**` and
`apps/api/drizzle/*.sql` are both on `docs/04-engineering/ci-cd.md`'s security-review-scope
path list, which is why the mandatory Opus pass applies even though nothing here is reachable
by any request yet.

## Round 1 — ordinary review: schema/migration fidelity against `data-model.md` §3/§4 (Sonnet)

**PASS.** Column-by-column match confirmed for all six tables against the spec text directly;
every FK/`onDelete` choice checked against the spec's stated invariants and the PR #179
precedent; `drizzle-kit check` reported no drift; every claimed test/typecheck count
reproduced exactly (typecheck clean, unit 320/47 unchanged, integration 433/50 = 410+23).
Two non-blocking notes, neither withheld PASS: unconstrained free-text "enum" columns mirror
a pre-existing, repo-wide pattern (not a new deviation); the PR body's own justification for
`work_item.key`'s global unique index cites a `project.key` column that doesn't actually
exist on the live `project` table yet (the conclusion is still correct, the cited premise
just isn't live yet — tracked in issue #189).

## Round 2 — ordinary review: scope discipline, test genuineness, verification quality (Sonnet)

**PASS.** Confirmed via full-diff `git diff --stat`: exactly 7 files changed, all additive,
zero touches to `task`/`column` source or the 16 existing related test files. Read all 23 new
tests and confirmed each is genuinely adversarial (forbidden-op-fails paired with
permitted-op-succeeds, real Postgres inserts/deletes, not tautological). Independently
reproduced the PR's `docker build .` + container-boot + health-check claim end to end.
Independently re-ran `check:vocabulary`/`check:openapi` and the full test suite, all counts
matched exactly. Checked the PR body against the mechanical `check-pr-template.mjs` checker
directly and found no format bug of the class that has broken this checker before.

## Round 3 — mandatory Opus security review

**Verdict: CLEAR WITH FINDINGS (non-blocking).** Method: applied migrations 0000-0054 to a
real isolated PostgreSQL 18 and ran 25 SQL probes rather than reasoning about the schema.
Explicitly checked for and ruled out a repeat of PR #179's own two real findings (the S1
identity-uniqueness bug and the S2 cascade/restrict deadlock) — neither reproduces here.

**Nine findings, none blocking THIS PR** (it adds no route/write-path — nothing reads or
writes these columns yet), **but four (S1, S2, S5, S8) are flagged as needing to close before
any PR that gives work items an actual write path**:

| Finding | What | Disposition |
| --- | --- | --- |
| S1 | `work_item.customer_visibility` nullable, no default, free text — a naive "hide private" filter fails **open** on NULL/garbage | Issue [#186](https://github.com/ThomasHeinThura/ticketing/issues/186) |
| S2 | Nothing ties `state_id`/`type_id`/`parent_id` to the item's own project/workspace — cross-project state, cross-workspace type, cross-project parent all accepted | Issue [#186](https://github.com/ThomasHeinThura/ticketing/issues/186) |
| S3 | `parent_id` self-reference and multi-item cycles accepted by a plain `UPDATE` — no DB-level guard | Issue [#188](https://github.com/ThomasHeinThura/ticketing/issues/188) |
| S4 | Six columns reference tables that don't exist yet (P2/P5 scope) — correctly left as plain nullable columns for now, needs a reminder once each lands | Issue [#189](https://github.com/ThomasHeinThura/ticketing/issues/189) |
| S5 | `work_item_key_alias.old_key` and `work_item.key` are independent namespaces — an alias can collide with a live key | Issue [#186](https://github.com/ThomasHeinThura/ticketing/issues/186) |
| S6 | A placeholder/inactive person can be assigned to a work item — same invariant gap #181 already tracks for `membership`, now confirmed to reach a second table | Folded into [#181](https://github.com/ThomasHeinThura/ticketing/issues/181) |
| S7 | Enum-like columns (`priority`, `state_template.group`, etc.) are unconstrained free text — `priority`'s ordering is explicitly load-bearing, making this a better candidate to fix than the average inherited gap | Issue [#189](https://github.com/ThomasHeinThura/ticketing/issues/189) |
| S8 | `work_item.project_id` CASCADE now makes the live `project` table's hard-delete route destructive — the live `project` table has no `deleted_at`/`purge_after` unlike its target spec, so the "CASCADE only fires on purge" reasoning that made PR #179's analogous FK acceptable does not hold here | Issue [#187](https://github.com/ThomasHeinThura/ticketing/issues/187) |
| S9 | Eight smaller items (duplicate default states, `NaN` position, unconstrained `key` format, `project.key` not existing yet, cross-org watcher, `timestamp` vs `timestamptz`) | Issue [#189](https://github.com/ThomasHeinThura/ticketing/issues/189) |

All four verified-correct claims from the implementer held up under independent SQL probing:
the multi-table CASCADE/RESTRICT interaction resolves correctly with no deadlock; nothing
reopens PR #179's `person.user_id` uniqueness fix (this PR's FKs reference `person.id`, an
unrelated column); `parent_id` RESTRICT is the right choice and not an operational dead-end
(purge just needs to walk bottom-up); the global unique index on `work_item.key` is the
correct inference from the spec's stated design, even though its literal justification cites
a column (`project.key`) that isn't live yet.

## What this note does not do

- It does not resolve S1-S9. Each has its own tracked issue (#186, #187, #188, #189) or is
  folded into an existing one (#181); fixing any of them here would exceed this PR's own
  stated scope (schema only, no write path).
- It does not merge this pull request, edit `## Gates`, or waive anything.

## Status of the gate

**Closed.** Both required ordinary reviews and the mandatory Opus review are recorded PASS /
CLEAR WITH FINDINGS at head `1ace881e501e6408bb259e9ead600f636fd5ac06`. No finding blocks
merge; S1/S2/S5/S8 are explicitly flagged as needing resolution before #23's (or whichever
issue's) actual write-path PR, not before this schema PR.
