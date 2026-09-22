# Security review — #23 work-item create/read/list (first slice)

**Reviewed head:** `b53bebadf32a4f82ff7900f63caa12524c4cfde2`

**Branch:** `feat/23-work-item-create-read-list`
**Pull request:** #261
**Merge base with `main`:** `b6d93bd` (`docs(status): reconcile after #259 merged`)
**Reviewer tier:** Opus, fresh independent context — did not author, orchestrate, remediate or
previously review this change. Two Sonnet rounds preceded this one (ordinary review: APPROVE;
project-alignment check: ALIGNED). Every conclusion below was re-derived from source and, where
it mattered, proven by running it; nothing was inherited from those rounds.
**Date:** 2026-09-22
**Scope of the mandate:** the new authority surface this slice introduces — a brand-new
resource's first write path, with concurrency handling on a shared counter column and a custom
auth-adjacent middleware that is deliberately *not* the shared one. Surfaces read in full:
`apps/api/src/work-item/**`, `apps/api/src/policy-registry.ts`,
`apps/api/src/index.ts` (mount + guard ordering), and every shared dependency they reach
(`utils/workspace-access-middleware.ts`, `utils/require-workspace-capability.ts`,
`utils/validate-workspace-access.ts`, `database/schema.ts`'s `work_item` /
`work_item_key_claim` / `project` definitions, `task/controllers/claim-task-numbers.ts`).

---

## Verdict

**CHANGES NEEDED (blocking).**

The authorization logic in this slice is, on its own terms, correct — I tried hard to break the
tenant boundary through the four routes' own code and could not. Workspace derivation is
genuinely authoritative, mass assignment is structurally impossible, and the custom middleware
has no analogue of #256's caller-supplied-`workspaceId` fallback. Sections 1–5 record that
positively.

But the slice ships a **reachable, permanent, cross-tenant denial of service** (F1). It is not
a theoretical race or a hardening gap: an ordinary `member` of any workspace can permanently
prevent any other tenant's project from ever creating a work item again, with no recovery path
short of database surgery or renaming the victim's project. I reproduced it end-to-end through
the real HTTP routes. It is blocking.

A second finding (F2) makes this slice the first resource in the codebase addressable by a
**guessable** identifier, and its out-of-reach response contradicts the permission-matrix
fixture this very PR generated. I treat that as blocking too, on a narrower ground: the project's
own gate machinery exists to stop the declared answer and the runtime answer from disagreeing,
and here they do, in a file this PR fully owns.

| # | Finding | Severity | Blocking |
| --- | --- | --- | --- |
| F1 | Cross-tenant permanent DoS: `work_item.key` is globally unique, but `project.slug` is not | High | **Yes** |
| F2 | `GET /api/work-items/{key}` returns 403 out-of-reach where the generated matrix says 404 — a cross-tenant existence/enumeration oracle on a guessable key | Medium | **Yes** |
| F3 | `description` is unbounded opaque JSON written straight to `jsonb` | Low | No |
| F4 | Forward-looking: the flagged `last_work_item_number` follow-up would be a regression if built as a *separate* counter | — | No (decision note) |
| F5 | PR body understates its own test result (claims 612/613; actual is 613/613) | — | No |

---

## F1 — Cross-tenant permanent denial of service on work-item creation

**Blocking. Reproduced live against the reviewed head.**

### The mechanism

`create-work-item.ts` builds the key as:

```ts
const number = await claimWorkItemNumber(project.id, tx);
const key = `${project.slug}-${number}`;
```

`work_item.key` carries a **global** unique index (`work_item_key_unique`, `schema.ts`) *and* a
permanent claim registry (`work_item_key_claim`, whose `key` is the PRIMARY KEY and whose claims
are, by design, "never released and never reassigned … for the life of the system").

The `key` column's own comment in `schema.ts` justifies that global index like this:

> `project.key` is already unique per instance and `number` is unique per project, so `key`
> composes to a globally unique value

**That premise is false for the column this code actually uses.** There is no `project.key`. The
live column is `project.slug`, and it is:

- `slug: text("slug").notNull()` — **no unique constraint of any kind**, not global, not per
  workspace (`schema.ts:312`, and `project`'s extra config at `schema.ts:330-336` adds only
  `unique(workspace_id, id)` and a position index);
- **caller-supplied and unvalidated** — `createProjectBody.slug` is a bare `z.string()`
  (`project/schema.ts:18`), passed straight through `createProject` to the insert with no
  normalisation, no uniqueness check and no format constraint;
- **mutable** — `updateProjectBody.slug` is likewise a bare `z.string()`
  (`project/schema.ts:24`), so a slug can also be *changed into* a colliding value later.

So two projects in different workspaces can trivially share a slug, and their work-item keys
then collide in a global namespace. This slice is the first and only code that writes
`work_item`, so this is where the defect becomes reachable.

### The exploit, as run

Reproduced through the real routes (`app.request`, real auth, real database), reviewed head:

1. Attacker is an ordinary `member` of their **own** workspace B. They create a project with
   `slug: "ACME"`. Nothing forbids this — the slug is theirs to choose.
2. Attacker `POST /api/projects/{their project}/work-items` once → **200**, key `ACME-1`.
   `work_item_key_claim` now holds `"ACME-1"`, permanently.
3. Victim, in an entirely unrelated workspace A, owns a project also slugged `ACME`. They
   `POST` their **first** work item → **500 Internal Server Error**.
4. `project.last_task_number` for the victim's project reads **0** afterwards — the claim was
   rolled back with the failed transaction.
5. Victim retries → **500** again. Counter still **0**. `work_item` rows for the victim's
   project: **0**.

The rollback is what makes this permanent rather than transient. The number is claimed inside
the same transaction as the insert (correctly — see §2), so when the unique violation aborts the
transaction the counter is restored, and the very next attempt recomputes the *same* colliding
key. The victim's project can never create a work item again.

### It also works against a project that already has items

The naive objection is "the attacker's own creates would collide first, so they can only win the
race from zero." They can't be stopped that cheaply: `project.last_task_number` is the **same
column** `claimTaskNumbers` bumps for ordinary task creation
(`task/controllers/claim-task-numbers.ts`, reached from `create-task.ts`, `import-tasks.ts`,
`move-task.ts`). An attacker advances their own project's counter to any value by creating
tasks — `import-tasks` claims numbers in bulk — and then spends exactly one work-item create to
burn the specific key they want.

Reproduced, same head: victim project holds `ACME-1..ACME-3`; attacker advances their own
counter to 3 and creates one work item → **200, key `ACME-4`**. Victim's next create → **500**,
counter stuck at 3. The attacker chose the key.

### Why this is serious

- **Privilege required: none beyond an ordinary workspace member of one's own workspace.** No
  access to the victim's tenant at any point. On a self-hosted single-tenant instance the
  blast radius is one customer's own projects; on the multi-tenant deployment the P4 target
  describes, it is cross-customer.
- **Targets are guessable.** Slugs are short human-chosen strings — `ACME`, `SUP`, `OPS`,
  `ENG`, `WEB`. An attacker does not need to know the victim's slug; they can create many
  projects across a dictionary of plausible slugs and pre-burn `1..N` in each, poisoning
  tenants that do not exist yet.
- **No recovery path in the product.** Keys are never un-claimed by design. The victim must
  rename the project (changing every existing item's displayed identifier) or have an operator
  delete rows from `work_item_key_claim` by hand — which the table's own comment says must
  never happen.
- **The failure is a bare 500.** `create-work-item.ts` has no handling for a constraint
  violation, so the caller sees `{"message":"Internal Server Error"}` with nothing actionable,
  and (per `app.onError`) nothing is logged for a non-`HTTPException` either.

### What would close it

This is a design decision, not a one-line patch, and it is Thomas's call which way to go. The
options I can see, cheapest first:

1. **Make the key's uniqueness scope match the slug's.** Drop the global
   `work_item_key_unique` in favour of a per-workspace unique index and key
   `work_item_key_claim` on `(workspace_id, key)`. Cheapest at the write path, but it breaks
   the global-namespace assumption `work_item_key_alias` was explicitly designed around
   (#191 O2) — that design would need re-deriving, so it is not as cheap as it looks.
2. **Make `project.slug` genuinely unique per instance**, matching what `schema.ts` already
   claims it is: a unique index plus validation and a clean 409 on both create and update.
   This makes the existing comment true rather than working around it. It is a migration on a
   shared table and it can fail on existing data, so it needs its own slice.
3. **Retry on collision inside the create path** — re-claim and re-derive on
   `unique_violation`. This does **not** close F1: the collision is deterministic, not racy, so
   a retry loop re-collides forever and converts a permanent 500 into a permanent timeout. I
   mention it only to rule it out, because it is the obvious-looking fix.

My own reading is that **option 2 is the honest one** — every other part of this system already
behaves as though slugs are unique per instance, including the schema comment that justifies the
index at the heart of this bug — but that it belongs in its own PR, not bolted onto this slice.
Whichever way it goes, this slice should not merge as the first reachable write path while the
collision is live.

---

## F2 — Out-of-reach reads return 403 where the matrix this PR generated says 404

**Blocking, on the narrower ground that a declared answer and the runtime answer disagree.**

`require-work-item-reach.ts` resolves the row by key, then calls `validateWorkspaceAccess`,
which throws **403** for a non-member. So:

| Request | Response |
| --- | --- |
| `GET /api/work-items/SECRETPROJ-1` — exists, in a workspace the caller cannot see | **403** `You don't have access to this workspace` |
| `GET /api/work-items/SECRETPROJ-2` — does not exist anywhere | **404** `Work item not found` |

Both reproduced live at the reviewed head.

Two things are wrong with that pair.

**First, it contradicts this PR's own generated fixture.** `tests/permissions/matrix.fixture.json`,
regenerated on this branch, records `"outOfReach": "404 not_found"` for every role on
`GET /api/work-items/{key}` and on `GET /api/projects/{projectId}/work-items`. The runtime
returns 403. This is precisely the failure mode
`utils/require-workspace-capability.ts`'s own doc comment says the capability machinery exists to
prevent — "three different answers to who may transfer ownership … so the three answers can never
disagree again." Here the declared answer and the live answer disagree on a route this PR
created from scratch. `pnpm test:permissions` passes 80/80 because the fixture is generated from
the policy declaration and compared against itself; nothing compares either to the running route.

**Second, this is the first resource in the codebase whose identifier is guessable.** The
existing 403-vs-400/404 shape on `workspaceAccess.*`-gated routes is materially harmless because
every id it addresses is a cuid2 — #8's own Opus review (`8-route-authorization-classification.md`,
"No enumeration primitive") leaned on exactly that: "Neither is sequential, neither is derived
from a user id, and neither route offers a listing." `work_item.key` breaks that property:
`{slug}-{integer}`, low-entropy slug plus a small counter. An attacker can enumerate, across the
whole instance and without touching any tenant they belong to:

- which project slugs exist anywhere (403 on `SLUG-1` means some tenant uses that slug);
- roughly how many work items each such project holds (walk `SLUG-n` until 404).

That is a genuine cross-tenant information leak, not merely an untidy status code, and it is the
same primitive that makes F1's targeting cheap.

`rbac.md`'s stated target design is 404-for-out-of-reach, and this file's own comment already
acknowledges the gap ("there is no 404-for-out-of-reach path live anywhere in this codebase
today, despite `rbac.md`'s stated target design"). I do not think that acknowledgement covers
this case: the general gap is inherited, but this route is new, it owns its own middleware, the
identifier is newly guessable, and the fixture on this branch already asserts the correct
behaviour.

**What would close it:** in `require-work-item-reach.ts`, catch the 403 from
`validateWorkspaceAccess` and re-throw as `404 Work item not found`, so a caller cannot
distinguish "not yours" from "not there". Roughly:

```ts
try {
  await validateWorkspaceAccess(userId, workItem.workspaceId, apiKey?.id);
} catch (error) {
  if (error instanceof HTTPException && error.status === 403) {
    throw new HTTPException(404, { message: "Work item not found" });
  }
  throw error;
}
```

That is contained entirely within a file this slice owns, needs no change to the shared
middleware, and makes the runtime agree with the fixture. It leaves
`GET /api/projects/{projectId}/work-items` still returning 403 out-of-reach via the shared
`workspaceAccess.fromProject` — also a fixture mismatch, but one on an unguessable cuid2 and in
shared code this slice correctly declined to edit; I would track that separately rather than
widen this slice.

---

## F3 — `description` is unbounded

Non-blocking.

`createWorkItemBody.description` is `z.unknown().optional()` and is written straight into the
`jsonb` column. `title` is properly bounded (`z.string().min(1).max(500)` — verified: 501
characters returns 400), but `description` has no bound at any layer, and I found no body-size
limit middleware on the API. A 5 MB description was accepted with **200** at the reviewed head.

Any authenticated member can therefore amplify storage at will. The treatment is consistent with
how `task` descriptions are handled today, so this is not a regression — but `work_item` is the
table intended to carry the product's real volume, and a bound is cheaper to add now than to
retrofit. A depth/size cap on the Tiptap document, or a global body limit, would do.

---

## F4 — The `last_work_item_number` follow-up, as flagged, would be a regression

Decision note, not a defect. The PR body flags the `last_task_number` reuse as "a judgment call
… needs an explicit decision before the next slice: either rename the column … or update
`data-model.md` to match reality."

Having traced it: **reusing the shared counter is the correct behaviour, and the PR undersells
its own choice.** Tasks are displayed to users as `{project.slug}-{task.number}` throughout the
web app (`kanban-board/task-card.tsx`, `task-details-sheet.tsx`, `list-view/index.tsx`,
`backlog-list-view/*`, and `task-properties-sidebar.tsx`'s literal `"{slug}-{number}"` branch
pattern) — the *same* human-facing identifier format as `work_item.key`. They live in different
tables with separate constraints, so nothing at the database level would stop a task and a work
item in one project from both displaying as `ACME-7`. The shared counter is the only thing
preventing that today.

So if the follow-up is taken as "rename the column to `last_work_item_number`" **and** work items
get their own independent counter, duplicate user-visible identifiers inside a single project
become possible from day one. The safe version of that follow-up is a pure rename of the one
shared counter (both tables keep drawing from it), or it waits until `task` is gone. Worth
saying explicitly in the decision log before the next slice, since the PR body's framing invites
the unsafe reading.

---

## F5 — The PR body understates its own result

The body reports integration as "612/613 (the one failure, `health.test.ts`'s readiness probe …
a pre-existing environment artifact)". At the reviewed head, on a private `*_test` database,
I measured **613/613 passed, 67/67 files** — the `health.test.ts` failure did not reproduce. No
action needed beyond not carrying the claim forward.

---

## 1. Cross-tenant leakage through the routes' own code — clear

Traced byte-for-byte against the #256 pattern (eight `workspaceAccess.*` helpers falling back to
a caller-supplied `?workspaceId=` on a failed row lookup).

**`require-work-item-reach.ts` has no analogous fallback, narrower or otherwise.** Its entire
workspace derivation is:

```ts
const [workItem] = await db
  .select({ workspaceId: schema.workItemTable.workspaceId })
  .from(schema.workItemTable)
  .where(eq(schema.workItemTable.key, key))
  .limit(1);
if (!workItem) throw new HTTPException(404, ...);
await validateWorkspaceAccess(userId, workItem.workspaceId, apiKey?.id);
c.set("workspaceId", workItem.workspaceId);
```

There is exactly one source for `workspaceId`: the loaded row. No query parameter, no body key,
no path param, no `??` fallback, no `try`/`catch` that could turn a lookup failure into a
caller-controlled value. A missing row throws before `validateWorkspaceAccess` is reached, so
there is no "lookup returned null, fall back to what the caller said" path to exploit. This is
strictly *safer* than the shared `workspaceAccessMiddleware`, whose `lookup` source can still be
listed alongside a `{ type: "query" }` source (as `fromTask`, `fromLabel` and six others are).

**The two project-scoped routes use `workspaceAccess.fromProject("projectId")`, which is one of
the safe variants** — its `sources` array contains the lookup and nothing else
(`workspace-access-middleware.ts:298-301`), so it is not among the eight #256 named. The lookup
reads the id from `c.req.param(source.idKey) || idFromBody` — the same places the handler reads
it — never from the query string, per the comment already in that file. A database error during
the lookup throws 503 rather than returning null (the #6 fail-closed fix), so the fallback cannot
be induced that way either.

**`requireWorkspaceCapability` reads `c.get("workspaceId")` only** — the value the preceding
middleware set from the loaded row — and 403s if it is absent. No parameter or body override.

**Controllers re-derive rather than trust.** `getWorkItemByKey` re-loads the row and re-checks
`workItem.workspaceId !== workspaceId` before returning; `listWorkItems` filters on **both**
`projectId` and `workspaceId`; `createWorkItem` re-loads the project scoped by
`(id, workspaceId, deletedAt IS NULL)` and then inserts `project.workspaceId` / `project.id`
rather than anything from the request. Verified live: listing another tenant's project → 403;
creating in another tenant's project → 403; a cross-workspace `typeId` → 400
(`Work item type does not belong to the project's workspace`).

The one structural point worth recording: because `work_item.key` is globally unique
(§F1 notwithstanding), the unscoped `WHERE key = ?` lookups in the middleware and in
`get-work-item.ts` are sound *today* — they cannot return two rows. If F1 is closed by
**narrowing** the key's uniqueness to per-workspace (option 1), both of those queries become
ambiguous and must be re-scoped. Whoever takes F1 should read that as a coupled change, not an
independent one.

---

## 2. The atomic claim under adversarial conditions — clear

`claimWorkItemNumber` issues `UPDATE project SET last_task_number = last_task_number + 1
WHERE id = $1 RETURNING last_task_number`, inside the caller's transaction, and
`create-work-item.ts` performs the insert in that same transaction.

**Never reused (WI-2): holds.** The row-level lock the `UPDATE` takes is held to commit, so a
second concurrent claim on the same project blocks and then reads the post-commit value.
Numbers are handed out in commit order. No path decrements the column.

**Rollback after claim, before insert:** the claim is *undone*, not burned — it is the same
transaction. I confirmed this directly while reproducing F1: after the failed insert the
victim's `last_task_number` read 0, exactly its pre-attempt value. So no number is skipped, and
— crucially for WI-2 — no *committed* key is ever handed out twice, because a rolled-back claim
never produced a committed row to collide with.

**Two items with the same key under a failure/retry path:** I could not construct one. The
`(project_id, number)` unique index, the global `key` unique index, and the
`work_item_key_claim` primary key are three independent database-level arbiters, and the claim
trigger is `INSERT … ON CONFLICT ("key", work_item_id) DO NOTHING` — a conflict on `key` alone
against a *different* `work_item_id` still fails, which is the case that matters. The only way
two rows share a key is if two rows share `(slug, number)`, which within one project the counter
prevents and across projects is F1, not a concurrency defect.

**The 8-way concurrency test in the PR is genuine**, not an assertion dressed up as one: it
issues eight real concurrent `POST`s and checks the resulting `work_item` rows, not just the
HTTP responses. It passed here.

---

## 3. Policy declarations vs. actual scope enforcement — re-derived independently

Re-derived without reference to the PR's own reasoning:

| Route | Declared | What actually gates it | Right resource? |
| --- | --- | --- | --- |
| `POST /api/projects/{projectId}/work-items` | `work_item:create`, scope `project`, `scopeSource: "request"` | `workspaceAccess.fromProject("projectId")` → DB lookup of the **project's** workspace → `requireWorkspaceCapability("work_item:create")` against `workspace_member.role` | **Yes** — the project's own workspace, from a row, not the path |
| `GET /api/projects/{projectId}/work-items` | `work_item:read`, scope `project`, `scopeSource: "row"` | same pair | **Yes** |
| `GET /api/work-items/{key}` | `work_item:read`, scope `work_item`, `scopeSource: "row"` | `requireWorkItemReach()` → DB lookup of the **item's** workspace → same capability check | **Yes** — the workspace is absent from the URL and comes only from the loaded row |

`work_item:create` and `work_item:read` are real capabilities in
`packages/permissions/src/capabilities.ts` (`work_item:create` implies `work_item:read`), and
`work_item` is a real `Scope`. Neither is in `AUTHORITY_GRANTING`, so omitting `elevated` is
correct — creating or reading an item mints no authority.

The "declared target vocabulary vs. live mechanism" framing the two policy files carry is
accurate and matches the precedent in `workspace/policy.ts`: the declarative evaluator
(`resolveIdentity`/`can()`/`evaluatePolicy`) is genuinely not wired to any route, and
`requireWorkspaceCapability` genuinely evaluates the same canonical capability data the
declaration names. "Reach on the project" reducing to workspace membership is consistent with
every other project-scoped route today. I have no objection to any of that — **except** where
the declaration and the runtime produce different *outcomes*, which is F2.

---

## 4. Mass assignment and injection — clear

`createWorkItemBody` is a non-strict `z.object` over exactly four keys, so unknown keys are
stripped; the handler destructures those four explicitly; and `createWorkItem` builds
`.values()` field by field from server-derived values (`project.id`, `project.workspaceId`,
`type.id`, the claimed `number`, the computed `key`, `defaultState.id`) with no spread anywhere.

Verified empirically rather than by inspection alone — a create carrying
`id`, `workspaceId`, `projectId`, `key`, `number`, `stateId`, `customerVisibility`, `version`,
`deletedAt`, `assigneeId`, `position`, `parentId` and `createdAt` in the body, all pointed at
another tenant's values:

- `id` — server-generated cuid2, body value ignored
- `workspaceId` / `projectId` — the caller's own, from the loaded project
- `key` / `number` — `MINE-1` / `1`, from the counter
- `stateId` — the project's own default state
- `customerVisibility` — `private` (the column default)
- `version` — `1`; `assigneeId` — `null`; `position` — `0.0000000000`

The database row agrees with the response. No injection surface: every query is a parameterised
Drizzle builder call; the only raw SQL is `sql\`${projectTable.lastTaskNumber} + 1\``, which
interpolates a column reference, not user input.

---

## 5. The root-mount exception — clear

`api.route("/", workItem)` is registered at `index.ts:810`. The app-wide authentication guard —
`api.use("*", … authenticateApiRequest …)` — is at `index.ts:675`, **above** it. All three
work-item routes therefore sit inside the guard's scope, and none reproduces issue #8's H2
failure class (a route laundered above the guard into a green coverage check). The one route
deliberately moved *below* the guard by #259 (`GET /api/asset/{id}`) is unaffected.

No ambiguous match either. The two path shapes are `/api/projects/{projectId}/work-items`
(plural `projects`) and `/api/work-items/{key}`; the only neighbouring prefixes are `/project`
(singular), `/task`, `/workspace`, `/workflow-rule` and the rest, plus the literal `/asset/{id}`.
Nothing else is mounted at the API root and nothing registers a root-level wildcard parameter
route that could shadow either shape. The exception is narrow and, as documented, justified by
the spec naming two path shapes for one resource.

---

## 6. Verification re-run independently

All run at `b53beba` in a dedicated worktree (`/home/ubuntu/.agent-tmp/worktrees/…`), against a
private `*_test` database, not trusting the PR's reported numbers.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | **pass**, 8/8 projects |
| `pnpm test:permissions` | **pass**, 10 files, **80/80** |
| `pnpm test:integration` (`TASKDESK_DATABASE_URL=…/opusrev23_test`) | **pass**, 67 files, **613/613** — see F5 |

The three proof-of-concept test files used for F1, F2 and §4 were run from the same worktree and
are deliberately **not** committed: they exist to demonstrate defects, and the right home for
the F1/F2 cases is a regression test alongside whatever fix lands. Their substance is reproduced
in full in F1 and F2 above so they can be rebuilt exactly.

---

## What I did not do

- I did not review the parts of `#23` this slice defers (update, delete, bulk, ranking,
  hierarchy, watchers, pagination, WI-4's "leaveable" check). The WI-4 TODO is correctly
  flagged in code rather than guessed at; there is genuinely no workflow table to query.
- I did not attempt a fix for F1 or F2 — a reviewer that remediates cannot also clear the
  remediation, and F1's resolution is a design choice that is Thomas's to make.
- I did not re-audit the shared `workspace-access-middleware.ts` beyond the paths this slice
  reaches. The seven other `workspaceAccess.*` helpers that pair a lookup with a
  `?workspaceId=` query source were out of scope here and are #256's business.
- I did not assess `work_item_key_alias` behaviour under F1's collision scenario. It has no
  live write path yet, so nothing exercises it — but whoever closes F1 should check that the
  alias namespace's assumptions survive whichever option is chosen.
- I did not evaluate the UI, deployment or Docker image: this branch touches no `apps/web/**`
  file and nothing that ships in the image beyond the API source.

---

## Post-review: F1/F2 fixes implemented, then main-sync — orchestrating session, 2026-09-22

**F1 and F2 fixes** (commits `d985970`, `1f32b8c`) implement exactly option 2 for F1 (make
`project.slug` globally unique — Thomas's own decision, recorded in the decision log) and
the 403→404 remap this review's own F2 section called for, contained to
`require-work-item-reach.ts`. Both independently re-reviewed (fresh ordinary Sonnet:
APPROVE WITH NOTES; fresh alignment check: ALIGNED WITH NOTES — one pre-existing,
non-blocking `data-model.md` doc-drift note filed as #264) before this addendum. Neither
review round found a defect in the fix itself.

**Main sync, self-verified**: `main` had advanced twice since this branch's last commit —
PR #262 (`compose.yml`'s `PGDATA` fix, issue #11) and PR #263 (the decision-log entry these
two fix commits already cited by name before it existed anywhere in this branch's own
history). Merged via `git merge` (not rebase); `git diff --stat` confirms zero overlap with
anything this review examined (`compose.yml` is deployment-only, `decision-log.md` is
docs-only). Separately, the merge surfaced a real `contract - OpenAPI drift` failure — not
from the sync itself, but from F1's own new `409` response on project create/update never
having been propagated to the committed fixture. Regenerated via `pnpm openapi:write`;
diffed and confirmed exactly two new `409` entries (create/update project), no route added
or removed, nothing else touched. Re-ran the full suite on the final synced head: `pnpm
typecheck` (8/8), `pnpm test:permissions` (80/80), `pnpm biome check .` (70 pre-existing
warnings, 0 errors, unchanged baseline), `pnpm test:integration` (615-616/616 depending on
run — the sole intermittent failure is `health.test.ts`'s readiness probe, independently
confirmed earlier this session to reproduce identically on plain `main` with no branch
changes involved, a pre-existing environment artifact, not a regression).

**Reviewed head:** `9889916` (on branch `feat/23-work-item-create-read-list`)

**F1/F2 now genuinely ready for the mandatory Opus delta-confirmation this review's own
verdict requires before merge.**
