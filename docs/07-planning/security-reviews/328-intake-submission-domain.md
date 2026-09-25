# Pre-merge security / critical review — PR #328 (intake submission state machine, form/catalogue rules)

**Reviewed head:** `4b1197cdc4478ae5058a47e585900a6964699334`

**Reviewer:** Claude Opus 5.5, a fresh, independent context. It did not write, direct or fix
this change. It made no code edit and no PR-body edit. The only commit it made is this file.

**Verdict: CHANGES REQUESTED.** One HIGH finding: the `showIf` shape does not match the spec,
and it lets a required conditional field be skipped. Three MEDIUM findings. Five LOW
findings. The state machine itself is sound: a full sweep of states, actions and actors
reached no state the spec forbids.

This review covers the head above **only**. Any later commit outside
`docs/07-planning/security-reviews/` voids it.

## Scope

The diff against `origin/main`: `packages/domain/src/intake/{types,submission,request-type,duplicate}.ts`,
`intake.test.ts` (34 tests) and four export lines in `index.ts`. Specs checked:
`docs/03-features/intake-queue.md`, `docs/03-features/request-types-and-catalogue.md`, and the
`submission`/`request_type`/`custom_field` rows in `docs/01-architecture/data-model.md`, all
read at this head.

## What was measured

| Check | Result |
| --- | --- |
| `packages/domain` tests | 9 files, **504/504** pass |
| Coverage (gate 90 % statements/lines/functions) | all files 96.51 % stmts / 96.94 % lines / 98.23 % funcs. `intake/` 93.04 % stmts / 94.44 % lines / 97.22 % funcs. `submission.ts` 90.32 % stmts, `request-type.ts` 92.75 % stmts. `types.ts` shows 0 %, but it holds only a `const` array, and the aggregate passes |
| `tsc --noEmit -p packages/domain/tsconfig.json` | clean |
| Purity | no I/O, no `Date.now`, no `new Date()`, no randomness in `intake/` (grep); `now` is always an argument |
| CI (`gh pr view 328`) | every required check has a green run at this head **except** `pull request template + security review` (FAILURE). That is expected: no ordinary review is recorded yet. Some checks also show an older CANCELLED run next to a newer SUCCESS |
| Mutation: remove the IQ-16a `triageHasStarted` guard from `withdraw` | 1 test red. Reverted |
| Mutation: validate required on **all** fields instead of visible ones | 1 test red. Reverted |
| Mutation: drop the IQ-16 mandatory-reason check from `decline` | 1 test red. Reverted |

## Findings

### H1 (HIGH) — the `showIf` shape is not the spec's. The spec's own example is rejected, and when it is not validated a required field can be skipped

- **Spec:** `request-types-and-catalogue.md` § Data says `showIf` reuses
  `custom_field.visibility_condition`'s exact shape, `{ field_key, op: eq|neq|in|is_set, value }`.
  The spec's own example uses `"showIf": { "field_key": "impact", "op": "eq", "value": "Just me" }`.
  `data-model.md`'s `custom_field.visibility_condition` says the same.
- **Code:** `FormField.showIf` is `{ field, equals }`. The header and the PR body both say
  "`field equals value`" is "the ONE condition shape the spec defines". That is wrong at this
  head.
- **Input 1:** the spec's example schema (impact select + `asset_details` with the spec's
  `showIf`) goes through `validateFormSchema` → `[{ key: "asset_details", problem: "show_if_missing_field" }]`.
  A schema written exactly as the spec says cannot be published.
- **Input 2:** the same schema with `asset_details.required: true`, and
  `validateSubmissionData(schema, { impact: "Just me" })` → `[]`. `data[undefined]` is
  `null`, which never equals `undefined`, so the field is always hidden and its "required"
  is never checked. This is the "`showIf` used to skip a required field" risk. Any stored
  schema that skipped this validator (seeded data, migrated data, a future admin path, or
  an older version per RT-6) fails open.
- **Also missing:** `neq`, `in` and `is_set` are not supported.
- **Fix:** use the spec's shape (`field_key`/`op`/`value`) with all four operators. Treat an
  unknown `op` or a missing `field_key` as a publish defect **and** as *visible* at submit
  time, so an unreadable condition makes the field required rather than skippable. Pin it
  with the spec example verbatim.

### M1 (MEDIUM) — a customer's answer can pull an `Object.prototype` member into the native patch

- **Input:** field `{ key: "sev", type: "text", mapsTo: { field: "priority", map: { High: "urgent" } } }`
  with `data = JSON.parse('{"sev":"constructor"}')` → `translateMapsTo` returns
  `{ priority: [Function Object] }` (`typeof` is `"function"`). With `"__proto__"` it returns
  `priority === Object.prototype`. `"toString"`, `"hasOwnProperty"` and similar do the same.
- **Why:** `mapping.map[raw]` reads inherited properties, and `translated ?? raw` keeps them.
  `validateSubmissionData` blocks this only when the field also has `options`. Nothing
  requires a `map` to come with `options`, and `translateMapsTo` does not require
  validation to run first.
- **Impact:** a non-`FormValue` type goes into a native work-item field. At best that is a
  500 at insert; at worst the value is coerced to `"function Object() { [native code] }"` or
  `{}`.
- **Fix:** `Object.hasOwn(mapping.map, raw) ? mapping.map[raw] : raw`, and a test using
  `constructor`/`__proto__`.
- **Related (admin-controlled, LOW):** `mapsTo.field: "__proto__"` makes
  `native["__proto__"] = raw`, which swaps the returned object's prototype when `raw` is an
  array. Only a non-empty `nativeFields` set catches it at publish, and the default is empty.
  Build `native` with `Object.create(null)` or a `Map`, or reject `__proto__`/`constructor`/
  `prototype` as `key` or `mapsTo.field` in `validateFormSchema`.

### M2 (MEDIUM) — submitted values are not type-checked, so a wrongly typed controller value hides a required dependent

- **Input:** checkbox `outage`, then required `systems` with `showIf: { field: "outage", equals: true }`,
  then a required `number` field `count`. Submitting `{ outage: "true", count: "not a number" }`
  → `[]`. So does `{ count: { a: 1 } }` (an object is not a `FormValue`) → `[]`.
- **Why:** `validateSubmissionData` checks only presence and `options`. It never checks that
  a checkbox value is a boolean, a number is a finite number, a date is a date, or a text
  value is a string. `showIf` compares with `===`. So the string `"true"` hides `systems`,
  while any later code that reads `form_data.outage` as truthy treats it as checked.
- **Also missing:** no size limit on a value, and no limit on the number of keys. Unknown
  keys are accepted by design (RT-3), so without an API-side limit `form_data` has no bound.
- **Fix:** validate each value against its field `type` (and `multiple`) for visible fields,
  reject non-`FormValue` shapes, and add a length limit for text (or record where the API
  enforces one).

### M3 (MEDIUM) — IQ-18 does not follow the spec, and the header misquotes the spec

- **Spec at this head (IQ-18, since #304 on 2026-09-23):** "trigram similarity
  (`similarity(work_item.title, :query) > 0.3` — pg_trgm's own default threshold, over the
  `gin (title gin_trgm_ops)` index …) over work items created in the same organisation in
  the last 90 days."
- **Code:** Sørensen–Dice over character **bigrams** of title + description, threshold
  `>= 0.35`, in JavaScript. The header and the PR body say IQ-18 "contracts only 'text
  similarity'". That was the pre-#304 wording.
- **Input:** `normalise()` deletes every character outside `[a-z0-9\s]`.
  `similarityScore("เครื่องพิมพ์เสีย", "เครื่องพิมพ์เสีย ชั้น 3")` → `0`. Any title written
  entirely in a non-Latin script never gets a suggestion. Accented Latin loses letters
  ("Büro" becomes "b ro").
- **Performance (you asked for timings):** the algorithm is linear, not quadratic. Doubling
  input length: 100k → 8.8 ms, 200k → 18.9, 400k → 42.7, 800k → 70.3, 1.6M → 141.6 ms.
  One 1 MB pair takes 108 ms; one 5M-character pair takes 814 ms. 10,000 candidates of
  2 KB each take 2.5 s. There is no pathological case, but there is also no size limit, and
  the spec expects this to run in Postgres over an index, not as a JS scan of every
  candidate.
- **Fix:** either follow the spec (pg_trgm in the query layer, and drop this function or
  keep it only as a test oracle), or record the change in the spec first. Either way,
  correct the header.

### L1 (LOW) — an unknown action returns `undefined`, not a refusal

`transitionSubmission(rec, { action: "bogus", … })` returns `undefined` for every state and
actor. The header promises "Every result is a discriminated union, never a thrown error".
A caller that trusts a JSON `action` then crashes on `result.ok`. Add a `default:` that
returns `refuse("illegal_state")`, and a test.

### L2 (LOW) — `reopen` accepts a staff decline, which allows a decline/reopen loop

The sweep shows `declined -reopen/customer-> new`, even when the submission is claimed. IQ-15
gives reopen for the **auto**-decline; IQ-16a says that once triage starts the submission
"is the triage team's to dispose of". The PR flags this reading openly. It is Thomas's call
(a spec sentence plus a column such as `declined_by_system`), not something to fix
silently. Listed so the choice is made before the API slice.

### L3 (LOW) — hidden fields' answers are stored, rendered and never checked

`renderUnmappedIntoDescription` ignores visibility. With `outage: false`, the hidden
`systems: "SMUGGLED hidden value"` still appears under "Additional details". A hidden
select's value is never checked against its options. Pass only visible fields (or drop hidden
values) when rendering, to match RT-5.

### L4 (LOW) — a field key that matches an `Object.prototype` name satisfies "required"

A required text field with key `toString`, validated against `{}` → `[]`, because
`data["toString"]` is inherited. Keys are admin-authored, so the risk is low. Use
`Object.hasOwn(data, key)` for presence, or reject reserved keys at publish.

### L5 (LOW) — edge values are not validated

- `formatSubmissionReference(1e21)` → `"SUB-1e+21"`, which `parseSubmissionReference`
  rejects. The guard should use `Number.isSafeInteger`.
- `isClarificationOverdue(..., NaN)` is never overdue, and `-1` is overdue at once. IQ-15's
  `clarification_window_days` needs to be checked as a positive integer somewhere.
- `catalogueFor` sorts groups alphabetically with a locale-dependent `localeCompare`. RT-9
  says "Groups are ordered manually", and there is no group-position column yet. This is not
  flagged in the PR.

## State machine — what was confirmed

A sweep of all 6 states × 9 actions (the 8 real ones plus one unknown) × 3 actors ×
claimed/unclaimed. The only successful transitions:

- `new`/`clarifying` → `clarifying`, `accepted`, `declined`, `duplicate` (triager only);
- `clarifying` → `new` via `reply` (customer), and → `declined` via `auto_decline` (only when overdue);
- `new`/`clarifying` → `withdrawn` (customer, **only while unclaimed and with no staff message**);
- `declined` → `new` via `reopen` (customer, see L2).

`accepted`, `duplicate` and `withdrawn` accept nothing. No actor can do the other side's
actions. An empty reason, target or work-item id is refused (a reason of only spaces is
refused too; a target of only spaces is accepted — trivial).

---

## Delta re-review — fix round under #366

**Reviewed head:** `66e37a61839460ec11f20d920c5a431a255fc5e3`

**Reviewer:** Claude Opus 5.5, a fresh context in a fresh worktree. It did not write the
fix. It made no code edit and no PR-body edit.

**Verdict: CHANGES REQUESTED.** H1, M1 and M2 are closed as reported. But adding `neq` opens
a new way to skip a required field (N1, MEDIUM). That is the same class as H1, and it
blocks. Two more items must be fixed in the same round (N2, and the M3 header text). The
rest are non-blocking follow-ups. This verdict covers the head above only.

### What changed since `1d31ad0`

`d05d07e` merges `main`; that brings only the #369 decision-log entry into `docs/`. `66e37a6`
touches `intake/{request-type,types,duplicate}.ts` and `intake.test.ts`. `submission.ts` is
unchanged. The branch is one merge behind `main` (#343). That is why the diff shows
`343-audit-read-api.md` as removed.

### Measured at this head

| Check | Result |
| --- | --- |
| `packages/domain` tests | 9 files, **515/515** pass |
| Coverage (gate 90 %) | 96.54 % stmts / 96.93 % lines / 98.28 % funcs. `request-type.ts` 94.28 / 94.73; `submission.ts` 90.32 / 92.72 |
| `tsc --noEmit` | clean |
| Mutation: a malformed condition becomes *hidden* instead of visible | 1 test red. Reverted |
| Mutation: bring back `mapping.map[raw]` without `Object.hasOwn` | 1 test red. Reverted |
| Mutation: the checkbox type check always passes | 2 tests red. Reverted |
| CI at `66e37a6` | `contract - OpenAPI drift` **FAILURE**: oasdiff reports `GET /instance/audit` and `GET /workspaces/{workspaceId}/audit` as "removed". That is the branch being behind #343, not a defect here; the planned update-branch clears it. `pull request template + security review` FAILURE (reviews not yet recorded). `unit + component` and `gate checkers` were still running. The rest are green |

### (1) Are H1, M1 and M2 closed?

- **H1 — closed.** The spec's example, `{ field_key: "impact", op: "eq", value: "Just me" }`,
  now publishes clean. Submitting "Just me" without the dependent field now gives
  `required_missing`. All four operators behave as the spec says (eq, neq, in and is_set;
  each checked for a match and a non-match). Malformed conditions — a string, an array, the
  old `{field, equals}` shape, `op: "gt"`, `op: "__proto__"`, `in` with a non-array value, a
  blank `field_key`, a numeric `field_key` — are rejected at publish with
  `show_if_invalid_condition`. At submit time the field counts as visible, so its
  `required` is still enforced.
- **M1 — closed.** Answers `constructor`, `__proto__`, `toString` and `hasOwnProperty` now
  pass through as the raw strings; a mapped `High` still becomes `urgent`. `mapsTo.field:
  "__proto__"` becomes an own data property (`Object.fromEntries`), and the prototype stays
  `Object.prototype`. A required field with key `toString` is now `required_missing`
  against `{}`.
- **M2 — closed.** These all give `wrong_type`: checkbox `"true"`, number `NaN` or `"5"`, an
  object in a text field, an array on a single-value field, a nested array on a `multiple`
  field, and an array on a single-value select. A text answer of 10,000 characters passes;
  10,001 is rejected.

### (2) New issues

- **N1 (MEDIUM, blocks) — a hidden controller's value can hide a required field through
  `neq`.** `isFieldVisible` reads the controller's submitted value whether or not the
  controller is itself visible. Nothing validates a hidden field's value.
  Input: `a` (checkbox), then `b` (select `y|n`, `showIf a eq true`), then `c` (text,
  required, `showIf b neq "y"`). Honest submit `{ a: false }` → `c: required_missing`
  (correct: `b` is hidden, so it has no value, and `c` shows). Crafted `{ a: false, b: "y" }`
  → **`[]`**: the required `c` is skipped. `renderUnmappedIntoDescription` also prints the
  smuggled `b: y`. Before this round only `eq` existed, and a smuggled value could only
  *add* required fields. `neq` (and `in` with a negated intent) turns it into a skip.
  `validateFormSchema` accepts this chained schema.
  Fix (either one): (a) work out visibility in dependency order, treating a hidden
  controller's value as absent, with a cycle guard; or (b) reject at publish any `showIf`
  whose controller has its own `showIf` (data-model calls `visibility_condition`
  "single-level"). Either way, drop or ignore hidden fields' values in validation, mapping
  and rendering. Add the input above as a test.
- **N2 (LOW, fix in the same round) — `showIf: null` crashes.** `validateFormSchema` and
  `validateSubmissionData` both throw `TypeError: Cannot read properties of null (reading
  'field_key')`. JSON `null` is a likely stored value for "no condition" (a UI clearing
  it). Treat `null` as absent (`field.showIf != null`).
- **N3 (LOW) — a well-formed condition pointing at a field that does not exist fails
  *open* at runtime.** `{ field_key: "constructor", op: "is_set" }` is rejected at publish
  (`show_if_missing_field`), but a stored schema that skipped publish hides a required
  field (`[]` against `{}`). A condition whose `value` cannot be a FormValue
  (`{ a: 1 }`) passes publish and hides its field forever. Both need an unvalidated or
  malicious admin schema. Suggestion: `visibleFields` has the schema, so treat a dangling
  `field_key` as visible, and check the `value` shape at publish.
- **`MAX_TEXT_ANSWER_LENGTH` = 10,000 — sensible**, but it bounds one string only. A
  `multiple` text field with 100,000 answers of 10,000 characters each (about 1 GB) passes
  (`[]`, in 1 ms). Unknown keys have no limit either (by spec). The API slice must set a
  request-body limit and a limit on `multiple` array length. `date` accepts any string up
  to 10,000 characters ("not a date" passes). Check that it is an ISO date. A required
  checkbox is satisfied by `false`. All LOW, non-blocking.

### (3) Do M3 and the reopen rule block?

- **M3's algorithm (bigram Dice instead of pg_trgm) — does not block.** Nothing on `main`
  calls intake, and IQ-18 puts the real query in Postgres. As a pure helper it is harmless
  if the API slice follows the spec. **The header text does block:** `duplicate.ts` still
  says "IQ-18 says only 'text similarity …' … implementation details, not spec contracts".
  That was false at this head. Merged, it tells the next implementer the spec allows this.
  Replace it with one honest sentence (IQ-18 specifies pg_trgm `similarity(title, q) > 0.3`;
  this helper is not the IQ-18 implementation). Open a tracked issue for the API slice.
- **Reopen of staff declines — does not block, on conditions.** No caller exists, so no
  customer can reach `reopen` today. But the coordinator reports that Thomas decided
  "customers reopen ONLY auto-declines", and **that decision is not in
  `decision-log.md` on `main`** (searched). Before this merges: (a) record it in the
  decision log and IQ-15, since CLAUDE.md requires this before dependent code merges;
  (b) open an issue for the `SubmissionRecord` field and data-model column, which must
  land before any reopen route; (c) update `submission.ts`'s reopen comment, which still
  calls "any declined" the only implementable reading, so it says the rule is decided and
  not yet enforced. (An alternative that also clears this: make `reopen` refuse until the
  field exists.)

### What must change before this can clear

N1 (with a test), N2, the corrected `duplicate.ts` header, and the reopen conditions
(a)–(c). Then update the branch onto `main` so the OpenAPI drift check goes green, and do a
delta review of that head.
