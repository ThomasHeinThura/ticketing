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
