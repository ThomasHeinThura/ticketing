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

---

# Opus delta-confirmation review of the F1/F2 fixes — 2026-09-22

**Reviewed head:** `d5841ba4854f5d812c98e8abaaceed0ea3f38428` (confirmed via
`git ls-remote origin refs/heads/feat/23-work-item-create-read-list`, not from `gh pr view`'s
cached head field).
**Branch:** `feat/23-work-item-create-read-list` · **Pull request:** #261
**Fix commits under review:** `d985970` (F1), `1f32b8c` (F2), plus `9889916` (fixture regen)
and the `be7459b` main-sync.
**Reviewer tier:** Opus, fresh independent context — did not author, direct, remediate or
previously review this change or its fixes. Two Sonnet rounds preceded this one on the fixes
(ordinary: APPROVE WITH NOTES; alignment: ALIGNED WITH NOTES); nothing below is inherited
from them. Every conclusion was re-derived from source and, where it mattered, proven by
running it against a real database.
**Mandate:** close out the blocking F1/F2 findings at the tier this project's review gate
requires — adversarially, not by confirming the fixes do what their commit messages say.

---

## Verdict

**CHANGES NEEDED (blocking).**

F2 is genuinely closed on the route it targets, and the F1 migration's collision-repair logic
is correct — I tried hard to break it with a hostile dataset on a live database and could not.

But **F1 itself is not closed.** The fix makes `project.slug` unique among *live* projects.
`work_item_key_claim` is, by explicit design, a namespace that is **never released for the
life of the system**. Those two lifetimes do not match, and the gap between them is the whole
of F1. An attacker burns keys under a slug, then *gives the slug up* — by renaming their own
project, or by deleting their own workspace — and the slug becomes available again while the
claims stay burned forever. The next tenant to take that slug gets exactly the original F1:
a permanent, unrecoverable 500 on work-item create, with no product-level recovery path.

I reproduced this end-to-end through the real HTTP routes at the reviewed head, twice, by two
independent release paths. The second one leaves **no trace in any table an operator would
think to look at**.

| # | Finding | Severity | Blocking |
| --- | --- | --- | --- |
| D1 | F1 not closed: the slug namespace is transient, the key-claim namespace is permanent. Releasing a slug re-opens the original cross-tenant permanent DoS | High | **Yes** |
| D2 | Migration 0064's repair loop — adversarially stressed on a real database, **correct** | — | No (positive) |
| D3 | F2's `{key}` route — genuinely closed, three responses byte-identical. The other two work-item routes still answer 403 where this PR's own fixture declares 404 | Low | No |
| D4 | A credential revoked mid-request now reports `404 Work item not found` on this route only | — | No (note) |
| D5 | `work_item_key_alias` — survives the option chosen, but rests on the same seam D1 exposes | — | No (note) |

---

## D1 — F1 is not closed: a slug can still be released, a key claim never is

**Blocking. Reproduced live at `d5841ba`, twice, through the real routes.**

### The mechanism

The fix adds `project_slug_unique UNIQUE(slug)` on the `project` table. That constrains the
set of slugs held by rows **currently in `project`**. It says nothing about slugs that *used
to* be held.

`work_item_key_claim`, by contrast, is explicitly permanent — `schema.ts`'s own comment:

> `key` is the PRIMARY KEY: a string is claimed here EXACTLY ONCE, ever, for the life of the
> system. Claims are never released and never reassigned, even after the work item that
> claimed one is deleted.

So the generator of the key namespace (`project.slug`) is **revocable**, while the namespace
it generates into (`work_item_key_claim.key`) is **irrevocable**. A uniqueness constraint on
a revocable namespace cannot protect an irrevocable one. Every path that frees a slug hands
the next holder a pre-poisoned key range.

There are two such paths live today, and neither needs anything but ordinary use of one's own
tenant:

1. **`PUT /api/project/{id}`** — `update-project.ts` writes `slug` with no restriction. The
   new slug is checked for collisions; the *old* one is simply abandoned.
2. **`DELETE /api/workspace/{workspaceId}`** — `delete-workspace.ts` is a **hard** delete
   ("HARD delete, over the existing `ON DELETE CASCADE` chains off `workspace.id` — members,
   roles, teams, team members, projects, tasks and the rest"). Projects vanish, their slugs
   with them. `work_item_key_claim` has **no foreign key at all** to `work_item` — deliberately,
   so that claims survive exactly this — so every claim stays.

Note that soft-delete (`DELETE /api/project/{id}`) does *not* release a slug: the row stays,
`deleted_at` stamped, and the unconditional unique constraint still covers it. That path is
safe. It is the two above that are not.

### Reproduction 1 — release by rename

Real routes, real auth, real database, reviewed head:

| Step | Result |
| --- | --- |
| Attacker (admin of their **own** workspace) creates project slugged `ACME` | 200 |
| Attacker creates one work item | 200, key `ACME-1`; `work_item_key_claim` = `["ACME-1"]` |
| Attacker renames their own project's slug to `ACME-RETIRED` | **200** |
| Victim, unrelated workspace, creates a project slugged `ACME` | **200** — the 409 does not fire; the slug is free |
| Victim's **first** work item | **500** `{"message":"Internal Server Error"}` |
| Victim's `project.last_task_number` afterwards | **0** — rolled back with the transaction |
| Victim retries | **500** again. `work_item` rows for the victim's project: **0** |

Identical to the original F1, with one extra attacker step.

### Reproduction 2 — release by workspace deletion (no trace left)

This is the more serious of the two, because the attacker's artifacts are gone afterwards:

| Step | Result |
| --- | --- |
| Attacker creates project slugged `ENG`, creates 3 work items | 200; claims = `["ENG-1","ENG-2","ENG-3"]` |
| Attacker `DELETE /api/workspace/{their own}` | **200** |
| State afterwards | `project` rows: **0** · `work_item` rows: **0** · `work_item_key_claim`: **still `["ENG-1","ENG-2","ENG-3"]`** |
| Victim, later, creates a project slugged `ENG` | **200** |
| Victim's work items 1–4 | **500, 500, 500, 500** — broken from the very first one, counter stuck at 0 |

After the deletion there is no project row, no work item row and no workspace row anywhere
that explains the victim's 500. The only evidence is orphaned rows in a table no product
surface exposes. An operator debugging this has nothing to go on.

### Reproduction 3 — delayed detonation at an attacker-chosen number

The counter that feeds the key is `project.last_task_number`, shared with ordinary task
creation, so an attacker can burn one *specific* high key rather than a prefix run — then
release the slug. The victim's project then works normally for a while and dies later:

| Step | Result |
| --- | --- |
| Attacker creates project slugged `OPS`, then creates **4 ordinary tasks** via `POST /api/task/{projectId}` | 200; `last_task_number` = **4** |
| Attacker creates exactly **one** work item | 200, key **`OPS-5`** — only that one key burned |
| Attacker renames their project to `OPS-OLD` | 200 |
| Victim takes the freed slug `OPS` | 200 |
| Victim creates work items 1…7 | `OPS-1`, `OPS-2`, `OPS-3`, `OPS-4`, then **500, 500, 500** — permanently, from the attacker's chosen number onward |

The victim's project looks completely healthy through its first four items. It then breaks
forever at item five, at a point the attacker selected in advance, with no recovery path short
of renaming the project or hand-deleting rows from a table whose own comment says that must
never happen.

### Why the fix misses it

The fix is a faithful, well-built implementation of exactly what the decision log says
(migration + a clean 409 on both create and update, mirroring `WorkspaceSlugTakenError`). The
gap is not in its execution — it is that instance-wide uniqueness over *live* rows was taken
as equivalent to ownership of a *permanent* namespace, and it is not. Thomas's decision
("`project.slug` gets a real, instance-wide unique constraint", 2026-09-22) was made to close
this DoS; the decision stands, but as implemented it does not close it. This is a fresh
finding about the implementation's sufficiency, **not** a re-opening of the decided approach.

For the same reason, I am **not** raising the slug-squatting/409-oracle property as a finding:
that project-create answers 409 for a slug some other tenant holds, and 200 otherwise, is a
cross-tenant existence oracle — but it is the *explicitly accepted cost* recorded in the
decision itself ("`project.slug` becoming a single first-come-first-served namespace across
the whole instance rather than per-tenant"). Settled; noted here only so the next reader knows
it was considered and is not an oversight.

### What would close it

Not implemented here — a reviewer that remediates cannot also clear the remediation, and the
shape of this is a design call. The options I can see:

1. **Make slug retirement permanent, matching the namespace it feeds.** A `project_slug_claim`
   table keyed the way `work_item_key_claim` is, written on project create and on rename, and
   never released. A slug, once used anywhere, is never available to another tenant again.
   This is the direct completion of Thomas's own decision: it makes the slug namespace exactly
   as durable as the key namespace that depends on it, rather than one notch weaker. It also
   closes both release paths with one mechanism, including the hard-delete cascade, because
   the claim row has no FK to `project`.
2. **Handle the collision in `create-work-item.ts` instead of 500ing.** Catch the
   `unique_violation`, re-claim a *fresh* number and retry, so burned keys are skipped rather
   than fatal. The original review correctly ruled retry out for the *live-duplicate-slug*
   case (deterministic, so it re-collides forever); that objection does not apply once slugs
   are unique among live projects, because here the collision is against a finite set of
   retired keys and the counter walks past them. On its own this leaves an attacker able to
   burn a large range and make creates slow, so it is defence in depth, not the primary fix.
3. **Restrict slug mutation** once a project has ever created a work item, and make workspace
   deletion soft. Narrower, but it fights two legitimate product behaviours rather than fixing
   the namespace mismatch, and the hard-delete path is a documented P0 deliberate choice.

Whichever is chosen, `create-work-item.ts` returning a bare 500 with nothing logged (per
`app.onError`, a non-`HTTPException` logs nothing) should be fixed regardless — it is what
made all three reproductions above opaque from the outside.

---

## D2 — Migration 0064's collision repair, stressed adversarially: correct

**Not a finding. Recorded because the mandate asked for it to be attacked, and it held.**

The ordinary reviewer traced the repair loop by hand. I ran it, verbatim, against a
manufactured hostile dataset on a real Postgres (`migadv23_test` on `td-lane-pg`): the
constraint was dropped, 18 project rows inserted, and the migration's `DO $$ … $$` block plus
its `ALTER TABLE … ADD CONSTRAINT` replayed exactly as written.

The dataset was built to break the suffix search specifically:

- **five** duplicate groups, not one (`ACME`×3, `ACME-2`×2, `OPS`×2, `ENG`×4, `TIE`×2);
- **squatters already holding the "next" suffix** of another group (`ACME-2` and `ACME-3`
  pre-exist while the `ACME` group needs suffixes; `OPS-2` and `OPS-3` pre-exist while `OPS`
  needs one; `ENG-2` pre-exists while `ENG` needs three);
- a **squatter group that is itself a duplicate** (`ACME-2`×2) whose own repair must then skip
  a further pre-existing squatter (`ACME-2-2`);
- a **`created_at` tie** (`TIE`×2, identical timestamps) to exercise the `id ASC` tiebreak.

Result — zero duplicates remaining, `ALTER TABLE` succeeded, all 18 rows preserved:

| id | before | after | why |
| --- | --- | --- | --- |
| `a1` | `ACME` | `ACME` | oldest in group, keeps it |
| `a2` | `ACME` | `ACME-4` | skipped `ACME-2` and `ACME-3` squatters |
| `a3` | `ACME` | `ACME-5` | also skipped `a2`'s brand-new `ACME-4` |
| `s1` | `ACME-2` | `ACME-2` | oldest in its own group |
| `s2` | `ACME-2` | `ACME-2-3` | skipped the `ACME-2-2` squatter |
| `b2` | `OPS` | `OPS-4` | skipped `OPS-2`, `OPS-3` |
| `c2`/`c3`/`c4` | `ENG` | `ENG-3`/`ENG-4`/`ENG-5` | skipped `ENG-2`, then each other |
| `t1`/`t2` | `TIE` | `TIE`/`TIE-2` | tie broken deterministically on `id` |

The `EXIT WHEN NOT EXISTS` re-check genuinely prevents a fresh collision rather than merely
making one unlikely, and the reason is structural: the outer `FOR` loop reads from a fixed
snapshot (so each row's *base* slug stays its original one, and no row is processed twice),
while the inner `EXIT WHEN NOT EXISTS` is a fresh statement that **does** see every rename
committed earlier in the same transaction. Every candidate is therefore tested against live
state immediately before it is taken. `a3 → ACME-5` and `c3`/`c4` above are that property
firing in practice, not in theory.

Concurrency is fail-loud rather than silent: a project inserted by another session between the
`DO` block and the `ALTER` would make the `ADD CONSTRAINT` fail and roll the migration back.
That is the right failure mode.

---

## D3 — F2 on `GET /api/work-items/{key}`: closed. The other two routes still disagree with the fixture

**The `{key}` route is genuinely fixed.** Verified live at the reviewed head, as an outsider
with no relationship to the target workspace — all three responses are byte-identical, so
there is nothing left to distinguish:

| Request | Response |
| --- | --- |
| `SECRETPROJ-1` — exists, workspace the caller cannot see | `404 Work item not found` |
| `SECRETPROJ-99` — same (real) slug, no such item | `404 Work item not found` |
| `NOSUCHSLUG-1` — slug that exists nowhere | `404 Work item not found` |

The enumeration primitive F2 described — walk `SLUG-n`, learn which slugs exist and roughly
how many items each holds — is gone from this route. The remap is correctly scoped: it catches
only `HTTPException` with status 403 from `validateWorkspaceAccess` and rethrows everything
else unchanged, and it touches no shared middleware.

**Non-blocking finding:** `tests/permissions/matrix.fixture.json` declares
`"outOfReach": "404 not_found"` for **all three** work-item routes, but the two project-scoped
ones still answer 403 live:

| Route | Fixture declares | Runtime answers |
| --- | --- | --- |
| `GET /api/work-items/{key}` | 404 | **404** ✓ |
| `GET /api/projects/{projectId}/work-items` | 404 | **403** ✗ |
| `POST /api/projects/{projectId}/work-items` | 404 | **403** ✗ |

F2's stated blocking ground was that "the declared answer and the runtime answer disagree, in
a file this PR fully owns." That disagreement is now closed for one of three routes and still
open for two. I am **not** treating this as blocking, for the reason the original review gave
itself: those two go through the shared `workspaceAccess.fromProject`, they address an
unguessable cuid2 (no enumeration primitive), and the original review explicitly scoped them
out ("I would track that separately rather than widen this slice"). The fix did what that
review asked. But the fixture still overstates the system's behaviour, and `pnpm
test:permissions` cannot catch it because the fixture is generated from the policy declaration
and compared against itself — nothing compares either to a running route. Worth its own issue
alongside #256's, not a reason to hold #261.

---

## D4 — A credential revoked mid-request now reports "not found" on this route

**Note, not a finding. No security impact; a small, bounded diagnosability cost.**

`validateWorkspaceAccess` throws 403 in two distinct cases: an API key that is disabled or not
owned by the caller ("Invalid API key for this workspace"), and plain non-membership. The
remap catches both, so both become `404 Work item not found`.

**Security: this is the safer choice, and it hides nothing.** The API-key branch's query does
not reference `workspaceId` at all — it only asks whether this key is valid and belongs to
this user — so its 403 never carried workspace-dependent information in the first place.
Remapping it leaks nothing, and *not* remapping it would have been worse: a response that
varies by credential state while the membership answer is flattened to 404 gives an attacker a
second signal to difference against.

**Usability: bounded and narrow.** `authenticateApiRequest` already verifies the key and 401s
an invalid one before this middleware runs, and it derives `userId` from the key itself, so
the ownership clause always matches. The only way to reach the API-key 403 here is a key
disabled in the window between `verifyApiKey` and this check — a genuine race, not a stale-key
steady state. A caller in that race sees "not found" for a work item that exists and that they
can reach, and the same key on any other route still says "Invalid API key for this
workspace", so the diagnosis differs by route. Too narrow to act on; recorded so nobody
re-derives it during a support call.

---

## D5 — `work_item_key_alias`: survives the option chosen, but sits on the seam D1 exposes

The original review flagged this as unexamined and asked whoever closed F1 to check it.

**It survives.** The alias namespace never depended on `project.slug` being unique. It depends
on `work_item_key_claim`: `work_item_key_alias` carries `uniqueIndex(old_key)` plus a composite
FK `(old_key, work_item_id) → work_item_key_claim(key, work_item_id)` with `ON DELETE RESTRICT`
/ `ON UPDATE NO ACTION`. Its guarantee — an alias can only ever reference a claim its *own*
work item is on record as having made — comes from that FK and the claim table's PRIMARY KEY,
not from anything about slugs. Option 2 (the one taken) leaves `work_item.key` globally unique,
so the single-global-namespace premise the alias design was built around is intact. Option 1
would have broken it, as the original review predicted; option 2 does not. The unscoped
`WHERE key = ?` lookups in `require-work-item-reach.ts` and `get-work-item.ts` likewise remain
sound for the same reason.

**But it rests on the same seam.** The alias design assumes a key string, once claimed, is
permanently and unambiguously owned. That is true inside `work_item_key_claim`. It is *not*
true of the slug that generates those strings — which is precisely D1. There is no live write
path for aliases today, so nothing is broken now. When one lands (the natural trigger being a
project rename: re-key the items, record aliases for the old keys), it will inherit D1 directly
— the old slug's aliases stay claimed forever while the slug itself becomes available to
another tenant, so a second tenant's work items would generate key strings that are already
aliases of a first tenant's items. Closing D1 by making slug retirement permanent (option 1
under D1) closes this too, before the alias write path exists. Closing D1 any other way leaves
it to be re-derived later.

So the answer to the original review's question is: the alias namespace's assumptions survive
the option chosen, but the false premise `project.slug`'s comment carried has not been
eliminated — it has moved, from "slugs are unique" to "a slug, once used, stays used."

---

## Verification, re-run independently

All at `d5841ba`, in a dedicated worktree, against private `*_test` databases on `td-lane-pg`
(`opusdelta23_test` for the suite and the exploit probes, `migadv23_test` for the migration
work) — not trusting the addendum's reported numbers.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | **pass**, 8/8 projects |
| `pnpm test:permissions` | **pass**, 10 files, **80/80** |
| `pnpm check:openapi` | **pass** — `openapi.json` matches the API, 105 operations |
| `pnpm test:integration` | **pass**, 68 files, **616/616** |

The integration suite was fully green on this run — the known intermittent `health.test.ts`
readiness-probe failure (independently confirmed earlier as a pre-existing environment
artifact reproducible on plain `main`) did not reproduce at all here. Nothing else failed.

The exploit and migration probes are deliberately **not** committed — they demonstrate a
defect, and the right home for them is a regression test alongside whichever fix closes D1.
Every one is reproduced in full above, step by step, so they can be rebuilt exactly.

---

## What I did not do

- **I did not fix D1.** A reviewer that remediates cannot clear the remediation, and the choice
  between the three options above is a design call with a migration attached — Thomas's, the
  same way F1's original resolution was.
- I did not re-audit what the two Sonnet rounds already covered on the fixes themselves (fix
  logic, naming, mirroring of `WorkspaceSlugTakenError`, the doc-drift note filed as #264).
  This pass assumed those correct and attacked what they did not ask: whether the fix is
  *sufficient*, not whether it is *faithful*.
- I did not re-review the parts of #23 this slice defers (update, delete, bulk, ranking,
  hierarchy, watchers, pagination), nor the shared `workspace-access-middleware.ts` beyond the
  paths this slice reaches (#256's business), nor the UI/Docker/deployment surface — this
  branch touches none of it.
- I did not assess whether an existing production instance has orphaned
  `work_item_key_claim` rows already, because no deployment has ever run this write path —
  `work_item` has had no live writer before this slice.
