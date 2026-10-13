# PR #664 security review record: selected Intake source

This note records the ordinary and security reviews of PR #664. The PR covers request types and the customer catalogue, customer submission and sign-in on the portal, the staff triage queue, and submission attachments. It selectively integrates the canonical intake source, frozen in #598, onto the accepted backend. #598 stays open until this candidate is accepted.

## Review chain

- **Codex GPT-6 Luna panels on earlier heads.** The panels at `afa009bd`, `0cdcff74` and `e0d80324` requested changes or blocked.
  - Panel B blocked on request-type deletion bypassing pending-action approval. This candidate removes request-type deletion entirely (`8677a154`). Deletion remains an unresolved owner decision.
  - Their reports are preserved unchanged below.
- **Real-journey and acceptance fixes (`700c0e55..ecacbafa`).** These covered portal routes, portal CSRF origin binding, portal storage access and the triage actor id. Two Claude Sonnet 5.5 ordinary reviews approved them, and a Claude Opus 5.5 security review cleared them.
- **Whole-PR reviews at `d43de75b`.**
  - Claude Sonnet 5.5 requested changes: request-type deletion was still present, and customer download was refused for finalized keys.
  - Claude Opus 5.5 blocked: a duplicate-linked submission could list another customer's private attachments.
  - All were fixed by `852890f4`. Both reviewers re-reviewed: APPROVE and CLEAR.
- **Second whole-PR ordinary review at `852890f4`.** Claude Opus 5.5, in the ordinary-review role because Sonnet capacity was exhausted, requested changes on two points:
  - the portal catalogue and own-submission reads did not filter on the intake flag key;
  - two customer routes returned stored rows, including a storage key.
  - Both were fixed at `7b30dfbf`, with fail-before and pass-after tests. The review was then APPROVE, and a security rebind was CLEAR.
- **Merge of `main` `d9af1c83` (#670) at `b658d5cc`.** Claude Sonnet 5.5 approved it, and a Claude Opus 5.5 security rebind cleared it.

Every model is labelled as the report declares it. Claude Sonnet 5.5 and Claude Opus 5.5 reports are Claude contexts and are not recorded as GPT-6 Luna or GPT-6 Sol.

**Reviewed head:** `afa009bd5180f90f0026592a8d1c405ef3b21f9c`
**Reviewed head:** `0cdcff749ced72ef0e0f664b3df5a3f03e970213`
**Reviewed head:** `e0d8032463e0fa323626a498407f765646fb83f4`
**Reviewed head:** `ecacbafa38b737c352f5f0cc4b05baf45448bfa2`
**Reviewed head:** `d43de75b19548366dc55b993c0e2d12bdb749e36`
**Reviewed head:** `852890f4193a884a3227bf378d428ba473e3f14c`
**Reviewed head:** `7b30dfbf7a647119d4247b96248ab9dd89317013`
**Reviewed head:** `b658d5cc15a1cb7e03c53a3610a152e6772eee33`

The last line above is the candidate head, `b658d5cc15a1cb7e03c53a3610a152e6772eee33`. Earlier heads are listed in chronological order, and every one is an ancestor of the candidate.

## Context index

SHA-256 is of the report file bytes and matches the embedded copy.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `2026-10-11/664-intake-independent-api-a-luna.md` | Ordinary panel, API (selected source) | GPT-6 Luna | `afa009bd` | REQUEST CHANGES | `dedd796eb65b73e931fa5cd7bba6827429de2d58ebaac336329b14da6203c26d` |
| 2 | `2026-10-11/664-intake-independent-web-b-luna.md` | Ordinary panel, web (selected source) | GPT-6 Luna | `afa009bd` | BLOCK | `d7d7bb027544ed12286420531dc02dd4d11e14d3c82e8fc95b07add7dbd08627` |
| 3 | `2026-10-11/664-intake-independent-integration-c-luna.md` | Ordinary panel, integration (selected source) | GPT-6 Luna | `afa009bd` | REQUEST CHANGES | `4f00b8de8124c3fdf96e433156e691893c9d2fa14c684010677d892b8744afe5` |
| 4 | `2026-10-11/664-current-panel-a-luna.md` | Ordinary panel A (current source) | GPT-6 Luna | `0cdcff74` | BLOCKED | `b474561a75d5b9c594982115a4b57fad7d04013f7ca7ad6b251592db5571d0b9` |
| 5 | `2026-10-11/664-current-panel-b-luna.md` | Ordinary panel B (current source) | GPT-6 Luna | `e0d80324` | BLOCK (request-type deletion) | `74d76906aa59c39afebbee0bd680c2cf67e739fd074654de471c6f63c9d4b2db` |
| 6 | `2026-10-11/664-current-panel-b-luna-base-pin-addendum.md` | Panel B provenance addendum (base pin) | GPT-6 Luna | `e0d80324` | verdict unchanged | `3d806a123918c81c01fb1f5f40daca9305bc0f91bccffca2c1eb56bb065775f7` |
| 7 | `2026-10-11/664-current-panel-b-luna-source-pin-correction.md` | Panel B provenance correction (source pin) | GPT-6 Luna | `e0d80324` | verdict unchanged | `695f4dcc33ff2bd2679128ad187cb9574fb270e951b515e25b4f640f63dc88b6` |
| 8 | `2026-10-11/664-current-panel-c-luna.md` | Ordinary panel C (current source) | GPT-6 Luna | `e0d80324` | BLOCKED | `fce69e153a8899d9987104ba620377b4cfa23cc6bcae9eccbe5d1d4fee9613dd` |
| 9 | `2026-10-12/664-700c-ecac-ordinary-sonnet.md` | Ordinary delta (700c0e55..ecacbafa) | Claude Sonnet 5.5 | `ecacbafa` | APPROVE | `5fc9645f90f36a4886809af4a0786a7bd23f81698ba44ba94911e83c64422773` |
| 10 | `2026-10-12/664-700c-ecac-ordinary-2-sonnet.md` | Ordinary delta, second reviewer (700c0e55..ecacbafa) | Claude Sonnet 5.5 | `ecacbafa` | APPROVE | `2a309b78737717d1744cdaeffcb347eb9d4f1f493623f2e33ea14af20a7dd22c` |
| 11 | `2026-10-12/664-700c-ecac-security-opus.md` | Security delta (700c0e55..ecacbafa) | Claude Opus 5.5 | `ecacbafa` | CLEAR | `1149976767d4c49478d5570b74f5af35c55bcdc3537f01a198e4374ee7015c9a` |
| 12 | `2026-10-12/664-whole-d43d-ordinary-a-sonnet.md` | Whole-PR ordinary, reviewer A | Claude Sonnet 5.5 | `d43de75b` | CHANGES REQUESTED | `7bf361dbc434b1995c0497e2f044a1eac932f1e764853877f6c43ac6cbe634f5` |
| 13 | `2026-10-12/664-whole-d43d-security-opus.md` | Whole-PR security review | Claude Opus 5.5 | `d43de75b` | BLOCK | `99c6cedef61f14775c9b1ba3ee1f50b3411b4423dc7eeae3d0e6975a85303515` |
| 14 | `2026-10-12/664-d43d-8528-ordinary-a-sonnet.md` | Reviewer A delta re-review (d43de75b..852890f4) | Claude Sonnet 5.5 | `852890f4` | APPROVE | `2c2942ec11f5ef49847c5d89c4013da27bf2296e28b665e8948e1070b43ec512` |
| 15 | `2026-10-12/664-8528-security-rebind-opus.md` | Security rebind (d43de75b..852890f4) | Claude Opus 5.5 | `852890f4` | CLEAR | `a0a715fb8cd06549358dd7789ef34e1e83ba4d4487aefbe6f183f2b4bf5b9380` |
| 16 | `2026-10-12/664-whole-8528-ordinary-b-opus.md` | Whole-PR ordinary, reviewer B | Claude Opus 5.5 (ordinary-review role) | `852890f4` | CHANGES REQUESTED | `543239c42311732a2fc829516be77b04b28828510ab6d8e1ae9cafb546631100` |
| 17 | `2026-10-12/664-8528-7b30-ordinary-b-opus.md` | Reviewer B delta re-review (852890f4..7b30dfbf) | Claude Opus 5.5 (ordinary-review role) | `7b30dfbf` | APPROVE | `d9cdd8452b7df6943fa07daefc7261b0b05829b1f63801b250110a1f0e90d517` |
| 18 | `2026-10-12/664-7b30-security-rebind-opus.md` | Security rebind (852890f4..7b30dfbf) | Claude Opus 5.5 | `7b30dfbf` | CLEAR | `70c325ba4168420ec3b8b0b74d0c82d6d6de9244ed32ebcdd8e0d578f21903a0` |
| 19 | `2026-10-12/664-b658-merge-ordinary-sonnet.md` | Ordinary (7b30dfbf..b658d5cc: merge of main d9af1c83) | Claude Sonnet 5.5 | `b658d5cc` | APPROVE | `3cf309468994383423ec81b85e9eb07b486f661a505e8876480848ba4ce6547f` |
| 20 | `2026-10-12/664-b658-security-rebind-opus.md` | Security rebind (7b30dfbf..b658d5cc) | Claude Opus 5.5 | `b658d5cc` | CLEAR | `42f86f589b4928820f51d5782d4e648baf8defce4c311e0c306fa6f1aa2159be` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-intake-independent-api-a-luna.md; GPT-6 Luna; sha256 dedd796eb65b73e931fa5cd7bba6827429de2d58ebaac336329b14da6203c26d) -->
# PR #664 — independent API review A

**Model:** GPT-6 Luna (assigned Luna-tier reviewer; exact serving build/version is not exposed in this context)  
**Role:** Fresh independent ordinary reviewer A; I did not author, direct, or remediate this candidate.  
**Reviewed head:** `afa009bd5180f90f0026592a8d1c405ef3b21f9c`  
**Comparison base:** `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`  
**Tree:** `3173dfaede7101ed4c1e56a405d7237f65497b39`  
**Verdict:** **REQUEST CHANGES** — two default-off feature-gate omissions and one portal attachment-authority gap need disposition before this API integration can clear review.

## Scope checked

Read repository instructions and workflow, the active mission, request-type/catalogue and intake-queue specifications, RBAC and feature-flag contracts, relevant data-model and attachment contracts, the selected-scope manifest/handoff, and the #662 composition receipt. Reviewed current candidate API router, route policies/registration, repository transactions and tenant predicates, submission attachment reach/controllers, typed database exports, route mounting, OpenAPI output, and the six-case integration test. This is a focused API review of the exact candidate, not a blanket review of the historical #598 snapshot or all product paths.

## Findings

### [P1] Item-addressed request-type routes bypass the default-off flag

`apps/api/src/intake/index.ts:211-230` (`requestTypeReach`) resolves the row and checks workspace access but never calls `requireIntakeEnabled`. Consequently `GET /api/request-types/{id}`, `PATCH /api/request-types/{id}`, publish, unpublish, and delete remain reachable to otherwise-authorized staff while `feature.intake` resolves false. The collection route and create route do use `requestTypeCollectionScope`, which checks the flag; the gap is limited to the item-addressed routes.

The accepted D5 decision permits `feature.intake` reads for the canonical intake routes and repository operations while retaining the default OFF. The asymmetry means the kill switch does not cover all of this feature's management surface. Apply the same workspace flag check after resolving the row workspace and add a regression proving those routes are refused when the resolved flag is off.

### [P2] Portal submission listing returns records with intake disabled

`apps/api/src/intake/index.ts:756-767` registers `GET /api/portal/submissions` with only `portalOrganisation`; unlike `portalOwnSubmission`, the middleware does not check the intake flag. Its handler at `1051-1076` calls `listOwnSubmissions`, which returns the caller’s records without a workspace-flag filter. A portal customer can therefore continue to receive references, states, timestamps, visibility, and request-type names while intake is disabled. Individual detail and attachment routes are gated, so this also presents links to pages that then return 404.

Gate this collection consistently with the enabled intake workspace set represented by the caller’s records (including pagination/count behavior), or otherwise settle and encode the intended disabled-feature behavior. Add a feature-off integration case so a list cannot expose rows whose corresponding workspace has intake disabled.

### [P2] Portal completion can finalize a staff-created pending attachment after conversion

`apps/api/src/attachment/require-submission-attachment-reach.ts:107-129` accepts any pending attachment on the converted work item for `portal_complete`; `apps/api/src/attachment/controllers/complete-submission-attachment.ts:58-80` then selects it by id, workspace, and parent, without checking `uploadedBy === requesterId` or `customerVisible`. The accepted-parent branch was needed for a customer upload presigned before conversion, but it also authorizes completion of a different pending work-item attachment. For example, after acceptance, a customer-visible pending staff upload is returned by the portal attachment list; the requester can call the portal completion endpoint with that attachment ID and finalize it before its owner completes it. An internal pending attachment ID, if obtained, is also sufficient to reach the same mutation despite its visibility setting.

Restrict the accepted-parent completion branch to the submission’s own customer-uploaded attachment (at minimum the original requester/uploader and the intended customer-visible/parent conditions), while preserving the pre-acceptance-presign race. Add a negative integration case for a pending staff-created work-item attachment and retain the positive “customer upload presigned before acceptance completes after conversion” case.

## Positive evidence and coverage limits

- Candidate head and working tree were verified; the worktree was clean.
- Read-only `git diff --check 3dadd086d2a0bc3d35621fc97683cc0dea2eec7d...HEAD` passed.
- `feature.intake` is registered with default `false`; resolver use and row-derived workspace checks are present on collection routes, submission-by-reference routes, catalogue filtering/submission transaction, and submission attachment reach.
- The route-policy registry contains the new intake and submission attachment route entries. The six-case conversion test uses the real database harness and covers auto-accept audience binding, hidden mapped answers, project/archive lock ordering, concurrent acceptances, atomic transfer of comments/attachments/watcher/SLA time, and system actor attribution. It is meaningful as source coverage, but neither I nor the author handoff reports it executed on this candidate.
- The author’s selected checks report current-source API/web typechecks and builds, lint, dependency boundary, focused domain/web tests, OpenAPI (278 operations: 28 added, none removed), and route-policy matrix passing. I did not rerun these checks.

No database tests, broad builds, browser checks, Docker/image checks, or CI were run for this review. The six-case database integration suite remains unexecuted evidence here. The authorized other ordinary contexts and the separate required full GPT-6 Sol security review remain outstanding; this report satisfies only one ordinary-review context.
<!-- END REPORT (sha256 dedd796eb65b73e931fa5cd7bba6827429de2d58ebaac336329b14da6203c26d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-intake-independent-web-b-luna.md; GPT-6 Luna; sha256 d7d7bb027544ed12286420531dc02dd4d11e14d3c82e8fc95b07add7dbd08627) -->
# Independent ordinary review B — #664 intake web/domain

**Verdict: BLOCK** — five actionable web acceptance defects remain. This is an ordinary
web/domain review, not an API/security review, browser acceptance, or merge approval.

**Reviewer / provenance:** GPT-6 Luna dispatch selector supplied by the conductor. The child
runtime does not expose a more specific serving-variant identifier. Fresh independent context;
did not author, direct, or remediate the candidate.

**Candidate:** `afa009bd5180f90f0026592a8d1c405ef3b21f9c`

**Comparison base:** `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`

**Scope checked:** selected request-type editor and customer preview, canonical domain/web
visibility and submission-validation adapters, portal catalogue and durable submission page,
agent triage presentation, route/search-state helpers, approved web-to-domain dependency and
lock importer. Compared these paths with `request-types-and-catalogue.md`, `intake-queue.md`,
`customer-portal.md`, the intake selection manifest/handoff, the approved internal-dependency
decision, and UX quality gates G6/H4. Static source inspection plus focused pure tests only.

## Findings

### B1 — The editor preview can disagree with the customer form

**Priority: P2** · `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/request-types.tsx:715`

The preview filters each field by evaluating its `showIf` against the raw `previewValues` map.
It does not use the canonical `resolveFormVisibility` evaluator used by portal rendering and
submission validation. The domain evaluator deliberately treats the answer to a hidden
controller as absent (N1), so a hidden answer cannot control downstream visibility.

Reproduction: set A=false; B has `showIf A eq true`; C is required and has `showIf B neq "x"`.
In the editor, enter B="x" before changing A to false. The preview hides C because it reads
the stale hidden B answer. The portal resolver treats B as absent and shows/requires C. The
API rejects chained visibility at publish, but the editor permits authoring this chain and
the live preview is specifically required to show the customer's form. The preview should
resolve the full schema through the same domain function.

### B2 — Keyboard entry of a multiword catalogue search is broken

**Priority: P2** · `apps/web/src/lib/routes.ts:183` and `apps/web/src/routes/portal/catalogue.tsx:135`

The controlled search input navigates on every keystroke. `parsePortalCatalogueSearch`
trims `q`, and the input renders that parsed value. Typing a trailing space after a word
therefore immediately removes it; the next word joins the previous one. A user cannot type
ordinary multiword searches such as `printer fault` (pasting the whole phrase works). Keep
the in-progress input separate from the normalized URL value, or otherwise preserve the
space while typing; the URL can still normalize on submit/debounce/blur.

### B3 — The catalogue renders blank while its initial request is loading

**Priority: P2** · `apps/web/src/routes/portal/catalogue.tsx:406`

When `catalogue.isLoading` is true, `entries` and `groups` are empty. The code suppresses
the empty-catalogue message during loading, then maps the empty `groups` array, so the
customer sees only the heading and search box with no status or content until the request
finishes. The route needs a visible loading state; this is also the loading case covered by
the portal's H4/G6 state requirements.

### B4 — Durable submission attachment failures are presented as success/absence

**Priority: P2** · `apps/web/src/routes/portal/submissions/$ref.tsx:137`

The page's error alert checks the page, reply, and withdrawal queries/mutations, but omits
`attachments.isError` and `finishUpload.isError`. A failed attachment-list request renders
the same empty list as a submission with no attachments; a failed “Finish upload” mutation
has no visible error at all. Since the page loads the submission and attachment list
independently, this is a partial failure that needs an explicit error state and recovery
action. The existing upload mutation's error is surfaced, so this finding concerns list and
completion failures.

### B5 — Submission answers are shown under opaque keys instead of their labels

**Priority: P2** · `apps/web/src/routes/agent/_layout/_authenticated/agent/triage.tsx:265`;
`apps/web/src/routes/portal/submissions/$ref.tsx:180`

Both views enumerate `formData` and use the storage key as the visible label. The API detail
includes the immutable request-type version schema and its customer labels; the default
editor keys are values such as `field_1`, while the label is “New question”. Triage staff
therefore make acceptance/decline decisions from machine keys, and customers returning to
their durable page see the same opaque names. Render answers by joining the version schema
field key to its label, with a safe fallback for legacy unknown keys.

## What checked clean

- The web adapters call the existing `@taskdesk/domain` validation and visibility functions;
  no second portal-side evaluator remains in those adapters.
- The editor exposes only native `title`, `description`, and `priority` mappings. It visibly
  refuses required-file publishing; optional post-submit attachment guidance remains. It
  exposes the request-type private override, while the portal uses the organisation default
  and offers the two documented visibility choices. No God Mode catalogue-assignment UI or
  custom-field mapping control was added in the reviewed screens.
- The approved `@taskdesk/domain: workspace:*` web dependency and importer link are present;
  the frozen dependency decision allows the corresponding single checker/matrix edge. No
  third-party package was added.
- Intake route helpers cover editor selection, triage filters/reference/cursor, catalogue
  query/key, and durable submission reference; focused round-trip coverage exists.
- Required-file/custom-field/God Mode assignment holds and the default-OFF intake decision
  are preserved in the examined selection and screen paths. This inspection does not replace
  the separate API permission/flag review.

## Checks and limits

- `pnpm --filter @taskdesk/domain exec vitest run src/intake/intake.test.ts` — 1 file, 51
  tests passed.
- `pnpm --filter @taskdesk/web exec vitest run src/lib/intake-validation.test.ts src/lib/intake-visibility.test.ts src/lib/routes.test.ts`
  — 3 files, 21 tests passed.
- The handoff records current web agent/portal builds and G12 bundle purity as passed; this
  reviewer inspected the generated portal module graph and found the intake domain module in
  the portal chunk. The build's `node:crypto` externalization warning was not reproduced as a
  runtime import in emitted portal JavaScript; no browser runtime conclusion is claimed.
- No source changes were made. No browser/E2E, database, full API test, Docker/image, full
  `Any`, accessibility, or performance run was performed. The handoff explicitly leaves
  browser and image acceptance to the conductor. This report does not approve those gates,
  the independent API review, the third ordinary review, the required Sol review, or merge.
<!-- END REPORT (sha256 d7d7bb027544ed12286420531dc02dd4d11e14d3c82e8fc95b07add7dbd08627) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-intake-independent-integration-c-luna.md; GPT-6 Luna; sha256 4f00b8de8124c3fdf96e433156e691893c9d2fa14c684010677d892b8744afe5) -->
# PR #664 — independent integration review C

**Model:** GPT-6 Luna (assigned Luna-tier reviewer; exact serving build/version is not exposed in this context)  
**Role:** Fresh independent ordinary reviewer C; I did not author, direct, or remediate this candidate.  
**Reviewed head:** `afa009bd5180f90f0026592a8d1c405ef3b21f9c`  
**Comparison base:** `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`  
**Verdict:** **REQUEST CHANGES** — request-type deletion bypasses the approved destructive-action lifecycle.

## Scope checked

Read the repository authority/workflow and active mission, the intake and request-type contracts, attachment and SLA contracts, pending-action architecture, selected-source/handoff manifest, and the exact candidate diff. Focused on composition across the API route and repository, the converted work-item/SLA/event writers, attachment reach and transfer, portal/web-domain boundary, and the new dependency/checker edge. This is an independent integration review of the exact candidate, not review of the historical #598 cumulative snapshot.

## Finding

### [P1] Request-type DELETE performs irreversible work without a pending action

`apps/api/src/intake/index.ts:448-464` registers `DELETE /api/request-types/{id}` behind ordinary `request_type:manage` scope/capability middleware and its handler at line 898 calls `deleteRequestType` directly. `apps/api/src/intake/repository.ts:479-514` immediately deletes the row (after checking it is unpublished and has no submissions), then writes an audit row. The path never creates or executes a `pending_action`, nor does it reject API-key credentials with the pre-P4 `403 not_implemented` behavior.

This conflicts with `docs/01-architecture/pending-actions.md` PA-1: every user-initiated deletion, including a `DELETE` route, must first request a pending action; PA-2 says nothing is deleted at request time. The same spec says the P1 mechanism is for browser-session deletions and, until P4, an API-key `DELETE` returns `403 not_implemented`. The feature spec's ordinary DELETE route describes which records may be deleted; it does not override the global destructive-action contract. An unpublished, unused request type can still contain the administrator's configured form/mapping and catalogue relationships, and the current handler permanently removes it on one authorized request.

Route this deletion through the pending-action lifecycle (including exact target/policy revalidation at execution), or keep the destructive route unavailable until that integration exists. Add coverage that a normal browser request creates a pending action without deleting, approval executes exactly that target, and an API-key request is refused under the current pre-P4 boundary.

## Positive evidence and limits

- Verified the worktree is at the reviewed SHA and clean.
- Read-only `git diff --check 3dadd086d2a0bc3d35621fc97683cc0dea2eec7d...HEAD` passed.
- The conversion code selects SLA policy using the accepted precedence and submission `createdAt`; the selected three work-item SLA lookup helpers match the direct-create query semantics. Conversion transfers comments with original timestamps, moves submission attachments and request participants in the transaction, creates the requester watcher, and pairs accepted work-item/submission effects with audit and outbox writes.
- The portal attachment accepted-parent completion path does not constrain uploader/visibility in its reach query or transaction. This independently corroborates ordinary reviewer A’s portal-completion finding; I did not count it as a separate finding.
- The portal `/api/portal/submissions` feature-off list gap and item-addressed request-type feature-off gap were already reported by ordinary reviewer A and are not repeated here.
- The new `@taskdesk/web -> @taskdesk/domain` edge matches the stated owner approval and is represented in both the dependency checker and package-boundary document. No additional edge or held schema/migration work was identified in this bounded check.
- I did not run database-backed tests, broad builds, browser checks, image/container checks, or CI. The author handoff reports relevant bounded static/type/build results, but those are not my execution evidence. The six-case database conversion suite remains unexecuted per the handoff.

This report is limited to this ordinary integration-review context; it does not satisfy the remaining review or security-review tiers.
<!-- END REPORT (sha256 4f00b8de8124c3fdf96e433156e691893c9d2fa14c684010677d892b8744afe5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-a-luna.md; GPT-6 Luna; sha256 b474561a75d5b9c594982115a4b57fad7d04013f7ca7ad6b251592db5571d0b9) -->
# PR 664 — ordinary review A (independent)

**Reviewer/context:** GPT-6 Luna ordinary reviewer A, fresh context; did not author, direct, or remediate the candidate.
**Candidate:** `0cdcff749ced72ef0e0f664b3df5a3f03e970213`
**Comparison base:** `00c6c82e4fe44f443f51be755c8b04febd32c35d`
**Verdict:** BLOCKED — do not merge this head.

## Scope actually checked

Read the repository authority/operating documents (`AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, active mission, SDLC), the request-type and intake specifications, data model, attachment contract, RBAC, audit actions, event keys, and the decision-log entries governing D5 flag reads, dependency approval, and the recorded attachment redirect exception. Confirmed checkout `HEAD` equals the reviewed SHA and the worktree was clean. Reviewed the full 73-path diff/name inventory; deeply traced the intake API and policy/routes, repository transaction paths, attachment upload/reach/transfer/download paths, canonical domain validation/visibility, web fetchers and portal/editor/triage routes, plus the atomic conversion and feature-gate test sources and CI/configuration changes. No edits or tests were made in this review.

Reviewed the important acceptance-conversion path: request type/version and organisation-catalogue anchoring, transactional `feature.intake` recheck under share locks, submission row serialization, destination project/type/org validation, native mapping and unmapped-description construction, SLA pin/backdating and first response, attachment/participant transfer, public message/comment transfer with original timestamps, watcher creation, accepted state, audit and outbox writes. Also checked portal requester scoping and post-conversion attachment reach/visibility and triage routes. Existing private hosted receipts and Linux visual acquisition were treated as evidence tied only to their recorded source; they do not establish current-head acceptance.

## Blocking findings

1. **Current exact-head required CI is not green.** Root-provided raw hosted evidence for exact `0cdcff7` shows required G8 job `114582601846` failed during the portal build before visual tests: Rolldown cannot resolve `@taskdesk/domain` from `apps/web/src/lib/intake-validation.ts`. The Linux acquisition built through the full Turbograph graph and passed its two visual snapshots, but that is not the CI build path and does not cure the failure. The candidate therefore has an unresolved required-check failure at this SHA. Fix the CI graph/build contract in a new candidate and obtain fresh required checks on that exact SHA.

2. **Request-type DELETE still depends on an unresolved owner contract.** The feature spec says DELETE is refused unless unpublished and separately refuses types with submissions, while this implementation exposes deletion from the editor and implements deletion for unpublished/no-submission types (`apps/api/src/intake/repository.ts::deleteRequestType`, `apps/api/src/intake/index.ts` DELETE route, and `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/request-types.tsx`). The assigned review context explicitly reports the pending OWNER request-type DELETE pending-action confirmation contract. This review cannot infer the required pending-action behavior or treat an author-plan label of “DELETE hold” as owner approval. Resolve and record the owner contract and align implementation/UI before acceptance.

## Non-blocking observations

- The core conversion is structured as a single DB transaction, with the submission locked and the project row locked at the counter-compatible mode. The relevant audit/outbox writes are within that transaction. I found no independent defect in the conversion transaction during this review.
- Portal submission and attachment paths constrain by authenticated requester/person and current intake flag; attachment download additionally requires customer visibility and ready state. Triage attachment listing is capability-gated, and transfer updates the parent while preserving the visibility bit. No cross-requester or cross-organisation leak was established by source inspection.
- The canonical domain package is correctly used for visibility and validation under the directly recorded internal-dependency approval. The current CI resolution failure is an integration/build-graph issue, not a reason to duplicate those semantics in web code.
- Prior hosted records named in the assignment are not current acceptance: earlier 667-hosted evidence predates this candidate; the latest 0cd hosted run has the G8 failure above. This reviewer did not run a DB, Docker, browser, build, or test suite and makes no live-journey, image, full-browser, or stage-gate claim.

## Required next step

Remediate the current CI dependency-graph failure and resolve the explicit request-type DELETE owner contract. Then review the changed exact head and rerun required checks. Ordinary panel clearance and the separately required GPT-6 Sol review remain outstanding.
<!-- END REPORT (sha256 b474561a75d5b9c594982115a4b57fad7d04013f7ca7ad6b251592db5571d0b9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-b-luna.md; GPT-6 Luna; sha256 74d76906aa59c39afebbee0bd680c2cf67e739fd074654de471c6f63c9d4b2db) -->
# PR #664 ordinary review — current panel B

- **Role:** Ordinary reviewer B of 3 required for broad intake integration
- **Model:** GPT-6 Luna (assigned review tier; exact serving build/version was not exposed to this context)
- **Reviewed head:** `e0d8032463e0fa323626a498407f765646fb83f4`
- **Tree:** `82c32f7040557f8ef490d5242ae7ac1abe89a2d4`
- **Comparison base:** `00c6c82e4fe44f443f51be755c8b04febd32c35`
- **Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate. This verdict is independent of the separately dispatched panel-A report.
- **Verdict:** **BLOCK** — two request-type deletion contract/runtime defects need resolution before this candidate clears ordinary review.

## Scope checked

Read the repository authority and workflow guides (`AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, active status and decision log), intake and request-type specifications, attachment and portal specifications, RBAC/pending-action/event/audit/data-model contracts, and the relevant ADR/review references. Inspected the changed API route and policy, intake persistence and conversion paths, attachment upload/reach controllers, portal and agent route/fetcher flows, permission fixture entries, and changed CI workflow/checker/test hunks. Confirmed the checkout is at the exact head/tree above and clean.

No tests or runtime reproductions were run in this review. The dispatch packet reports 155 existing tests passing; I did not independently reproduce that result. I did not verify browser workflows or hosted CI on this exact SHA.

## Blocking findings

1. **Request-type deletion bypasses the mandatory pending-action approval flow.** The new `DELETE /api/request-types/{id}` route returns `200` and invokes `deleteRequestType` directly; the agent settings screen calls that endpoint directly from its Delete button. The route has no pending-action middleware or request/approval handling. The owning pending-action contract says every user-initiated `DELETE` creates a pending action and performs no deletion until the requester approves it (`docs/01-architecture/pending-actions.md` PA-1/PA-2 and API table); RBAC repeats that every user-initiated `DELETE` returns `202` with a pending action (`docs/01-architecture/rbac.md` § Deletion is never immediate). This makes a new destructive route an exception to a security control without a documented exception or owner decision. See [the direct route](apps/api/src/intake/index.ts#L449) and [the direct UI action](apps/web/src/routes/agent/_layout/_authenticated/agent/settings/request-types.tsx#L847).

2. **Even the direct deletion path cannot commit because its audit action is unregistered.** `deleteRequestType` deletes the row and then appends `request_type.deleted` in the same transaction. `appendAuditLog` rejects actions absent from both `AUDIT_ONLY_ACTIONS` and `EVENT_KEYS`, so the throw rolls back the delete. The candidate adds `request_type.created`, `.updated`, `.published`, and `.unpublished` to the audit-only registry and authoritative audit-trail catalogue, but omits `.deleted` while the repository writes it. The new DELETE route therefore fails at runtime for an otherwise deletable unpublished type. See [the writer](apps/api/src/intake/repository.ts#L502), [the registry](apps/api/src/audit/actions.ts#L53), and [the documented lifecycle catalogue](docs/03-features/audit-trail.md#L233).

## Non-blocking observations and residuals

- The inspected request-type publication path snapshots form schema/version and submission creation revalidates catalogue membership, current published version, enabled intake flag, and submitted data inside the transaction. Conversion pins the submitted snapshot, performs creation/thread/attachment/participant transfer and state transition in one transaction, preserves message timestamps, and emits audit/outbox/activity writes in that transaction.
- Submission attachment reach checks are bound to the requester or triage workspace, enforce the intake flag, check parent association, and limit portal downloads to customer-visible ready attachments. The upload path locks the submission and rechecks mutable state before inserting a pending attachment; completion rechecks ownership/state and verifies size and magic bytes.
- The changed CI job now builds `@taskdesk/web` and transitive workspace dependencies with `pnpm build --filter=@taskdesk/web... --force`; the G8 checker pins that command, and the new negative test replaces it with permissions-only preparation and expects failure. This is directionally aligned with the reported earlier build-order failure. I did not run the checker or inspect a hosted G8 result for this head.
- URL-backed selection/filter state and error/retry affordances are present in the inspected intake screens. Browser behavior remains unverified here; the dispatch packet explicitly says the Linux visual captures are mocked and no live workflow/image proof is available.
- Required-file semantics, custom-field mapping, and God Mode catalogue assignment remain explicitly held. This report does not treat those holds as accepted feature completion or ask the implementation to invent their behavior.
<!-- END REPORT (sha256 74d76906aa59c39afebbee0bd680c2cf67e739fd074654de471c6f63c9d4b2db) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-b-luna-base-pin-addendum.md; GPT-6 Luna; sha256 3d806a123918c81c01fb1f5f40daca9305bc0f91bccffca2c1eb56bb065775f7) -->
# PR #664 reviewer-B factual addendum — base pin

- **Parent report:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-b-luna.md`
- **Parent report SHA-256:** `74d76906aa59c39afebbee0bd680c2cf67e739fd074654de471c6f63c9d4b2db`
- **Reviewed head in parent report:** `e0d8032463e0fa323626a498407f765646fb83f4`
- **Correction:** The parent report's comparison-base field omitted its final `d`. The full comparison base is `00c6c82e4fe44f443f51be755c8b04febd32c35d`.
- **Verification:** `git rev-parse 00c6c82e4fe44f443f51be755c8b04febd32c35d` returned that exact 40-character object ID during the original review checkout and when this addendum was prepared. The object is the accepted comparison base cited in the dispatch.

This corrects only the base-pin transcription. It does not alter or repeat the review verdict.

## Additional provenance and disposition

The conductor subsequently supplied provenance for the earlier Thomas-approved audit-only action set in frozen commit `59807831d2`, which includes `request_type.deleted`. The current candidate does not carry that approved key into `apps/api/src/audit/actions.ts` or the audit-trail catalogue. Therefore the parent's audit finding remains a candidate omission and runtime blocker; no new audit-vocabulary owner decision is needed to restore the already-approved key.

The separate pending-action finding also remains open. That earlier audit-key approval does not approve immediate request-type deletion or create an exception to the pending-action contract. The candidate's direct `DELETE` path still needs an owner-approved contract resolution and independent review before the original BLOCK verdict can change.

**Authored by:** Independent ordinary reviewer B, GPT-6 Luna tier assignment; exact serving build/version unavailable in this context.
<!-- END REPORT (sha256 3d806a123918c81c01fb1f5f40daca9305bc0f91bccffca2c1eb56bb065775f7) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-b-luna-source-pin-correction.md; GPT-6 Luna; sha256 695f4dcc33ff2bd2679128ad187cb9574fb270e951b515e25b4f640f63dc88b6) -->
# PR #664 reviewer-B provenance correction — approved audit-action source

- **Related parent report:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-b-luna.md`
- **Related base-pin addendum:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-b-luna-base-pin-addendum.md`
- **Correction:** The base-pin addendum's phrase `frozen commit 59807831d2` was an incorrect combination of PR number and commit prefix. The source is **PR #598, commit** `07831d2f7967adb7156158e30eee376633869d4e`.
- **Verification:** `git rev-parse 07831d2f7967adb7156158e30eee376633869d4e` returned that exact object ID. Its `docs/07-planning/decision-log.md` entry dated 2026-10-07, “Register request-type and intake triage audit actions,” says Thomas approved `request_type.created`, `request_type.updated`, `request_type.published`, `request_type.unpublished`, `request_type.deleted`, `submission.claimed`, and `submission.duplicate`, registered in the audit-trail catalogue and written with their mutations.

This corrects only the source pin in the earlier provenance addendum. The finding remains that the reviewed candidate omitted the already-approved `request_type.deleted` key from its audit-action registration, making its deletion transaction fail. The separate pending-action contract finding and the original BLOCK verdict remain unchanged.

**Authored by:** Independent ordinary reviewer B, GPT-6 Luna tier assignment; exact serving build/version unavailable in this context.
<!-- END REPORT (sha256 695f4dcc33ff2bd2679128ad187cb9574fb270e951b515e25b4f640f63dc88b6) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/664-current-panel-c-luna.md; GPT-6 Luna; sha256 fce69e153a8899d9987104ba620377b4cfa23cc6bcae9eccbe5d1d4fee9613dd) -->
# PR #664 — Current panel C ordinary review

- **Reviewer:** GPT-6 Luna, fresh independent context (panel C of three); did not author, direct, or remediate this candidate.
- **Candidate:** `e0d8032463e0fa323626a498407f765646fb83f4`
- **Comparison base:** `00c6c82e4fe44f443f51be755c8b04febd32c35d`
- **Verdict:** **BLOCKED** — two concrete UI defects and an incomplete route/screen evidence map remain.

## Scope checked

Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the current status snapshot, request-types/catalogue, intake-queue and customer-portal specs, screen inventory, definition of done, relevant decision-log entries and owning review findings. Inspected the full candidate file list and the route/search helpers, generated route metadata, intake fetchers, four implemented route components, portal visibility/validation helpers, permission registry entries and fixture, visual manifest/spec, inventory/visual-scope checkers, relevant integration tests, CI changes and lockfile dependency change. Verified the worktree is clean and HEAD equals the reviewed SHA. Treated `origin/main` at the given base as comparison base; the object is locally present as `00c6c82e`.

## Findings

1. **[P1] Portal catalogue selection disappears as soon as the search no longer matches it.** In `apps/web/src/routes/portal/catalogue.tsx`, `selected` is derived from the filtered `entries` returned for the current `q` (`entries.find(entry => entry.key === key)`). The editor route intentionally preserves both `q` and `key` while the user types. If a customer opens a type then edits or clears the search so its name no longer matches, `selected` becomes undefined and the page switches back to the results list; the URL still carries `key`, so reload reproduces the same unusable state and the in-progress form is inaccessible. Load the selected type independently of the filtered result set, or clear selection explicitly when the query changes. This also breaks deep links with a valid selected key plus a nonmatching query.

2. **[P2] Primary catalogue/submission/triage load failures have no recovery action, and triage presents queue failure as an empty queue.** The catalogue and portal submission pages render an error alert but provide no retry button for their primary query (`catalogue.isError` and `page.isError`). On the agent triage page, `queue.isError` shows the generic alert, then `queue.isLoading` is false and absent data becomes `rows=[]`, so it also renders the normal “no requests” empty state. A transient API failure therefore looks like a valid empty queue and none of these main reads can be retried from the screen. Keep error and empty states mutually exclusive, and expose retry for these primary reads. Attachment-list retry exists and is not implicated.

3. **[P2] The implemented screen set is not represented by the inventory or G8 visual manifest.** The candidate registers `/catalogue` and `/submissions/$ref` in the portal route tree and marks the triage and request-type list rows in progress, but the screen inventory has no catalogue or portal submission screen rows. It still identifies staff submission detail as `/agent/submissions/{ref}` while the implemented detail is query state at `/agent/triage?state=…&ref=…`; it still lists the request type editor at `/agent/settings/request-types/{id}` while the implemented editor is `/agent/settings/request-types?requestTypeId=…`. The visual manifest adds only two agent screens; neither portal screen has a visual entry/baseline. `pnpm check:inventory` passes because it checks in-progress/complete inventory paths against generated route trees and permits other generated routes as outside v2 inventory, so it does not establish that these implemented screens are catalogued or visually covered. Update the canonical inventory to describe the actual screen/URL state and include the implemented portal routes and G8 coverage before claiming the screens are inventoried/covered.

## Verification and limits

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/lib/routes.test.ts src/lib/intake-validation.test.ts src/lib/intake-visibility.test.ts` — **passed**, 3 files / 23 tests.
- `pnpm check:inventory` — **passed**, reporting 45 generated routes, 8 active inventory routes, 107 planned URLs and 37 generated routes outside active v2 inventory. Its pass does not address finding 3.
- `git diff --check origin/main..HEAD` — passed.
- No browser session, database, image build, runtime, or end-to-end workflow was exercised in this independent review. The two added Linux screenshots are agent-side mocked visual tests; they do not supply portal screen evidence.
- This is the ordinary panel-C review only. It is not the full panel verdict, security review, CI acceptance, browser acceptance, or merge authorization.
<!-- END REPORT (sha256 fce69e153a8899d9987104ba620377b4cfa23cc6bcae9eccbe5d1d4fee9613dd) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-700c-ecac-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 5fc9645f90f36a4886809af4a0786a7bd23f81698ba44ba94911e83c64422773) -->
# PR #664 ordinary review (Claude Sonnet)

- Reviewer model: Claude Sonnet (fresh independent ordinary-review context)
- Reviewed head: ecacbafa38b737c352f5f0cc4b05baf45448bfa2 (HEAD confirmed in the worktree)
- Base: 700c0e5517932c73fc9f8852860b5881b10c3cfe
- Range: 10 commits, 17 files, +913/-47

## Files examined
apps/api/src/{index.ts,portal-client-routes.ts,auth.ts,intake/index.ts,utils/csrf-protection.ts,policy-registry.ts (storage entries)}, packages/libs/src/{hono.ts,hono.test.ts}, tests/api/{two-entry-host,csrf-portal-origin,portal-attachment-storage}.test.ts, tests/api-integration/intake-triage-actor.test.ts, tests/e2e/{intake-primary-journey.spec.ts,scripts/seed-intake-primary.ts,helpers/mfa-csrf-app-fixture.ts}, docs/01-architecture/security-model.md, docs/03-features/customer-portal.md, docs/07-planning/decision-log.md, apps/web/src/routeTree.portal.gen.ts (fullPaths), apps/web/vite.config.ts / package.json (portal mode).

## Tests run
Sandbox forbids writes in the worktree and local port binding; ran with `--configLoader runner`.
- packages/libs src/hono.test.ts: 1 file, 11/11 pass.
- apps/api vitest (tests/api): csrf-portal-origin (pass), portal-attachment-storage (pass), two-entry-host: 19 of 20 pass across the 3 files. The one failure, "rejects repeated raw Host fields at the actual Node HTTP boundary", is `listen EPERM 127.0.0.1` (sandbox), an unrelated pre-existing test, not caused by the diff. All new two-entry-host tests passed.
- Not run: tests/api-integration/intake-triage-actor.test.ts (needs Postgres/testcontainers), e2e (browser/Docker barred).

## Verification of claims
- Portal client-route allowlist (portal-client-routes.ts, index.ts:599-604): matches `fullPaths` of the generated tree ('/', '/catalogue', '/sign-in', '/submissions/$ref'); test enforces equality. Segment matcher rejects empty segments, trailing slash, extra/missing segments. GET and HEAD verified; non-GET/HEAD unaffected. Order is correct: static asset first, then dot-in-last-segment 404, then allowlist, so missing assets still 404 and agent files never served. `c.req.path` is the raw (not decoded) path so encoded segments cannot smuggle a different route. Agent host unchanged. Matches decision-log and CP-19 text.
- CSRF (csrf-protection.ts:232-249): placed after the apiKey exemption and the null-session pass-through, before the agent branch. Requires portal cookie name present, exact configured portal Origin (or same-origin Referer), `appOrigin === "portal"`; fetch-metadata fallback disabled; duplicate/malformed/null origins refused by existing sourceOrigin. Agent-host replay of a portal session refused. Agent behaviour unchanged (`expected` defaults to agent origin). Client: `agentCsrfToken` defaults to `MODE !== "portal"`; `build:portal`/`dev:portal` use `--mode portal`, so the agent app is unaffected.
- Storage carve-out (index.ts:344-372, 707-719): method + exact path + key regex with no `/` or `..` inside segments; `c.req.query("key")` is decoded, so `%2e%2e` is caught by `includes("..")`. Host-guard refactor is behaviour-preserving for previously allowed routes. HMAC token still binds key/size/expiry (tests: swapped key, oversize, forged token all 400; work-item and non-submission keys 404 on the portal host).
- Triage actor (intake/index.ts:212-222): all five call sites switched (claim, accept, duplicate, decline, staff message). Remaining `c.get("userId")` uses are workspace-access checks, request-type admin (out of scope) or portalIdentity. `getActiveStaffPerson` filters side=staff and active; 403 when none. Fix is correct.
- Seed: shared `customer` org role, find-or-create, no capabilities; fine.

## Findings

### Blocking
None.

### Non-blocking
1. Triage test gap: only claim and decline are exercised over HTTP (tests/api-integration/intake-triage-actor.test.ts). accept, duplicate and staff-message share the helper but have no regression test; no test for the 403 "Active staff person required" path or the API-key-acts-as-owner claim in the helper doc comment (intake/index.ts:212-217).
2. Storage test gap: HEAD on `/api/storage/filesystem-download` is admitted (index.ts:363) but untested; also no test for duplicate `key` params or a `%2e%2e` encoded key. Correct by reading; low risk.
3. CSRF test is a unit probe with mocked session context (tests/api/csrf-portal-origin.test.ts); no createApp-level test with a real portal session. The e2e journey covers the real flow.
4. Route-tree parity test parses `fullPaths:\s*([^\n]+)` from generated code (tests/api/two-entry-host.test.ts). If a formatter wraps that union the test fails loudly (equality assertion), not silently. Low severity.
5. Behavioural edge, documented and tested as intended: `/sign-in/` (trailing slash) and `/Sign-In` (case) 404 on reload although TanStack router is lenient client-side. Matches decision-log wording; noted for product awareness.
6. Docs: customer-portal.md edit leaves an over-long line ("...with one narrow exception: the signed filesystem-driver") inconsistent with the file's wrap width. Cosmetic.
7. e2e diagnostics record host/pathname/status only, no secrets, file mode 0600. The 30 s race does not cancel the sign-in promise but is safe. Fine.
8. Key regex permits a bare "." filename segment; harmless because the key is HMAC-bound and server-minted.

## Residual risk
- Integration and e2e suites not run by me. The CSRF, host guard and storage carve-out surfaces are security-scope and need the separate Sol review; I focused on correctness, not an exhaustive security audit.
- Interaction of portal CSRF with any future non-cookie portal credential is unexamined.

Verdict: APPROVE
<!-- END REPORT (sha256 5fc9645f90f36a4886809af4a0786a7bd23f81698ba44ba94911e83c64422773) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-700c-ecac-ordinary-2-sonnet.md; Claude Sonnet 5.5; sha256 2a309b78737717d1744cdaeffcb347eb9d4f1f493623f2e33ea14af20a7dd22c) -->
# PR #664 ordinary review 2 (Intake)

**Reviewer model:** Claude Sonnet (fresh independent ordinary-review context, second reviewer)
**Reviewed head:** ecacbafa38b737c352f5f0cc4b05baf45448bfa2 (confirmed `git rev-parse HEAD`)
**Base:** 700c0e5517932c73fc9f8852860b5881b10c3cfe
**Worktree:** /Users/heinthura/.codex/worktrees/delivery-conductor-20261011/Ticketing.v2
Existing review notes were not read before this analysis.

## Files examined
apps/api/src/index.ts, apps/api/src/intake/index.ts (+ grep of whole intake module and repository.ts actor paths), apps/api/src/portal-client-routes.ts, apps/api/src/utils/csrf-protection.ts, apps/api/src/auth.ts, apps/web/src/routeTree.portal.gen.ts (fullPaths), packages/libs/src/hono.ts + hono.test.ts, docs/01-architecture/security-model.md, docs/03-features/customer-portal.md, docs/07-planning/decision-log.md, tests/api/{csrf-portal-origin,portal-attachment-storage,two-entry-host}.test.ts, tests/api-integration/intake-triage-actor.test.ts, tests/e2e/intake-primary-journey.spec.ts, tests/e2e/scripts/seed-intake-primary.ts, tests/e2e/helpers/mfa-csrf-app-fixture.ts. Commit messages read.

## Tests run
Run from apps/api with `vitest run --config vitest.config.ts --configLoader runner` (default config loader hit a sandbox EPERM writing .vite-temp; the loader flag is not a code change).
- tests/api/csrf-portal-origin.test.ts: 4 tests, pass.
- tests/api/portal-attachment-storage.test.ts: 5 tests, pass.
- tests/api/two-entry-host.test.ts: 11 pass, 1 FAIL ("rejects repeated raw Host fields at the actual Node HTTP boundary", pre-existing test, unrelated to this diff). Cause is sandbox `listen EPERM 127.0.0.1` (this reviewer's sandbox forbids port binding), not a code defect. All new two-entry tests (shell for registered routes, 404 near-misses, non-GET, 503 missing root, allowlist == route tree) passed.
- Combined: 3 files, 20 tests, 19 passed, 1 sandbox-failed.
- packages/libs/src/hono.test.ts (packages/libs vitest.config.ts): 1 file, 11 tests, all pass.
- Not run: tests/api-integration/intake-triage-actor.test.ts (needs Postgres/Docker, forbidden).

## Mental mutation checks
1. Revert triagerPersonId (pass c.get("userId") again): intake-triage-actor "claims ... over HTTP" asserts 200, claimedBy === staff.id (the seed also asserts staff.id !== user.id) and audit actorId; the FK violation / mismatch fails it. Non-vacuous. Caveat: only claim and decline are exercised.
2. Remove the portal Origin branch in csrf-protection.ts: a portal session with cookie falls to the agent path (no agent cookie), so missing/null/agent/foreign Origin requests would return 200 instead of 403; "refuses missing, null, agent and foreign origins" fails (6 header sets, asserts 403 and body). Non-vacuous.
3. Revert registerStaticServing portal branch to c.notFound(): "serves the portal shell" fails. Revert to serveIndex for all: "keeps unknown ... at 404" fails. Allowlist drift is caught by the route-tree equality test.
4. Remove the key regex (admit any key): the work-item key test would write via the portal host and fail (expects 404, file absent). Revert the whole carve-out: the upload test fails (404).
5. hono.ts agentCsrfToken: test asserts no csrf-token request when false. Default-true not pinned by a dedicated test; see non-blocking 4.

## Behaviour review
- triagerPersonId: throws HTTPException(403, "Active staff person required"). All five triage writes (claim, accept, duplicate, decline, staff message) use it. The accept path calls claimSubmission with the same person id, correct. Remaining `c.get("userId")` uses in intake/index.ts are correct: reach/validateWorkspaceAccess (user id), portalIdentity(userId), createSubmission/listOwnSubmissions (portal, resolve person internally), request-type CRUD (see non-blocking 2). No handler in the triage path passes a user id where a person id is expected.
- portal-client-routes.ts: exact-segment matching, empty segments rejected, `$ref` matches one segment, trailing slash rejected, extension paths fall through earlier. Serving is behind host selection and /api denial (order unchanged). Agent files never served on portal.
- Portal storage carve-out: method/path exact, key regex anchored, `..` rejected, HMAC handler unchanged. The `portalAllowed` refactor is behaviour-equivalent for previous cases (non-API non-GET still denied).
- CSRF portal branch: requires session.portal === "customer" AND portal cookie present; exact Origin, else exact Referer; no fetch-metadata fallback; also requires appOrigin portal. The default expected origin for existing callers is unchanged (default param = agent origin). requireSameOriginIssuer unchanged.
- hono.ts: `agentCsrfToken ?? import.meta.env.MODE !== "portal"`; for existing callers (no option, non-portal mode) needsCsrf is exactly as before.

## Docs / spec
- customer-portal.md CP-19 and security-model.md match the code (storage carve-out key shape, exact portal Origin/Referer, 403 csrf_origin_invalid, portal build skips agent token, shell for registered routes).
- decision-log.md: diff has only added lines (0 removed), entry inserted at top (newest first). Insert-only confirmed. It names what it supersedes (CP-19 "unmatched portal paths are 404").
- docs/03-features/intake-queue.md is not in this diff and does not record that the triage actor is the staff person id (non-blocking 6).

## E2E / seed hygiene
- Seed does not log credentials (no console output; password is a random UUID, hashed, returned only in-process). Shared `customer` org role with empty capabilities, get-or-create; no capability widening.
- Assertions not weakened: staff-triage-load now scopes to the submission detail region named `Submission ${ref}` (stricter); sign-in uses label "Password" exact. Only timeouts were raised (120 s test, 30 s phase).
- Diagnostics: file mode 0600, written only on failure into the private fixtureDir; requests recorded as host/pathname/status only (no query, headers, bodies).

## Findings
Blocking: none.

Non-blocking:
1. tests/api-integration/intake-triage-actor.test.ts: no test for the new 403 path (user without an active staff person) and none for accept, duplicate or staff message routes, which also changed. A later revert of those call sites would not be caught. Suggest a 403 test plus one over message/accept.
2. apps/api/src/intake/index.ts:858-912 (request-type create/update/publish/delete) pass `c.get("userId")` as audit `actorId` with `actorType: "person"` (repository.ts ~120, 402-506). audit_log.actor_id has no FK so nothing fails, but it is inconsistent with the triage fix. Pre-existing; follow-up.
3. The 403 message differs from the equivalent users route (apps/api/src/instance/users/index.ts:621 "Forbidden" vs intake/index.ts:219-220 "Active staff person required"). Same status; harmless.
4. packages/libs/src/hono.test.ts: no explicit test that the default (no option, non-portal mode) still requests the CSRF token; existing tests likely cover it (11 pass), but an explicit assertion would pin the "default unchanged" claim.
5. packages/libs/src/hono.ts (~176): with agentCsrfToken false, `redirect: "error"` is also no longer applied to unsafe portal requests (tied to needsCsrf). Low risk; note for intent.
6. docs/03-features/intake-queue.md does not document that triage actors are staff person ids (doc gap only).
7. e2e diagnostic includes `bodyTextStart` (first 120 chars of page text) and headings, so "metadata only" is slightly loose; fixture data only, 0600, failure only.
8. tests/api/portal-attachment-storage.test.ts: the `..` traversal key case is already rejected by the regex (slashes), so the `includes("..")` guard (e.g. a filename ending `..`) is not independently tested.

## Residual risk
- The integration test (needs Postgres) and the e2e journey were not run by this reviewer; verified by reading only.
- The two-entry-host Node-HTTP-boundary test could not run in this sandbox (port binding denied).
- Portal CSRF depends on session.portal === "customer" being set by the session resolver; verified only against csrf-protection.ts and its unit test with a synthetic session.
- Percent-encoded segments (e.g. /submissions/%2e) match `$ref` and receive the shell; harmless.

Verdict: APPROVE
<!-- END REPORT (sha256 2a309b78737717d1744cdaeffcb347eb9d4f1f493623f2e33ea14af20a7dd22c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-700c-ecac-security-opus.md; Claude Opus 5.5; sha256 1149976767d4c49478d5570b74f5af35c55bcdc3537f01a198e4374ee7015c9a) -->
# PR #664 (Intake) — security review

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context). Did not author, direct or remediate this change.
- **Candidate SHA:** `ecacbafa38b737c352f5f0cc4b05baf45448bfa2` (worktree `git rev-parse HEAD` confirmed)
- **Base:** `700c0e5517932c73fc9f8852860b5881b10c3cfe` (`git merge-base` with HEAD == base)
- **Worktree:** /Users/heinthura/.codex/worktrees/delivery-conductor-20261011/Ticketing.v2 (read-only; no edits, commits or pushes)

**Reviewed head:** `ecacbafa38b737c352f5f0cc4b05baf45448bfa2`

## Files / surfaces examined

Full diff of the 17 changed files, with these read in context:

- `apps/api/src/utils/csrf-protection.ts` (whole file), `apps/api/src/auth.ts` (origin config L247-279, Better Auth cookie names L1092-1104)
- `apps/api/src/utils/authenticate-api-request.ts` (how `session` / `apiKey` are set; customer host refuses bearer/API key)
- `apps/api/src/index.ts`: host gate (L344-372, L700-720), `registerStaticServing` (L553-608), authGuard → CSRF order (L1330-1352), filesystem upload/download handlers (L943-1086)
- `apps/api/src/policy-registry.ts` (storage routes are `public: true`, token-authorised)
- `apps/api/src/storage/filesystem.ts` (HMAC sign/verify, `assertSafeRelativeKey`, `resolveWithinRoot`; not changed by this PR)
- hono `validator.js` query handling (a repeated `key` becomes an array, which zod rejects)
- `apps/api/src/portal-client-routes.ts`, `apps/web/src/routeTree.portal.gen.ts`
- `apps/api/src/intake/index.ts` (triage handlers), `apps/api/src/intake/policy.ts`, `apps/api/src/instance/users/repository.ts#getActiveStaffPerson`, `personTable` schema (`person_user_unique`)
- `packages/libs/src/hono.ts` (`createApiFetch`), `apps/web/package.json` / `vite.config.ts` (portal build mode)
- Test/fixture diffs: `tests/e2e/helpers/mfa-csrf-app-fixture.ts`, `tests/e2e/scripts/seed-intake-primary.ts`, `tests/e2e/intake-primary-journey.spec.ts`
- Docs: `security-model.md` CSRF row, `customer-portal.md` CP-19, `decision-log.md` new entry

## Tests and reproductions actually run

1. `apps/api`: `vitest run tests/api/csrf-portal-origin.test.ts tests/api/portal-attachment-storage.test.ts tests/api/two-entry-host.test.ts` → **3 files, 20 tests passed**.
2. `packages/libs`: `vitest run src/hono.test.ts` → **1 file, 11 tests passed**.
3. Reviewer-written adversarial probe (scratchpad only, not committed; separate vitest config, same `tests/api/setup.ts`) → **1 file, 5 tests passed**. Covered:
   - **CSRF, portal session.** These were refused with 403: Origin with a trailing slash, uppercase scheme/host, a missing port, `portal.localhost:5174.evil.com`, userinfo, a comma-joined duplicate Origin, Referer `host.evil.com`, Referer `@evil.com`, a Referer that only contains the portal URL in its path, `Origin: null` with a valid Referer, and a foreign Origin with a valid Referer. These were accepted with 200: the exact portal Origin, and a portal Referer with a path and query. With both cookies present, the agent Origin is refused and the portal Origin is accepted. A customer session that carries only the agent cookie is refused. Without any cookie, a customer session passes (see N1).
   - **CSRF, agent session unchanged.** An agent session with the agent cookie plus a portal cookie, and no token, returns `csrf_token_missing`. An agent session sent with the portal Origin returns 403.
   - **Portal storage gate.** All of these return 400 or 404 on the portal host and nothing is written outside the root: `%2e%2e%2F`, double-encoded `%252e`, `..%5C` / `\..\`, an encoded `work-item` key, `%00` / `%0a` suffixes, an extra path segment, and a leading `/`. A repeated `key=` parameter (submission key, then work-item key) does not return 204. POST, DELETE, trailing `/`, an uppercase path and `/api/storage/filesystem-upload` all return 404. A valid submission-key PUT returns 204 and HEAD download returns 200.
   - **`isPortalClientRoute`.** Edge cases tested: empty path, `//`, trailing `/`, empty `$ref`, an extra segment, `/api`, `/api/x`, unknown paths and case variants.

Not run: `tests/api-integration/intake-triage-actor.test.ts`, because it needs a private Postgres per lane, and this context was read-only/bounded. E2E/Playwright and Docker were not run, as instructed.

## Findings

### Blocking

None.

### Non-blocking

- **N1 — `apps/api/src/utils/csrf-protection.ts:236-253`.** The portal branch runs only when the `__Host-tdk_portal_session` cookie is present. A `session.portal === "customer"` with no recognised session cookie falls through to `if (!hasSessionCookie) return next()`. This cannot be reached today: the customer Better Auth instance resolves the session only from that exact cookie name (`auth.ts:1097-1101`), and the customer host refuses bearer and API-key credentials (`authenticate-api-request.ts:80-85`). It is a latent fail-open if a second session transport is ever added for the portal. Suggestion: key the portal branch on `session.portal === "customer"` alone. Probe confirms the current behaviour.
- **N2 — `apps/api/src/intake/index.ts:217-222`.** `triagerPersonId` returns 403 when there is no active staff person, but no regression test covers that path. The new integration test covers only the positive claim and decline cases. Authorization is unchanged or stronger: route policy `intake:triage` (workspace, row-scoped) still runs first. The lookup is keyed by the authenticated `userId`, and `person_user_unique` guarantees at most one person. Customers cannot reach these handlers because they are not portal routes and are host-denied. Suggest adding a negative test.
- **N3 — `apps/api/src/index.ts:353-354`.** The key regex allows a final segment of `.` (for example `.../attachment/<id>/.`). This cannot be exploited: the HMAC token binds the exact key, and `assertSafeRelativeKey` rejects `.` and `..` segments downstream. It is defence-in-depth only, so tightening it to require a non-dot-only filename is optional.
- **N4 — portal storage gate scope.** The gate filters only on key shape. It does not bind a key to a workspace, submission or tenant. That binding comes entirely from the HMAC token, which is minted after the policy checks in presign and `GET /api/attachments/{id}`. This matches the documented design (CP-19 carve-out). A portal customer cannot forge a token for another tenant's submission or for a work-item key. A work-item token presented on the portal host is refused by host, as the probe and the existing test show.

### Verified as stated

1. **Portal CSRF.** Exact-origin comparison uses `URL.origin` equality, so prefix tricks fail. `null` is refused. Origin wins over Referer. There is no Sec-Fetch fallback for unsafe requests. `appOrigin` must be `portal`. GET, HEAD and OPTIONS are exempt as before. The agent path is not weakened: the change only made `expected` a default parameter, evaluated at call time to the same agent origin. Before this change portal cookie sessions bypassed the CSRF middleware entirely, so this is a net strengthening. If `TASKDESK_PORTAL_URL` is unset, the portal origin falls back to `http://localhost:5174`, which fails closed for any real portal host.
2. **`agentCsrfToken`.** It defaults to `MODE !== "portal"`, and only `build:portal` / `dev:portal` use `--mode portal`. The agent and default builds keep the token flow unchanged. The portal build never calls `/me/csrf-token` (unit test passes).
3. **Portal storage carve-out.** It admits only exact PUT upload or GET/HEAD download paths. The key comes from the same decoded query parameter the handler validates. A repeated `key` is rejected by zod. The HMAC check still runs in the handler, and the routes stay sessionless. Every other agent API route remains host-denied.
4. **Portal SPA shell.** It serves only the portal's own `index.html` from the portal static root, and only for 4 allowlisted patterns. A test checks that list equals the generated portal route tree. `/api` paths are handled before the shell, so there is no API shadowing. There is no agent-file fallback, and non-GET/HEAD requests still return 404.
5. **Triage actor.** See N2. This is authorization-neutral or stronger.
6. **Fixtures.** Changes are test-only. The only new env is `TASKDESK_STORAGE_FILESYSTEM_ROOT` in the e2e fixture; `DISABLE_PASSWORD_REGISTRATION: "false"` was already present. No production default changed. The seed reuses a capability-less org-scoped `customer` role. The new e2e diagnostics record host, pathname and status only, with no query (where signed tokens live), headers, bodies or cookies, and the file is written with mode 0600. No credentials leak into artifacts.

## Residual risk / not checked

- Integration (Postgres), E2E and Docker image paths were not executed by this reviewer.
- The S3 storage driver path was not examined. The carve-out applies only to filesystem-driver routes.
- `Content-Type` on portal-origin downloads comes from the stored object. `Content-Disposition: attachment` mitigates rendering. Global `nosniff` or security headers were not re-verified for the portal host.
- Better Auth internals (whether cookie-name parsing is exact) were assumed from configuration, not traced in vendor code.

Verdict: CLEAR
<!-- END REPORT (sha256 1149976767d4c49478d5570b74f5af35c55bcdc3537f01a198e4374ee7015c9a) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-whole-d43d-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 7bf361dbc434b1995c0497e2f044a1eac932f1e764853877f6c43ac6cbe634f5) -->
# PR #664 whole-PR ordinary review, reviewer A

**Reviewer model:** Claude Sonnet (fresh independent ordinary-review context, reviewer A)
**Reviewed head:** d43de75b19548366dc55b993c0e2d12bdb749e36 (confirmed `git rev-parse HEAD`)
**Base:** 4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2 (`git merge-base HEAD origin/main`); 107 files, +21739/-361.
Read-only; no edits, commits, browsers or Docker. Prior review reports were NOT read (formed own view first); the PR body fetch failed (GitHub 502), so earlier-BLOCK resolution was not cross-checked.

## Files examined
API: `apps/api/src/intake/{index,repository,schema,policy}.ts` (read in full), `attachment/{index,policy,repository,require-submission-attachment-reach}.ts`, `attachment/controllers/{presign,complete}-submission-attachment.ts`, `audit/actions.ts`, `audit/audit-writer.ts` (validateAction), `auth.ts`, `utils/csrf-protection.ts`, `index.ts` (portal host carve-out, static serving), `portal-client-routes.ts`, `policy-registry.ts`, `work-item/native-event.ts`, `packages/libs/src/hono.ts`, `packages/domain/src/intake/{submission,request-type,index}.ts` and package.json.
Web: `routes/portal/{catalogue,sign-in}.tsx`, `routes/portal/submissions/$ref.tsx`, `agent/triage.tsx`, `agent/settings/request-types.tsx` (key sections), `fetchers/intake.ts`, `lib/portal-auth-client.ts`, `lib/intake-*.ts`, test files (counts/titles).
Other: decision-log additions, customer-portal/audit-trail doc diffs, i18n en-US + 18 locales (key audit), CI/package/lockfile diffs, e2e/integration test titles, UI probe `run-summary.txt` and probe spec (grep).

## Commands and counts
- `apps/api: vitest run --configLoader runner ../../tests/api/{csrf-portal-origin,two-entry-host,portal-attachment-storage}.test.ts`: 19 passed, 1 failed. The one failure is `two-entry-host` "raw Host fields at the actual Node HTTP boundary": `listen EPERM 127.0.0.1` (sandbox forbids port binding; environmental, not a code defect).
- `packages/domain: vitest run src/intake`: 1 file, 51 tests passed.
- `apps/web: vitest run` on portal routes, triage, request-types, intake-validation, intake-visibility, routes, src/portal: 9 files, 52 tests passed (run with sandbox disabled only because vite writes `.vite-temp` in the worktree).
- `tsc --noEmit` in apps/api (tsconfig.json) and apps/web (tsconfig.app.json): no diagnostics.
- Integration tests not run (need Postgres), as instructed.
- i18n script: every `t("ns:key")` in the five changed web files resolved against en-US.json; missing keys listed below. Locale parity: no locale lacks any new key (the 7 `_one` plural gaps in ja/zh/ko/id/vi pre-exist at base).

## Findings

### BLOCKING

**B1. Request-type DELETE can never succeed, and it is a held item.**
- `apps/api/src/intake/repository.ts:509` calls `appendAuditLog` with `action: "request_type.deleted"`. That action is not in `AUDIT_ONLY_ACTIONS` (`apps/api/src/audit/actions.ts:56-61` registers created/updated/published/unpublished only), is not in `audit-trail.md` (the diff adds only those four), and is not an event key. `audit-writer.ts:257` throws for unknown actions, so the whole delete transaction rolls back and `DELETE /api/request-types/{id}` returns 500 for every valid delete.
- No test exercises a successful delete: `tests/api-integration/intake-feature-gate.test.ts:66` only checks the flag-off 404. This is why the defect is invisible.
- Hold: the decision log (2026-10-12 sign-in decision) says "the separate request-type deletion decision remain[s] held/pending", and the decision-log line about universal deletion approval (every user-initiated deletion is a server-held `pending_action`) is not honoured by this immediate hard delete. The PR still ships the route (`intake/index.ts:462,910`), policy entry (`intake/policy.ts` DELETE), repository `deleteRequestType` (`repository.ts:481-517`), UI button (`request-types.tsx:961`), fetcher (`fetchers/intake.ts:89`), matrix and OpenAPI entries. Required: remove the delete surface from this PR (or obtain the owner decision and then register the audit action, add the spec text and a success-path test).

**B2. Customer attachment download is blocked on the portal host for the default filesystem driver.**
- `apps/api/src/index.ts:353` (`PORTAL_SUBMISSION_ATTACHMENT_KEY`) admits only `workspace/<id>/submission/<id>/attachment/<id>/<one-segment-file>`. After completion, `complete-submission-attachment.ts` stores a finalized key from `toFinalAttachmentObjectKey` (`storage/shared.ts:206`), shaped `.../attachment/<id>/final/<token>-<file>`. I confirmed with Node that the regex returns `false` for that shape and `true` only for the pre-finalize key. The 302 from `GET /api/portal/submissions/{ref}/attachments/{id}` points at `/api/storage/filesystem-download?key=<final key>` on the portal origin and is denied by host (404).
- The unit test `tests/api/portal-attachment-storage.test.ts` only uses pre-finalize keys; the e2e journey and the UI probe never click a customer Download (probe only asserts the row text). So this was never exercised.
- Related: `fetchers/intake.ts:310-325` and the `$ref.tsx` Download button call the fetcher with `void`, so the failure is an unhandled rejection with no error shown to the customer. Fix the regex (allow the `final/` segment, and add a finalized-key test), and surface download errors.

### NON-BLOCKING

1. Customer reply box is offered when it can only fail. `$ref.tsx:356` hides it only for declined/withdrawn. `transitionSubmission("reply")` allows only `clarifying` (domain `submission.ts`), so in `new` and `duplicate` states `postSubmissionMessage` returns 409 and the page shows the generic error. Show the reply form only for `clarifying` or `accepted` (IQ-13).
2. Download filename is the attachment id, not the file name (`fetchers/intake.ts:258,322`), so customers and staff get extension-less files.
3. i18n completeness. Keys used in code but absent from en-US and all 18 locale files (only `defaultValue` hides it): `portal:intake.fieldRequired`, `portal:intake.completeUpload`, `portal:intake.completeUploadError`, `portal:intake.attachmentListError`, `common:empty.select`, and in triage `retry`, `nextPage` (en defaults only). Hardcoded English in changed screens: `$ref.tsx:168` aria-label "Request details", "Priority", "(one file)", "KB", raw `actorType` and raw `state` shown to the user; `triage.tsx:207` "Submission status filter", raw state values as filter labels, `:300` "Loading details…", "Submission", "Destination project", "Work item type", "Choose a project", "Download", aria-label `Submission ${ref}`, raw `actorType`. `"Loading…"` is reused as the "Submitting…" label (`catalogue.tsx`). The probe itself noted the raw labels. Also the 109 new intake/requestTypes/portal keys are English text in every locale (placeholder state; acceptable only if that is the repo's convention).
4. Test gaps (non-vacuous where they exist, but narrow): there is no integration or e2e coverage for customer withdraw (and the claim race), decline as seen by the customer, duplicate link, clarify then reply, cross-customer/cross-org denial on `own_submission`, attachment presign/complete negatives, or request-type delete success. `$ref.test.tsx` has 2 tests (load error, header) and none for reply, withdraw, upload or download. The positive journey and atomic-conversion tests are good (races, hidden-field forgery, archive serialization, system-attributed auto-accept).
5. Staff attachment routes (`require-submission-attachment-reach.ts`, staff modes) do not convert a 403 to 404 as `submissionReach` in `intake/index.ts` does, so a non-member can distinguish an existing `SUB-n` (403) from a missing one (404). Same for `requestTypeCollectionScope`, which returns 404 "Intake is not enabled" before membership is checked.
6. Accept moves pending (never completed) attachments onto the work item (`convertSubmissionInTransaction`, attachment update), where they linger as `pending` if the customer never finishes the upload. The accept path does not check for this.
7. Presign/accept validation gaps (not exploitable): `createRequestType`/`updateRequestType` do not validate that `slaPolicyId`/`defaultAssigneeId`/`workItemTypeId`/`defaultProjectId` belong to the workspace (publish checks only type and project); a foreign SLA policy later makes every accept or auto-accept return 422; a nonexistent id gives an FK 500.
8. Portal catalogue draft persistence (`catalogue.tsx:144-152`): answers saved in `localStorage` keyed only by type key and version, so a different customer on a shared browser sees the previous draft after sign-out; `setItem`/`removeItem` are unguarded (throw in private mode/quota). The sign-in email is held in `sessionStorage` until success (acceptable, but never cleared on abandon).
9. No idempotency on `POST /portal/submissions` (a retried request after a network blip creates a duplicate). The button is disabled while pending, which covers the common case.
10. Auto-decline on clarification timeout (IQ-15) and the reminder-scan are not part of this PR; not claimed anywhere I saw, but the clarification window is therefore unenforced.
11. `portalOwnSubmission` includes a dead `void row;` and the portal download handler throws a plain `Error` (500) if the attachment disappears between reach check and handler; harmless race.
12. The portal submission page returns the work item's full description to the customer after acceptance (`findPortalSubmission`). Confirm against the customer-portal work-item visibility rules that nothing internal can enter the description after conversion.

## Verified OK (spot checks)
- State machine: claim (idempotent for same actor, 409 for another, optimistic version), accept (claim committed first per IQ-16a, FOR UPDATE, `no key update` project lock matching the counter update, conversion rolled back as one transaction, 409 on a lost race), duplicate (same-org check, watcher added), decline (reason mandatory, verbatim, state-guarded), clarify/reply via the domain function, withdraw (refused once claimed; conditional write on `claimed_by IS NULL`). Staff writes use the staff `person.id` (not user id), covered by `intake-triage-actor.test.ts`.
- Audit actions for submissions are registered via event keys; request-type lifecycle and `submission.claimed/duplicate` are added to the catalogue and doc together.
- CSRF for portal sessions uses an exact portal Origin; `csrf-portal-origin.test.ts` passes. Portal client-route allowlist is checked against the generated route tree. The filesystem-storage carve-out is limited by the HMAC token plus a key-shape check (apart from B2).
- Domain import for the web uses the browser-safe `@taskdesk/domain/intake` entry; dependency approved in the decision log; deps check updated accordingly.
- UI probe claims spot-checked against source: focus management, error/empty states, and the raw-label note match the code. The probe does not cover customer download or reply-in-new-state.

## Holds checked
- Request-type DELETE: **CROSSED** (see B1).
- Registration/invitations/typed-domain SSO: not implemented; sign-in is local email/password with TOTP/backup code using existing endpoints, matching the approved scope. No continuation redirect.
- Provider/admission changes: none seen.
- Required-file mapping: publish rejects required file fields and unsupported mappings (`repository.ts` publish) so it stays held; custom-field mapping rejected the same way; God Mode assignment: none (catalogue assignment rows are read-only here).
- MCP #607: none. Notification activation: none (events enqueued only). New capabilities/flags: none beyond `feature.intake`, `request_type:*`, `intake:triage` already in the spec.

## Residual risk
Integration, e2e and visual runs were not executed here; Postgres-dependent behaviour (locks, trigram suggestions, counters) was judged by reading. The `two-entry-host` Node-boundary test could not run in the sandbox. Earlier BLOCK reports were not consulted and may already cover items above. S3-driver download path (direct presigned URL) is not affected by B2 but was not examined.

Verdict: CHANGES REQUESTED
<!-- END REPORT (sha256 7bf361dbc434b1995c0497e2f044a1eac932f1e764853877f6c43ac6cbe634f5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-whole-d43d-security-opus.md; Claude Opus 5.5; sha256 99c6cedef61f14775c9b1ba3ee1f50b3411b4423dc7eeae3d0e6975a85303515) -->
# PR #664 (Intake) — whole-PR security review

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context)
- **Role:** independent security reviewer. I did not author, direct or remediate this PR. I worked read-only and made no edits, commits or pushes.
- **Candidate head:** `d43de75b19548366dc55b993c0e2d12bdb749e36` (confirmed as worktree HEAD at the start of the review)
- **Merge base (`git merge-base HEAD origin/main`):** `4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2`
- **Diff:** 107 files changed, +21739 / −361

**Reviewed head:** `d43de75b19548366dc55b993c0e2d12bdb749e36`

> **Concurrency note.** During this review another context committed `8677a154978ce3c3379051ca3fddc892110d9b6e` ("fix(intake): remove held request-type deletion from this candidate") on top of the reviewed head in the same worktree, at 21:59:58 +0630. It also left uncommitted edits to `apps/api/src/index.ts`, `tests/api/portal-attachment-storage.test.ts`, the triage and portal `$ref` UI, and new e2e probe files.
>
> All source findings below were read from committed `d43de75b` content. I read intake and attachment files that were unchanged between `d43de75b` and the working tree at the time.
>
> Because of the concurrent edits, I re-ran every recorded test against a clean `git archive d43de75b` export. The node_modules are symlinked from the worktree, and `packages/**` is identical between `d43de75b`, HEAD and the working tree. This verdict is bound to `d43de75b` only. It does not review `8677a154`.

## Surfaces examined

- **Intake API.** Read in full:
  - `apps/api/src/intake/index.ts`: routes, reach middleware, portal identity middleware and the triager person mapping.
  - `apps/api/src/intake/policy.ts`
  - `apps/api/src/intake/schema.ts`
  - `apps/api/src/intake/repository.ts`: request-type create, update, publish, unpublish and delete; the portal catalogue; createSubmission and its visibility logic; atomic conversion; accept; duplicate; findSubmission and findPortalSubmission; listSubmissions and listOwnSubmissions; suggestDuplicateWorkItems; claim; messages; withdraw; decline.
- **Attachments.**
  - `apps/api/src/attachment/index.ts`: the new portal and staff submission routes.
  - `apps/api/src/attachment/policy.ts`
  - `apps/api/src/attachment/require-submission-attachment-reach.ts`
  - `apps/api/src/attachment/controllers/presign-submission-attachment.ts`
  - `apps/api/src/attachment/controllers/complete-submission-attachment.ts`
  - `apps/api/src/attachment/repository.ts`
- **Host isolation and CSRF.**
  - `apps/api/src/index.ts` diff: `isPortalSubmissionStorageRequest` and its key regex, the reordered portal host gate, the portal static shell and intake mounting.
  - `apps/api/src/portal-client-routes.ts`
  - `apps/api/src/utils/csrf-protection.ts`: the portal Origin binding.
  - `apps/api/src/auth.ts`: `getConfiguredCustomerOrigin`.
  - `packages/libs/src/hono.ts`: the `agentCsrfToken` switch.
- **Registries.**
  - `apps/api/src/policy-registry.ts`
  - `apps/api/src/audit/actions.ts`, checked against `audit-writer.ts` `validateAction` and `events/event-keys.ts`
  - `docs/03-features/audit-trail.md`
- **Web.**
  - `apps/web/src/routes/portal/sign-in.tsx`
  - `apps/web/src/lib/portal-auth-client.ts`
  - The request-types settings page, for the delete button.
  - The catalogue visibility default. This is client-side only; I verified server enforcement in createSubmission.
- **Specs and decisions.**
  - `customer-portal.md`: CP-16, CP-19 and the portal API predicate table.
  - `request-types-and-catalogue.md`
  - The decision-log entries added by this PR, including the hold text "the separate request-type deletion decision remain held/pending".

## Tests and reproductions (clean `d43de75b` export)

| Suite | Result |
| --- | --- |
| `tests/api/csrf-portal-origin.test.ts`, `portal-attachment-storage.test.ts`, `two-entry-host.test.ts`, `boot-policy-registry.test.ts` (api `vitest.config.ts`, no Postgres) | **4 files, 22/22 passed** |
| `apps/api` `vitest.permissions.config.ts` (`test:permissions`) | **14 files: 11 passed, 3 failed; 83/88 tests passed.** All 5 failures are environmental. The export has no `.git`, so the merge-base checks (`git-baseline`, the `route-coverage` and `better-auth-plugin-list` monotonicity tests) refuse with "could not resolve a merge base". The same suite in the git worktree passed 88/88, but that run may have seen the concurrent working-tree state. Every route-coverage and matrix assertion that does not depend on git passed on `d43de75b`. |
| `packages/domain` `src/intake` | 1 file, 51/51 passed |
| `apps/web` `intake-validation.test.ts`, `intake-visibility.test.ts` | 2 files, 6/6 passed |
| `node scripts/ci/check-policy.mjs` | "8 policy file(s) coherent" |

I ran no Postgres integration tests: `intake-atomic-conversion`, `intake-feature-gate` and `intake-triage-actor` were not run. I found both blocking findings by source reading, not by live reproduction.

## Findings

### Blocking

**B1. The held request-type DELETE is implemented, mounted and exposed in the UI.**
- **Where:**
  - Route: `apps/api/src/intake/index.ts`, `deleteRoute` and its `.openapi(deleteRoute, …)` handler.
  - Policy: `apps/api/src/intake/policy.ts`, `"DELETE /api/request-types/{id}"`.
  - Repository: `apps/api/src/intake/repository.ts:479-516`, `deleteRequestType`, a hard `tx.delete(requestTypeTable)`.
  - Web client: `apps/web/src/fetchers/intake.ts:89`.
  - UI: the destructive button at `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/request-types.tsx:958-965`.
  - Records: the OpenAPI contract and the permission matrix entry `tests/permissions/matrix.fixture.json:873`.
- **Why it blocks:** the review brief says request-type DELETE must not be implemented. This PR's own decision-log entry says "the separate request-type deletion decision remain held/pending".
- **Second defect:** `request_type.deleted` (`repository.ts:509`) is in neither `AUDIT_ONLY_ACTIONS` nor `EVENT_KEYS`, and it is absent from `audit-trail.md:233`. `appendAuditLog`'s `validateAction` throws a plain `Error`, so every DELETE that passes the guards rolls back and returns 500. No test exercises the route.
- **Status:** the later commit `8677a154` appears to remove this. I have not reviewed that commit.

**B2. Portal attachment listing on a `duplicate` submission discloses another requester's work-item attachment metadata (CP-16).**
- **Where:**
  - `apps/api/src/intake/repository.ts:1251-1252`: `markSubmissionDuplicate` sets `submission.workItemId` to an existing work item. That item must be in the same organisation, but it can be **another customer's `private` request**.
  - `apps/api/src/attachment/require-submission-attachment-reach.ts:98`: sets `submissionWorkItemId` from the submission row **regardless of state**.
  - `apps/api/src/attachment/index.ts:443-458`: `GET /api/portal/submissions/{ref}/attachments` adds `attachment.work_item_id = submissionWorkItemId` to the parent filter whenever it is set, with no `state === "accepted"` guard. Its reach mode is `portal_upload`, which applies no state check.
- **Impact:** a customer whose submission a triager marked as a duplicate of a colleague's private request can list the ready and pending customer-visible attachments on that request. The listing includes filename, MIME type, size, field key and timestamps. CP-16 requires a constant-shape 404 for a colleague outside a private request's scope.
- **What is not affected:** downloads are correctly confined to the `accepted` state (`attachedToAcceptedWorkItem`). `findPortalSubmission` correctly binds `workItem` to `requesterId`, and it merges comments only when the state is `accepted`.
- **Fix:** include the work-item parent only when `state === "accepted"`, which matches the download and complete paths. Add a negative test.
- **Status:** the attachment files are unchanged in `8677a154`, so B2 persists there.

### Non-blocking

- **N1. Request-type audit actor is the auth user ID.**
  - Request-type create, update, publish, unpublish and delete pass `c.get("userId")` (the auth user ID) as `actorId` with `actorType: "person"`. See `intake/index.ts`, the requestTypeRouter handlers.
  - The staff submission-attachment download audit does the same (`attachment/index.ts`, staffSubmissionDownloadRoute).
  - Triage writes were fixed to use the person ID (`triagerPersonId`), and portal paths use `identity.personId`.
  - `audit_log.actor_id` has no foreign key, so nothing breaks, and some existing modules (service-calendar) do the same. It is still inconsistent with the "actor IDs are person IDs" expectation. Map these through `getActiveStaffPerson` as triage does.
- **N2. Accept and duplicate have no project-level reach check.**
  - Accepting authorises only workspace `intake:triage`. The triager-chosen `projectId` must be live, in the workspace and bound to the submission's organisation, but there is no project-level reach or `work_item:create` check.
  - Duplicate linking and duplicate suggestions likewise expose titles and keys of any same-organisation work item in the workspace to an `intake:triage` holder.
  - This is acceptable if `intake:triage` is meant to be workspace-wide. Confirm against rbac.md.
- **N3. Auto-accept can route into a project the author cannot see.**
  - A `request_type:manage` author can configure auto-accept into any workspace project bound to the audience organisations. Submissions then create work items there as the system actor.
  - It is bound correctly: same workspace, project organisation equals submitter organisation, and every audience organisation is checked under lock.
  - `slaPolicyId` and `defaultAssigneeId` are not validated at publish, but conversion re-validates both: the SLA policy against the workspace, and the assignee as an active staff member of the project.
- **N4. Staff attachment list on a `duplicate` submission.** `GET /api/submissions/{ref}/attachments` has the same unconditional `submissionWorkItemId` inclusion. It lists the duplicate target's non-customer-visible attachments to any workspace triager. This is staff-side, so lower severity. Fix it together with B2.
- **N5. Portal download audit omits `organisationId`.** The portal submission download audit row (`attachment/index.ts`, portalSubmissionDownloadRoute) has no `organisationId`. This is minor.

### Verified clean

- **Customer IDOR.**
  - `GET`, `messages` and `withdraw` under `/api/portal/submissions/{ref}`, and the portal attachment presign, complete and download routes, all filter on `submission.requester_id = caller personId`. Mismatches return a 404 with the same shape.
  - `ref` is a validated global serial (`submission_number_unique`).
  - The portal catalogue and submission creation are confined to `organisation_request_type` rows for the caller's organisation, with `published` and `customerVisible` set and the intake flag enabled per workspace. They are re-checked under lock in the transaction, with a version race check.
- **Visibility.**
  - `forcePrivate` is enforced on the server, so a client cannot widen it.
  - Otherwise the requester's choice wins, and the organisation default is the fallback. That matches CP-16 ("chosen by the requester").
  - The portal list is requester-only, which is stricter than the spec's organisation-visible allowance.
- **Staff authorisation.**
  - Every new route has a policy entry: 20 intake entries plus 6 attachment entries.
  - Staff routes use row-scoped reach (`validateWorkspaceAccess`, which returns 404 on a 403), then an API-key scope, then `requireWorkspaceCapability`.
  - Repository writes re-bind `workspaceId`.
  - Claim, accept, duplicate, decline and clarify use optimistic version and state guards under `FOR UPDATE`.
- **Conversion.**
  - Conversion is a single transaction: work item, activity and event, comment transfer, attachment and participant re-parenting, watcher, submission state, audit and outbox.
  - The requester is bound to `submission.requesterId`.
  - The project and type are bound to the workspace and organisation.
  - The default assignee must be an active staff project member.
- **Attachments.**
  - Extension allowlist, MIME and extension pairing, size ceiling at presign, plus server-side size and magic-byte checks at completion.
  - The object key is server-generated from sanitised segments and a CUID.
  - Field-key and single-file enforcement work.
  - `uploadedBy` must equal the requester.
- **Host isolation.**
  - The portal storage carve-out regex is anchored and refuses `..`. It admits only PUT upload and GET/HEAD download, and the HMAC token still binds the key.
  - The portal static shell is served only for the 4 registered patterns.
  - The portal-session CSRF check requires the exact configured customer Origin, or a same-origin Referer, and `appOrigin === portal`.
  - These agree with the prior delta review.
- **Customer sign-in.**
  - It uses only Better Auth `signIn.email`, `twoFactor.verifyTotp` and `verifyBackupCode`, then `getSession`.
  - The email step is local with no lookup.
  - Every failure shows one generic message.
  - No registration or SSO surface exists.
- **Audit registration.** Apart from `request_type.deleted` (B1), every intake action is registered in `AUDIT_ONLY_ACTIONS` or `EVENT_KEYS`.
- **Holds.** No registration or SSO is implemented. DELETE is the exception (B1).

## Residual risk and what was not checked

- I ran no Postgres-backed integration or e2e tests and did no live reproduction of B2. B2 rests on a source trace.
- I did not review commit `8677a154` or the uncommitted working-tree edits made during this review.
- I did not deep-review OpenAPI contract drift, the i18n files, the visual baselines, or the CI script changes (`check-deps`, `check-visual-scope`, `ci-full.yml`). The `ci-full.yml` and `scripts/ci/**` edits are security-scope and were only skimmed by diffstat.
- I did not check portal submission rate limiting or abuse controls.
- I did not re-derive the storage HMAC token implementation. I relied on the prior delta review for its key, size and expiry binding.
- The prior delta review (`664-700c-ecac-security-opus.md`) was read only after my findings were formed. It does not cover B1 or B2.

Verdict: BLOCK
<!-- END REPORT (sha256 99c6cedef61f14775c9b1ba3ee1f50b3411b4423dc7eeae3d0e6975a85303515) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-d43d-8528-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 2c2942ec11f5ef49847c5d89c4013da27bf2296e28b665e8948e1070b43ec512) -->
# PR #664 delta re-review, reviewer A

**Reviewer model:** Claude Sonnet (fresh independent ordinary-review context, reviewer A)
**Delta reviewed:** d43de75b19548366dc55b993c0e2d12bdb749e36 .. 852890f4193a884a3227bf378d428ba473e3f14c (HEAD confirmed equal to the latter)
**Base of the original review:** 4088e8ab2f8cba86a8e82d154cb5e3befb0f65e2
Read-only. Scope: the eight commits listed by the coordinator, reviewing the intake changes in full and the main merge only for conflicts with the intake files.

## Files examined
apps/api/src/index.ts, apps/api/src/intake/{index,policy,repository}.ts, apps/api/src/attachment/{index,require-submission-attachment-reach}.ts, apps/web/src/fetchers/intake.ts, routes portal submissions page, agent triage and request-types pages and tests, tests/api/portal-attachment-storage.test.ts, tests/api-integration/intake-attachment-duplicate-reach.test.ts, openapi.json, permissions matrix fixture, i18n (all 19 locale files), docs/03-features/request-types-and-catalogue.md, docs/07-planning/decision-log.md (merge 7b478ba0 against both parents).

## Commands and counts
- apps/api vitest (portal-attachment-storage, csrf-portal-origin, two-entry-host): 21 passed, 1 failed. The failure is the Node HTTP boundary test, `listen EPERM` from the sandbox (same environmental failure as the first review; not a code defect).
- apps/web vitest (portal routes, triage, request-types, src/lib, src/portal): 30 files, 150 tests passed.
- tsc --noEmit: apps/api (tsconfig.json and tsconfig.tests.json) and apps/web (tsconfig.app.json) report no diagnostics.
- Integration test for the duplicate leak was read, not run (needs Postgres).

## Original blockers
**B1 (request-type DELETE): resolved.** No remaining reference in apps/api/src, apps/web/src, packages, tests, scripts, i18n: the route, handler, repository function, the unregistered audit action, policy entry, UI button, fetcher and `requestTypes.delete` locale key are gone; OpenAPI lists only GET/PATCH for `/request-types/{id}`; the permissions matrix has no DELETE row. The unit mock was updated. The only remnant is the pre-existing spec text (`request-types-and-catalogue.md` lines 137, 159, 173): it describes the planned API and is unchanged by this PR, so it does not make the candidate wrong; it is the correct place to keep the pending owner decision open. Non-blocking: if a spec-versus-OpenAPI conformance check exists, confirm it does not flag the missing route.

**B2 (portal download of finalized key): resolved.** `PORTAL_SUBMISSION_FINAL_ATTACHMENT_KEY` requires the exact shape `workspace/<id>/submission/<id>/attachment/<id>/final/<lowercase alnum token>-<safe file>`, anchored, with the existing `..` rejection. It is admitted for GET/HEAD download only; upload remains pre-finalize-key only, and the code is restructured so method and path decide which regex applies (no accidental cross-use). The new tests are meaningful: a real finalized file is served with GET and HEAD (200 and bytes match), eleven lookalikes (traversal inside and before the token, work-item prefix, wrong root, extra trailing segment, extra middle segment, missing hyphen, uppercase token, encoded slash, backslash, leading slash) all return 404, and a finalized key is refused for upload. Reported real-browser evidence of a byte-matching requester download matches the code path.

## Other commits
- 4812dc8c, 8677a154: covered above.
- e961c120 (i18n): all five previously missing keys plus the new download error key now exist in all 19 locale files; `common:empty.select` present everywhere.
- b6ae3e8f: download goes through a mutation, so a failure shows an error alert in both portal and triage; the saved file now uses the attachment file name; the reply form renders only for clarifying and accepted, matching the domain rule. Portal submission tests extended.
- aa54402d: the reach middleware exposes the linked work item id only for an accepted submission, so a duplicate (which links another requester's item) no longer leaks that item's attachments to the portal or staff lists. This is consistent with the existing download-side rule, and the new integration test asserts empty lists for a duplicate and the expected list for the accepted owner on both surfaces. Correct and sufficient.
- b0036ca0: request-type create/update/publish/unpublish and the staff attachment download now record the staff person id (API key actors keep the key id). Behavioural note, non-blocking: these four request-type writes now return 403 for a caller without an active staff person, matching how triage writes already behave. The integration test asserts the person id for each audited action.
- 7b478ba0 (merge of main): neither parent loses any line of the decision log (zero removed lines against each parent), and all heading entries from both parents are present in the merged file. Insert-only against both parents: confirmed.
- 852890f4 (visual baselines): binary regenerations only; not assessed beyond scope.

## Remaining non-blocking items from the first review (unchanged, not regressions)
Hardcoded English strings and raw state labels in the triage and portal pages, thin portal page tests, no coverage for withdraw/decline/clarify flows, 403 versus 404 existence signal on staff attachment routes, unscoped draft storage in the catalogue page, no submit idempotency, auto-decline timer not part of this PR.

## Holds
Request-type deletion: now not implemented anywhere (hold respected). Registration, invitations, SSO, provider changes, required-file and custom-field mappings, God Mode assignment, MCP, notification activation, new capabilities or flags: none introduced by the delta.

## Residual risk
Postgres-backed integration and e2e runs were not executed by me; the sandbox prevented the one Node-listen test. Baseline images were not inspected.

Verdict: APPROVE
<!-- END REPORT (sha256 2c2942ec11f5ef49847c5d89c4013da27bf2296e28b665e8948e1070b43ec512) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-8528-security-rebind-opus.md; Claude Opus 5.5; sha256 a0a715fb8cd06549358dd7789ef34e1e83ba4d4487aefbe6f183f2b4bf5b9380) -->
# PR #664 (Intake) — security rebind d43de75b..852890f4

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context)
- **Role:** the same context that wrote the whole-PR BLOCK at d43de75b (`664-whole-d43d-security-opus.md`). I did not author, direct or remediate any commit in this range. I worked read-only and made no edits, commits or pushes to the repository.
- **Candidate head:** `852890f4193a884a3227bf378d428ba473e3f14c`. I confirmed it as worktree HEAD; the tracked tree is clean against it. The only untracked files are 3 e2e probe files, which are not part of the candidate.
- **Rebind range:** `d43de75b19548366dc55b993c0e2d12bdb749e36..852890f4193a884a3227bf378d428ba473e3f14c` (18 commits including merged main; 14 scanned by gitleaks).
- **Merge base with origin/main:** `8d739bd6a393ad9db5de99c778ebada9d9287ee6`. This equals the current `origin/main`, because merge `7b478ba0` brought in main.

**Reviewed head:** `852890f4193a884a3227bf378d428ba473e3f14c`

## Surfaces examined

- **8677a154 (DELETE removed).** I removed by grep every trace of the request-type delete:
  - the route, policy entry and repository function in `apps/api/src/intake/*`;
  - the audit action;
  - the web fetcher and the settings button;
  - the permission matrix entry;
  - the OpenAPI contract, which now lists only GET/POST on `/request-types`, GET/PATCH on `/request-types/{id}`, and POST on publish and unpublish;
  - the i18n key.
  - No match remains.
- **4812dc8c: the portal-host storage gate** (`apps/api/src/index.ts` `isPortalSubmissionStorageRequest`).
  - A new final-key pattern is admitted for GET/HEAD download only. PUT upload is still tested only against the original 5-part submission key.
  - The pattern matches `toFinalAttachmentObjectKey` (`apps/api/src/storage/shared.ts:206`): pending dir + `/final/` + cuid2 token (lowercase alphanumeric) + `-` + the sanitised filename.
  - The filename charset is produced by `sanitizePathSegment`, a subset of the allowed class.
  - The `..` pre-check still runs first.
  - The download handler re-validates the signed token bound to the exact key (`c.req.valid("query")`). A repeated `key` parameter fails zod's single-string check.
- **aa54402d (B2/N4 fix).** `require-submission-attachment-reach.ts` now sets `submissionWorkItemId` only when `state === "accepted"`, on both portal and staff modes. The portal and staff list routes consume only that variable, so both are covered.
- **b0036ca0 (N1 fix).**
  - Request-type create, update, publish and unpublish now pass `triagerPersonId(c)`, which is the active staff person, or 403 if there is none.
  - The staff submission-attachment download audit records the staff person ID.
- **b6ae3e8f (web).**
  - The download error alert.
  - `link.download = filename || id`, which is browser-sanitised.
  - The reply box is shown only in the clarifying and accepted states. This is a UI restriction; the server-side transition rules are unchanged.
- **e961c120 (i18n).** Keys only.
- **7b478ba0 merge of main 8d739bd6 (#677 and earlier).** Main brought in:
  - an agent sign-in/sign-up password-label association (#668);
  - a CSS-only selector change in `packages/ui` `input.tsx`;
  - the G8 partial-raster flag in the Playwright visual config;
  - a `check-visual-scope.mjs` G8 guard;
  - docs, review notes and the status/ledger;
  - 3 exact-fingerprint `.gitleaksignore` entries for #677 review prose.
  - I checked these against intake, portal and auth: none touches the API, policies, CSRF, host gating, the portal auth client, or the intake routes. The agent sign-in change only restructures markup around the password toggle. The portal sign-in does not import those agent form components.
- **852890f4 and the merged baselines.** I inspected all 7 PNGs changed in the range, both visually and for metadata chunks (account-security-setup, intake-queue, portal-catalogue-selected-form, portal-submission-detail, request-types, sign-in, primitives-form).
  - Each has only IHDR, IDAT and IEND chunks, with no text or EXIF chunks.
  - What is shown is synthetic: an example.test identity, masked password fields, SUB-7 sample data and `visual-*` IDs.
  - There are no QR codes, TOTP secrets, backup codes, tokens or real addresses.

## Tests and reproductions

| Run | Result |
| --- | --- |
| Adversarial storage-gate test I wrote, in a scratch export of 852890f4 only (not committed). It drives `createApp()` with real signed URLs on the portal host. | **1 file, 5/5 passed** |
| `tests/api` csrf-portal-origin, portal-attachment-storage (including the new final-key tests), two-entry-host, boot-policy-registry (clean 852890f4 export) | **4 files, 24/24 passed** (29/29 including my adversarial file) |
| `apps/api` `vitest.permissions.config.ts` in the worktree at 852890f4 (git available) | **14 files, 88/88 passed** (83/88 in the git-less export; the 5 failures were only the merge-base checks) |
| `CI=true` `vitest.integration.config.ts` `tests/api-integration/intake-attachment-duplicate-reach.test.ts` (testcontainers Postgres) | **1 file, 3/3 passed** |
| `CI=true` integration: intake-triage-actor, intake-feature-gate, intake-atomic-conversion | **3 files, 10/10 passed** |
| `node --test` check-visual-scope, check-deps, check-inventory | **186/186 passed** |
| `gitleaks detect` (local 8.30.1) on `--log-opts=origin/main..852890f4`, 47 commits, and on `d43de75b..852890f4`, 14 commits | **1 finding in each (the same one); see N-R1** |
| Hosted PR check "supply chain - secret scan" at head 852890f4 (`gh pr view`) | **SUCCESS** |

**What the adversarial storage-gate test covered:**
- **Every denied case returned 404 with the host-deny body `{message:"Not Found"}`.** This proves the host gate refused it, not the handler:
  - an uppercase token;
  - an underscore in the token;
  - an empty token;
  - a missing token separator;
  - double `final` (`final/final/<token>-x`);
  - a repeated final suffix;
  - `final` at the wrong depth with no attachment segment;
  - an extra trailing segment;
  - a work-item final key;
  - a literal `%2e%2e` in the name;
  - `..` in the name;
  - a newline;
  - a space;
  - a literal `%00`;
  - a non-ASCII name.
- **These encoded forms returned 400 or 404:** a double-encoded slash (`%252F`), an encoded `/../`, an encoded backslash, and a second `key=` parameter pointing at a work-item key.
- **Upload with a final-shaped key** (including a `final/final-x` lookalike) returned 404 on the portal host.
- **POST, DELETE, PUT and PATCH** on the download path with a final key returned 404.
- **A well-formed final key passes the host gate.** It reaches the handler, which returns "Attachment not found" because the object is absent.

**The new integration test is non-vacuous.** Each test includes a positive control: the accepted submission still lists its owner's attachment.

## Findings

### Blocking

None.

### Closed from the d43de75b review

- **B1 (held request-type DELETE): CLOSED.** It is removed everywhere with no residue. Its unregistered audit action is gone with it.
- **B2 (duplicate-link attachment listing on the portal): CLOSED.** The fix is in `require-submission-attachment-reach.ts`. The integration test proves an empty list for a duplicate and the attachment visible on the accepted parent.
- **N4 (the same issue on the staff list): CLOSED** by the same change, with its own integration test.
- **N1 (audit actor IDs): CLOSED.** Request-type writes and the staff submission download now record the person ID, and the integration test asserts it.

### Non-blocking

- **N-R1. Local gitleaks flags a synthetic test token.**
  - Local gitleaks 8.30.1 reports one `generic-api-key` match at `tests/api/portal-attachment-storage.test.ts:168` (commit 4812dc8c).
  - The match is a synthetic cuid-style token constant in the new lookalike test. It is not a credential.
  - The hosted secret-scan check is green at this exact head, because the hosted action's pinned gitleaks version does not flag it.
  - If the action is ever upgraded, this will start failing CI. Consider renaming the constant or using an obviously fake value, or recording an exact fingerprint ignore per the existing `.gitleaksignore` convention. I am not reproducing the value here.
- **N-R2. Staff download audit falls back to the user ID.** The staff attachment download audit uses the auth user ID when the caller has no active staff person, for example an instance admin without a person row. That is a narrow residual of N1's class. Request-type writes instead refuse with 403 in that case.
- **N-R3. API-key request-type writes are attributed to a person.** They are recorded as `actorType: "person"` with the owning user's staff person ID, and no `apiKeyId`. This predates the change. Consider recording the API key in a follow-up.
- **N-R4. Some accepted work-item downloads stay denied on the portal host.** An attachment that staff uploaded directly to the work item has a work-item key. The portal host still denies it, by design, even when it is customer-visible on the requester's accepted request. This is a functional limit, not a security issue.
- Carried over and unchanged: **N2** (accept and duplicate rely on workspace-wide `intake:triage`), **N3** (auto-accept project chosen by the request-type author) and **N5** (the portal download audit has no organisation ID).

## Residual risk and what was not checked

- No browser or e2e run, and no S3-driver path. The storage gate was exercised only with the filesystem driver.
- I did not re-review the unchanged d43de75b surface beyond what my previous whole-PR report covered.
- Main's #677 changes were checked for interaction only, not re-reviewed. They carry their own reviews.
- The hosted secret-scan result comes from GitHub's check rollup. I did not inspect its logs.
- My adversarial test exists only in a scratchpad export. It is not part of the candidate.

Verdict: CLEAR
<!-- END REPORT (sha256 a0a715fb8cd06549358dd7789ef34e1e83ba4d4487aefbe6f183f2b4bf5b9380) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-whole-8528-ordinary-b-opus.md; Claude Opus 5.5 (ordinary-review role); sha256 543239c42311732a2fc829516be77b04b28828510ab6d8e1ae9cafb546631100) -->
# PR #664 whole-candidate ordinary review, reviewer B

- **Reviewer model:** Claude Opus 5.5 (fresh independent context, ordinary-review role, reviewer B)
- **Role note:** ordinary review only. This is not the GPT-6 Sol security gate and does not substitute for it.
- **Reviewed head:** 852890f4193a884a3227bf378d428ba473e3f14c
- **Base (`git merge-base HEAD origin/main`):** 8d739bd6a393ad9db5de99c778ebada9d9287ee6
- **Worktree:** /Users/heinthura/.codex/worktrees/delivery-conductor-20261011/Ticketing.v2
- **Diff:** 108 files, +22127 / -397 (`git diff 8d739bd6..852890f4`)
- **Mode:** read-only. Nothing was edited, committed or pushed. No browser, no Docker, no integration tests.
- **Independence:** I did not author, direct or remediate this PR. I did not read existing review reports in the evidence directory. The only evidence I opened was the UI acceptance probe I was asked to spot-check.

Worktree note: three untracked probe files exist (`tests/e2e/playwright.intake-probe.config.ts`, `tests/e2e/tsconfig.intake-probe.json`, `tests/e2e/zz-intake-ui-acceptance-probe.spec.ts`). They are not part of the candidate. Tracked files were clean at HEAD.

## Files examined

API:
- `apps/api/src/intake/index.ts`, `policy.ts`, `schema.ts`, `repository.ts` (all 2272 lines, read in ranges)
- `apps/api/src/attachment/index.ts` (diff), `policy.ts`, `repository.ts`, `require-submission-attachment-reach.ts`, `controllers/presign-submission-attachment.ts`, `controllers/complete-submission-attachment.ts`
- `apps/api/src/index.ts` (diff: portal host gate, portal storage carve-out, portal shell serving), `portal-client-routes.ts`, `utils/csrf-protection.ts` (diff), `auth.ts` (diff), `audit/actions.ts` (diff), `database/index.ts` (diff), `policy-registry.ts` (diff), `work-item/native-event.ts` (diff), `work-item/repository.ts` (new), `notification/fanout.ts` (to confirm no notification activation), `openapi.ts`
- `packages/domain/src/intake/request-type.ts` (`validateSubmissionData`, `translateMapsTo`), `submission.ts` (`transitionSubmission`)
- `packages/libs/src/hono.ts` (diff)

Web:
- `apps/web/src/fetchers/intake.ts`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/triage.tsx`
- `apps/web/src/routes/agent/_layout/_authenticated/agent/settings/request-types.tsx` (key ranges)
- `apps/web/src/routes/portal/catalogue.tsx`, `sign-in.tsx`, `submissions/$ref.tsx`
- `apps/web/src/lib/routes.ts` (diff), `portal-auth-client.ts`, `apps/web/src/portal/portal-application-providers.tsx`, `apps/web/portal/main.tsx` (diff), `apps/web/src/query-client/index.ts`, `apps/web/src/lib/http-error.ts`

Docs and authorities:
- `docs/03-features/intake-queue.md`, `request-types-and-catalogue.md`, `customer-portal.md` (diff, CP-18 and CP-19), `audit-trail.md` (diff), `sla.md` (precedence rule)
- `docs/01-architecture/rbac.md` (capabilities), `events.md` (intake events), `security-model.md` (diff), `monorepo-layout.md` (diff)
- `docs/02-design/screen-inventory.md` (diff), `docs/07-planning/decision-log.md` (new entries and the 2026-10-11 D5 intake entry)
- `.github/workflows/ci-full.yml` (diff), `apps/web/package.json`, `packages/domain/package.json`, `pnpm-lock.yaml` (diffs)

Tests (read for coverage, not run unless listed below):
- `tests/api-integration/intake-atomic-conversion.test.ts`, `intake-attachment-duplicate-reach.test.ts`, `intake-feature-gate.test.ts`, `intake-triage-actor.test.ts`
- `tests/api/portal-attachment-storage.test.ts`, `csrf-portal-origin.test.ts`, `two-entry-host.test.ts`
- `tests/e2e/intake-primary-journey.spec.ts` (test list only)

Probe evidence spot-checked:
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-ui-acceptance-probe-852890f4-claude-r5/` (`run-summary.txt`, `stdout.log`, `results/*/acceptance-results.json`, `probe-snapshot.spec.ts`)

## Commands and counts

Vitest could not write its temp config under the worktree inside the sandbox (EPERM on `node_modules/.vite-temp`), so the commands below ran with the sandbox disabled. All are read-only with respect to source.

| Command | Result |
| --- | --- |
| `apps/api: npx vitest run --config vitest.config.ts ../../tests/api/csrf-portal-origin.test.ts ../../tests/api/portal-attachment-storage.test.ts ../../tests/api/two-entry-host.test.ts ../../tests/api/attachment` | 4 files passed, 35 tests passed, exit 0 |
| `apps/web: npx vitest run --config vitest.config.ts src/routes/portal src/routes/agent/.../triage.test.tsx src/routes/agent/.../settings/request-types.test.tsx src/lib/intake-validation.test.ts src/lib/intake-visibility.test.ts src/lib/routes.test.ts src/portal` | 9 files passed, 54 tests passed, exit 0 |
| `packages/domain: npx vitest run src/intake` | 1 file passed, 51 tests passed, exit 0 |
| `pnpm typecheck` | 9 of 9 turbo tasks successful, exit 0 |
| `pnpm check:route-policy` | exit 0; embedded permissions suite 14 files, 88 tests passed |
| `pnpm check:openapi` | exit 0; `openapi.json` matches the API (277 operations) |
| `pnpm check:i18n` | exit 0; every locale file is in sync with en-US |

Note on API unit coverage: the api vitest config has no unit tests for the intake router or repository. All intake behaviour tests live in `tests/api-integration/` (not run here, as instructed) and in the e2e journey. The four API unit files above cover portal CSRF, portal storage carve-out, the two-entry host and attachment magic bytes.

## Findings

### Blocking

**B1. The portal catalogue and "my requests" list read the wrong workspace feature flag.**
`apps/api/src/intake/repository.ts:568` (`portalCatalogue`) and `:1642` (`listOwnSubmissions`) select `workspace_feature_flag` rows filtered only by `workspaceId`. They do not filter on `featureKey = 'feature.intake'`. The code then takes the first row for each workspace (`workspaceFlags.find(flag => flag.workspaceId === workspaceId)`). Flag rows are keyed by `(workspace_id, feature_key)`, so any workspace with another feature's row gets an arbitrary row in an unspecified order.

- **False positive:** a workspace with `feature.intake` explicitly disabled but another flag enabled can show its catalogue and its submissions to customers. Intake is supposed to be default-off under the D5 exception.
- **False negative:** a workspace with intake enabled but another flag disabled hides its catalogue. `createSubmission` (`:617-620`) uses `portalCatalogue` as a pre-check, so it returns 404 for a request type that should be submittable. The in-transaction re-check at `:686-707` does filter by feature key correctly, so the false-positive case cannot create a submission.

Every other flag reader in the PR filters by feature key: `requireIntakeEnabled` in `index.ts`, `createSubmission`'s re-check, and `assertIntakeEnabled` in `require-submission-attachment-reach.ts`. `intake-feature-gate.test.ts` seeds only `feature.intake` rows, so this is not caught.

- Fix: add `eq(featureKey, "feature.intake")` to both queries.
- Regression test: seed a second feature row per workspace, in both orders, and assert the catalogue, the list and create.

**B2. Portal-facing responses send raw ORM rows on the wire.**
There is no response validation. `@hono/zod-openapi` does not parse responses, and `apps/api/src/openapi.ts` adds none. So the declared schema does not strip extra fields.

- `POST /api/portal/submissions` returns `{ ...submission, ref }` (`repository.ts:801`), the full `submission` row. That includes `organisationId`, `requesterId`, `requestTypeId`, `requestTypeVersionId`, `formData`, `claimedBy`, `claimedAt`, `workItemId` (on auto-accept) and `version`. The declared schema is only `{id, number, ref, state, createdAt}` (`index.ts` `createdSubmissionSchema`).
- `POST /api/portal/submissions/{ref}/attachments/{id}/complete` returns the full `attachment` row (`complete-submission-attachment.ts:172`). That includes `objectKey` (the finalized storage key), `workspaceId`, `organisationId` and `uploadedBy`. The work-item complete route maps through `toAttachmentResponse`; this one does not.

These are the customer's own records, so the exposure is limited. They still break the "no ORM row reaches the wire" rule on the customer boundary, and they leak internal identifiers and storage keys that the published contract does not declare. Fix: map both responses to explicit DTOs.

### Non-blocking (should fix or file)

**N1. Staff-side responses also return ORM rows, declared as `z.unknown()`.**
- `GET /api/submissions` returns the full `submission`, `requestType`, `version`, `requester` (whole `person` row, including `userId`, quiet hours and locale) and `organisation` rows (`repository.ts:1593`, schema `index.ts:550`).
- `GET /api/submissions/{ref}` returns the full `submission`, `requestType` and `version` rows (`repository.ts:1381`).
- Accept and duplicate return a full `work_item` row (`repository.ts:1191`, `:1288`; schema `index.ts:628`, `:656`).
- Decline returns the full `submission_message` row (`index.ts:715`).
- Request-type detail and publish return full `request_type_version` rows (`index.ts:393`).

These are staff-only behind `intake:triage` and `request_type:read`, so this is non-blocking. The OpenAPI contract is effectively untyped for these routes, and the web code compensates with `as unknown as` casts throughout `triage.tsx`.

**N2. Accept is refused when another triager holds the claim, but decline, duplicate and clarify are not.**
`acceptSubmission` calls `claimSubmission` first (`repository.ts:1144`), which returns 409 "claimed by another triager" (`:1826`). `declineSubmission`, `markSubmissionDuplicate` and `postSubmissionMessage` (staff) do not check claim ownership. The spec does not define claim as exclusive ownership. IQ-16a uses the claim only to stop withdrawal. Its edge-case row says the second simultaneous acceptor "gets 409 and is shown the work item the first created". Neither the API (the 409 body carries no work item) nor the triage UI (generic `actionError`) does that. The concurrency test races two accepts by the same staff person, so the two-triager path is untested.

**N3. Unknown and hidden-field keys in `formData` are stored as-is.**
`submissionBody.formData` is `z.record(z.string(), z.unknown())` (`schema.ts:101`). `validateSubmissionData` only checks visible schema fields. Arbitrary extra keys, values of hidden fields and nested objects up to the body limit are persisted and returned to the customer. Recommend stripping to the visible schema keys before insert.

**N4. Wrong date types in the OpenAPI schema.**
`claimedAt: z.date()` (`intake/index.ts:598`) and `createdAt: z.date()` (`attachment/index.ts:253`, `:298`) are declared as dates, but the wire value is an ISO string. The generated client types are wrong.

**N5. Missing declared error responses.**
The staff clarify route (`askSubmissionClarification`) declares no 404 or 409, though the repository throws both. The duplicate-suggestions route declares no 404.

**N6. Feature-flag check runs before the capability check on `GET`/`POST /api/request-types` and `GET /api/submissions`.**
`requestTypeCollectionScope` calls `requireIntakeEnabled` before `requireWorkspaceCapability`. Any authenticated user can tell intake-off (404) from intake-on (403) for any workspace id. This is a minor oracle. The item routes validate workspace access first.

**N7. Publish does not validate `slaPolicyId` or `defaultAssigneeId` ownership.**
A version can pin a foreign or deleted SLA policy. Every later accept then fails with 422 "Submission SLA policy is unavailable" until a new version is published (`convertSubmissionInTransaction`). The work-item type and project are validated at publish; the SLA policy should be too.

**N8. Request-type editor: Publish publishes the last saved row, not the on-screen draft.**
`request-types.tsx:937`. The publish-guard booleans are computed from the draft, but the server publishes the saved row. Unsaved edits are silently left out of the version. Save first, or disable Publish while the draft is dirty.

**N9. i18n is incomplete.**
`check:i18n` passes because it only compares key sets. Hard-coded English remains in the new screens. Definition of done line 112 requires strings to be extracted.

- `triage.tsx`:
  - legend "Submission status filter" (`:216`)
  - raw state-enum filter labels (`:239`)
  - "Loading details…" (`:309`)
  - "Download", "Destination project", "Choose a project", "Work item type", "Choose a work item type" (`:383` onward), plus the matching aria-labels
  - section aria-label "Submission …"
  - raw `actorType`, `state` and `file.state` values
  - English accept-validation error
- `request-types.tsx`:
  - field-type option labels, mapping labels, priority labels, placeholders
  - publish guidance sentences (`:584-585`, `:903-904`)
  - "Published versions", "Version …", "Opaque catalogue key"
- `submissions/$ref.tsx`:
  - raw `message.actorType` shown to customers, including the internal word "triager" and "person" for transferred comments (`:241`)
  - raw `file.state` (`:308`)
  - raw submission state in the subtitle
  - English upload error string
- `catalogue.tsx:502`: the pending submit label uses `common:empty.loading`, so the button reads "Loading…", not "Submitting…".

**N10. Accessibility and UX gaps (non-blocking).**
- The portal sign-in page has no `h1` (CardTitle only). The probe records this as info.
- Portal "Withdraw request" (`$ref.tsx:396`) is irreversible and has no confirmation step.
- After a reload, triage shows the converted work item as a raw cuid rather than its key. The probe found the same (follow-up #681).
- An unauthenticated visitor to `/catalogue` or `/submissions/:ref` gets a generic load error with no link to `/sign-in`. The portal reuses the agent query client, whose 401 handler would redirect to `/auth/sign-in` (an agent path). The intake fetchers throw plain `Error`, so that handler never fires. This avoids a wrong redirect, but there is no right one either.
- `downloadSubmissionAttachment` and `downloadPortalSubmissionAttachment` call `URL.revokeObjectURL` synchronously after `link.click()` (`fetchers/intake.ts:252`, `:317`). Some browsers cancel the download when the URL is revoked that early. Defer the revoke.
- The triage destination project list is not filtered to projects serving the submitter's organisation. The server correctly refuses with 422, but the UI shows only the generic error.
- Spec gaps:
  - The empty-catalogue state lacks the support email (RT edge case).
  - Long option lists are not rendered as a searchable combobox above 10 options.
  - Very large form data is not given a collapsible section (IQ edge case).
- Drafts in `localStorage` are keyed by request type and version, not by user. On a shared device, the next customer sees the previous customer's draft.

**N11. No idempotency on `POST /api/portal/submissions`.**
A network retry after a lost response creates a second submission. The UI disables the button while pending, which covers double-click only.

**N12. Decision-log formatting.**
The new 2026-10-12 entries start immediately after the previous entry's last line, with no blank line or `---` separator (`decision-log.md:13-14`). Stray blank lines were also added around the `# Decision log` heading. The log is append-only, so this is cosmetic and should be fixed by the orchestrator, not by rewriting entries.

**N13. Probe evidence labels a stale head.**
The probe's `acceptance-results.json` records `"head": "0e6c6956"`, hard-coded at `probe-snapshot.spec.ts:94`. `run-summary.txt` correctly binds 852890f4 with `tracked-dirty=0` and the probe SHA-256 `7405bccd…`, which I re-computed and matched. The 403/0 result is therefore bound to the right head by the summary, not by the results file. Fix the label in future probe runs.

### Missing negative tests (spec "must not" items)

None of the following has a test at this head (searched `tests/api-integration/intake-*`, `tests/api/*`, `tests/e2e/intake-primary-journey.spec.ts`):

1. **RT-8a:** `POST /api/portal/submissions` with a key that has no `organisation_request_type` row for the caller's organisation is refused. A crafted direct key is not tested, and neither is absence from `GET /api/portal/catalogue`.
2. **IQ-3 / spec Testing:** `GET /api/portal/submissions/{ref}` with no session, and with a session from another organisation or another requester, returns 404.
3. **IQ-16a / spec Testing:** withdraw after a claim, after a staff message and after an accept attempt each return 409. A claim, a message and an accept each racing a withdrawal resolve to exactly one winner. There are no withdraw tests for intake at all.
4. **IQ-16:** decline with an empty or whitespace reason is refused. A staff decline is final, so the customer cannot reply, withdraw or reopen.
5. **Edge case:** an attachment transfer failure rolls back acceptance with no partial work item.
6. **Edge case:** a customer reply after acceptance lands as a public comment on the work item, and a reply in `new`, `declined` or `duplicate` returns 409.
7. **Edge case:** accept into a project that does not serve the customer's organisation returns 422. Covered only for auto-accept publish; the manual accept org-mismatch path is not tested.
8. **Two-triager accept race:** the second acceptor gets 409. Today's test uses the same staff person twice.
9. **Feature gate:** a workspace with other feature-flag rows (would have caught B1).
10. **Portal DTO shape:** a negative assertion that `POST /api/portal/submissions` and attachment `complete` responses contain no internal keys (would have caught B2). One such assertion already exists for `findPortalSubmission`.
11. **Portal attachments:** presign is refused once the submission is `declined`, `withdrawn` or `duplicate`, and complete is refused for another requester's attachment over HTTP. Partly covered at repository level; not covered through the route.

## Holds checked

| Hold | Result |
| --- | --- |
| Request-type DELETE removed | Absent from the router, the policy map, `openapi.json` and the web fetchers. Present only in spec text. |
| Registration, invitations, typed-domain SSO | Not present. `sign-in.tsx` uses only `signIn.email`, `twoFactor.verifyTotp`, `verifyBackupCode` and `getSession`. No discovery, provider list or sign-up. `auth.ts` gains only `getConfiguredCustomerOrigin()`. |
| Provider or admission changes | None found in `auth.ts` or the identity code. Portal sign-in reuses the existing portal endpoints. |
| Unapproved intake mappings | Publish allows only `title`, `description` and `priority` native mappings. It rejects custom-field mappings and required file fields (`repository.ts` `publishRequestType`). Consistent with the 2026-10-11 D5 holds. |
| MCP | No MCP files or routes in the diff. |
| Notification activation | Intake writes use `enqueueOutboxEvent` only, never `enqueueNotificationEvent`, so there is no notification fan-out. IQ-12 "notifies the customer" is therefore not delivered. That matches the hold but is a functional gap to track. |
| New capabilities or flags | None. Uses the existing `request_type:read`, `request_type:manage` and `intake:triage` (rbac.md:84-86) and the existing `feature.intake`. Event keys `submission.*` already exist in `events/event-keys.ts`. Audit-only actions were added to `audit/actions.ts` and documented in `audit-trail.md`. |
| Dependency | `@taskdesk/domain` was added to `apps/web` per the 2026-10-12 owner decision. No third-party packages were added. |
| CI change | `ci-full.yml` now builds `@taskdesk/web...` with `--force` instead of building only permissions. This is gate machinery (security scope), so the Sol review must cover it. |

## Probe spot-check (claims against source)

- Raw enum values are shown in the portal and triage: confirmed in source (`$ref.tsx:241`, `:308`; `triage.tsx:239`).
- The submit button reads "Loading…": confirmed (`catalogue.tsx:502`).
- The converted work item shows a raw id after reload: confirmed (`triage.tsx` `convertedWorkItem` falls back to `submission.workItemId`).
- The portal sign-in page has no h1: confirmed (`sign-in.tsx:176`, CardTitle).
- The free-text "Default project ID" field: consistent with the editor source (follow-up #680).
- The probe does not check hard-coded English in triage and editor controls. N9 is outside what the probe measured, so a 403/0 pass does not cover it.

## Residual risk / not checked

- I did not run integration tests or e2e, by instruction. Atomicity, rollback and race behaviour are judged from source and the existing integration test text only.
- I did not do a security review. These surfaces need the GPT-6 Sol review on this exact head: the portal CSRF change, the portal storage carve-out regexes, portal host admission, the `ci-full.yml` change and the redocly approved-findings entries.
- I did not verify S3-driver behaviour. A cross-origin 302 to a presigned S3 URL, fetched as a blob by the web client, needs CORS on the bucket. Only the filesystem driver is exercised.
- Lock ordering across accept, presign, complete, auto-accept and project archive was reviewed by reading only. The integration tests assert two archive/accept interleavings.
- I did not review `packages/ui/src/styles/pairs.json` (952 lines), the visual baselines or `matrix.fixture.json` beyond confirming that the permissions suite passes.

## Secret scan of this report

I ran `/opt/homebrew/bin/gitleaks detect --no-git --source <scratch dir containing only this report>`: no leaks found, exit 0. I re-ran it after adding this section.

Verdict: CHANGES REQUESTED
<!-- END REPORT (sha256 543239c42311732a2fc829516be77b04b28828510ab6d8e1ae9cafb546631100) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-8528-7b30-ordinary-b-opus.md; Claude Opus 5.5 (ordinary-review role); sha256 d9cdd8452b7df6943fa07daefc7261b0b05829b1f63801b250110a1f0e90d517) -->
# PR #664 delta re-review (852890f4..7b30dfbf), ordinary reviewer B

- **Reviewer model:** Claude Opus 5.5 (fresh independent context, ordinary-review role, reviewer B)
- **Role note:** ordinary review only. This is not the GPT-6 Sol security gate.
- **Reviewed head:** 7b30dfbf7a647119d4247b96248ab9dd89317013. The worktree HEAD was confirmed equal to it.
- **Previous reviewed head:** 852890f4193a884a3227bf378d428ba473e3f14c (my prior report: `664-whole-8528-ordinary-b-opus.md`, CHANGES REQUESTED on B1 and B2)
- **Base (`git merge-base HEAD origin/main`):** 8d739bd6a393ad9db5de99c778ebada9d9287ee6 (unchanged)
- **Delta:** 2 commits, 5 files, +293 / -15
  - fd1fcf17 `fix(intake): resolve portal catalogue and submissions from the intake flag only`
  - 7b30dfbf `fix(portal): return only declared fields from submission create and attachment complete`
- **Independence:** I did not author, direct or remediate these fixes. The conductor implemented them. I worked read-only and did not read other reviewers' reports.

## Files examined

- `apps/api/src/intake/repository.ts` (delta at `portalCatalogue` and `listOwnSubmissions`)
- `apps/api/src/intake/index.ts` (delta in the `createSubmissionRoute` handler, plus a re-read of every `portal` route handler)
- `apps/api/src/attachment/index.ts` (delta in the `portalSubmissionCompleteRoute` handler, `toAttachmentResponse`, and every portal attachment route)
- `apps/api/src/attachment/controllers/presign-submission-attachment.ts` (return shape)
- `apps/api/src/database/schema.ts` (`submission_message` columns)
- `tests/api-integration/intake-feature-gate.test.ts` (delta)
- `tests/api-integration/intake-portal-response-shape.test.ts` (new)
- `/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-real-intake-playwright-7b30dfbf-claude/run-summary.txt` (existence and head binding only)

## Commands and counts

The sandbox was lifted because vitest and turbo write temp files inside the worktree. No source was changed. I did not run integration tests, following the original instruction, so the new and changed integration tests were judged by reading them.

| Command | Result |
| --- | --- |
| `pnpm typecheck` | 9 of 9 tasks successful, exit 0. This includes the test tsconfig, so the new integration test compiles. |
| `pnpm check:openapi` | matches the API (277 operations) |
| `apps/api: npx vitest run --config vitest.config.ts` on csrf-portal-origin, portal-attachment-storage, two-entry-host and attachment/ | 4 files, 35 tests passed |

The conductor reported 3/3 for the feature-gate file and passes for the response-shape file at 7b30dfbf, each failing before its fix. I did not re-run these. The real-journey evidence `run-summary.txt` binds head 7b30dfbf with `playwright rc=0` and `dirty=3`. I take the three dirty files to be the untracked probe files I saw in this worktree; they are not tracked candidate changes.

## Blocker verification

**B1 (feature flag): CLOSED.**
- `repository.ts` `portalCatalogue` (around line 568) now filters the workspace flag query with `and(inArray(workspaceId, ids), eq(featureKey, "feature.intake"))`. `listOwnSubmissions` (around line 1645) does the same.
- Every flag reader in the intake and submission-attachment code now constrains the feature key. `createSubmission` relies on `portalCatalogue` for its pre-check, so the false-negative 404 on submit is fixed too.
- Test quality:
  - Both the existing list test and the new catalogue test insert `feature.approvals` rows with the opposite value before the intake rows.
  - They then assert the enabled workspace's item is present and the disabled one is absent. That catches both the false-positive and the false-negative case.
  - Limitation (non-blocking): without an `ORDER BY`, the row the old code picked depends on insertion order. That is why the conductor saw a 2-of-3 failure before the fix rather than 3 of 3. The tests are meaningful but probabilistic as a regression guard. A stronger guard would be a unit-level assertion on the query predicate. Insertion order plus heap order makes this reliable in practice on a fresh test database.

**B2 (raw rows to customers): CLOSED for both named routes.**
- `POST /api/portal/submissions` now returns exactly `{id, number, ref, state, createdAt}`, with `createdAt` as an ISO string. That matches `createdSubmissionSchema`.
- Portal attachment `complete` now returns `toAttachmentResponse(...)` plus `workItemId` (nullable) and `submissionId`. That matches the declared `attachmentSchema.extend(...)`. `objectKey`, `workspaceId` and `organisationId` no longer reach the wire.
- Test quality: the new HTTP integration test goes through the real router via `portalRequest`. It asserts the exact sorted key set for both responses and checks that the serialized attachment contains no `workspace/` storage key prefix. It performs a real presigned PUT and complete against a temporary filesystem storage root, so the complete path is exercised end to end, not mocked. Exact key equality fails on any added field. That is a sound non-vacuous guard.

## Other customer-facing routes: raw-row sweep

| Route | Shape |
| --- | --- |
| `GET /api/portal/catalogue` | explicit mapping |
| `GET /api/portal/catalogue/{key}` | explicit mapping. `formSchema` is form configuration, not a row (see N-b). |
| `GET /api/portal/submissions` | explicit mapping |
| `GET /api/portal/submissions/{ref}` | explicit DTO (`findPortalSubmission`) |
| `POST /api/portal/submissions/{ref}/withdraw` | `{ref, state, version}` |
| `POST /api/portal/submissions/{ref}/attachments/presign` | `{attachmentId, uploadUrl, uploadHeaders}` |
| `GET /api/portal/submissions/{ref}/attachments` | selected columns only |
| `GET /api/portal/submissions/{ref}/attachments/{id}` | 302 redirect |
| **`POST /api/portal/submissions/{ref}/messages`** | **still returns a raw `submission_message` row** in the non-accepted (clarifying) path. See N-a. |

**N-a (non-blocking): portal reply returns the raw `submission_message` row.**
`apps/api/src/intake/repository.ts:2095` returns `{ id, ref, state, message }`, where `message` is the inserted row. The portal reply route (`intake/index.ts` `portalMessageRouter`) passes it through unmapped. The row's columns are `id`, `submissionId`, `authorId`, `actorType`, `body` and `createdAt`. The declared `submissionMessageSchema` lacks only `submissionId`, and that value equals the top-level `id` already in the same response (the submission id). So this is contract drift, not new data exposure. That differs from B2, which exposed storage keys and organisation, claim and type identifiers. The accepted-path branch of the same function already builds an explicit object. Recommend mapping the clarifying-path message to the declared fields as well. Filing it is acceptable.

**N-b (non-blocking, carried note): portal catalogue sends form configuration as-is.**
Both catalogue routes send `formSchema` unfiltered, including `mapsTo` translation maps (for example, impact to priority). The customer can see how answers map to internal priority. This is form configuration, not an ORM row, and it is declared as `z.unknown()`. Consider stripping `mapsTo` from the portal projection.

Staff-route raw rows (N1 in my previous report) are unchanged and remain non-blocking, as agreed.

## Holds re-checked on the delta

The delta touches only two repository queries, two response mappings and two test files. It adds no routes, capabilities, flags, mappings, providers, registration, invitations, SSO, MCP, notification activation or request-type DELETE. `check:openapi` is unchanged at 277 operations.

## Outstanding non-blocking items from the previous report

N1 to N13 and the missing-negative-test list from `664-whole-8528-ordinary-b-opus.md` are not addressed by this delta. They remain non-blocking and should be tracked. The most material are:
- N2: claim and accept asymmetry; the two-triager accept 409 does not show the work item.
- N3: unknown and hidden keys are stored in `formData`.
- N9: hard-coded English and raw enum values in the new screens, against definition of done line 112.
- The absence of IQ-16a withdraw, IQ-3 and RT-8a negative integration tests.

## Residual risk / not checked

- I did not run integration or e2e tests myself. The fixes were confirmed by source reading, typecheck and openapi parity, and the conductor's reported before/after runs.
- B1 regression tests depend on physical row order (see above).
- Security-scope surfaces (portal CSRF, storage carve-out, CI workflow, redocly entries) still need the GPT-6 Sol review on this exact head.

## Secret scan of this report

I ran `/opt/homebrew/bin/gitleaks detect --no-git --source <scratch dir containing only this report>`; no leaks found, exit 0. I re-ran it after this edit.

Verdict: APPROVE
<!-- END REPORT (sha256 d9cdd8452b7df6943fa07daefc7261b0b05829b1f63801b250110a1f0e90d517) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-7b30-security-rebind-opus.md; Claude Opus 5.5; sha256 70c325ba4168420ec3b8b0b74d0c82d6d6de9244ed32ebcdd8e0d578f21903a0) -->
# PR #664 (Intake) — security rebind 852890f4..7b30dfbf

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context)
- **Role:** the same context that wrote the whole-PR review at d43de75b and the rebind at 852890f4. I did not author, direct or remediate fd1fcf17 or 7b30dfbf. I worked read-only and made no repository edits, commits or pushes.
- **Candidate head:** `7b30dfbf7a647119d4247b96248ab9dd89317013`. I confirmed it as worktree HEAD; the tracked tree is clean. The only untracked files are 3 e2e probe files, which are not part of the candidate.
- **Rebind range:** `852890f4193a884a3227bf378d428ba473e3f14c..7b30dfbf7a647119d4247b96248ab9dd89317013` (2 commits: fd1fcf17, 7b30dfbf)
- **Merge base with origin/main:** `8d739bd6a393ad9db5de99c778ebada9d9287ee6` (unchanged)

**Reviewed head:** `7b30dfbf7a647119d4247b96248ab9dd89317013`

## Surfaces examined

- **fd1fcf17: intake flag resolution.** I grepped every read of the instance and workspace feature-flag tables in `apps/api/src/intake`, `apps/api/src/attachment` and `apps/api/src/index.ts`. Every workspace flag read is now keyed by both workspace ID and `feature.intake`:
  - `intake/index.ts:281-286` (`requireIntakeEnabled`): already correct.
  - `intake/repository.ts:563-573` (`portalCatalogue`): fixed in this delta.
  - `intake/repository.ts:695-702` (`createSubmission` in-transaction recheck): already correct.
  - `intake/repository.ts:1643-1650` (`listOwnSubmissions`): fixed in this delta.
  - `attachment/require-submission-attachment-reach.ts:36-41`: already correct.
  - Every instance flag read is likewise filtered on `feature.intake`.
  - Outside the schema, `feature.intake` is referenced only in these three files.
- **7b30dfbf: customer response shapes.**
  - `POST /api/portal/submissions` now returns exactly `id`, `number`, `ref`, `state` and `createdAt`. The stored row is no longer returned, so `formData`, `requesterId`, `organisationId`, version IDs and `workItemId` stay off the wire.
  - Portal attachment `complete` now returns `toAttachmentResponse(...)` plus `workItemId` and `submissionId`. That mapper is explicit and excludes `objectKey`, `workspaceId`, `organisationId` and `submissionFieldKey`.
- **Sweep of every customer-facing (`/api/portal/*`) handler at 7b30dfbf for undeclared or internal fields:**
  - The catalogue list and detail, the own-submission list, and the submission detail (`findPortalSubmission`) all use explicit field mapping.
  - Withdraw returns `ref`, `state` and `version`.
  - The attachment list uses an explicit column select.
  - Download returns a 302 to a signed URL. The key is inherent in a signed URL and is bound by the token.
  - Presign returns `attachmentId`, `uploadUrl` and `uploadHeaders`, which are equally inherent.
  - The remaining residual is in the reply handler; see N-7a below.

## Tests and reproductions

| Run | Result |
| --- | --- |
| `CI=true` `apps/api` `vitest.integration.config.ts` with `intake-feature-gate.test.ts` and `intake-portal-response-shape.test.ts` (testcontainers Postgres) | **2 files, 4/4 passed** |
| `gitleaks detect --log-opts=852890f4..7b30dfbf` (local 8.30.1) | **2 commits, no leaks found** |
| `gitleaks detect --log-opts=origin/main..7b30dfbf` (whole PR) | 49 commits, 1 finding. It is the same synthetic test-token constant already recorded as N-R1 in the 852890f4 rebind (`tests/api/portal-attachment-storage.test.ts:168`, commit 4812dc8c). No new findings. |

**What the new tests assert:**
- The feature-gate test sets an unrelated flag key (`feature.approvals`) in the opposite state to `feature.intake` on two workspaces. It asserts that the catalogue contains the intake-enabled type and excludes the intake-disabled type.
- The response-shape test asserts the exact sorted key sets for both responses, and that the serialised attachment contains no `workspace/` substring.
- The conductor reports the regression test failed before the fix. I did not re-run it against the pre-fix commit.

## Findings

### Blocking

None.

### Closed in this delta

- **Workspace flag rows were not filtered by feature key: CLOSED.** All intake workspace flag reads are now keyed on `feature.intake`.
- **Stored rows returned to customers: CLOSED** for submission create and attachment complete. Neither response contains a storage `objectKey` or an internal parent ID beyond what is declared.

### Non-blocking

- **N-7a. The portal reply response includes one undeclared ID.**
  - `POST /api/portal/submissions/{ref}/messages` still returns the stored `submission_message` row as `message` for clarifying replies (`intake/repository.ts`, `postSubmissionMessage` return).
  - That row adds one undeclared field, `submissionId`: the caller's own submission ID, which the same response already carries as `id`.
  - It contains no storage key and no other party's data. For consistency, map it to the declared `submissionMessageSchema` fields.
- **N-7b. The regression test does not cover the own-submission list.** It exercises the catalogue path. The own-submission list (`listOwnSubmissions`) got the identical fix, which I verified by source only.
- **N-R1 (carried over).** Local gitleaks flags the synthetic test token. The hosted secret scan was green at 852890f4. I did not re-check the hosted run at 7b30dfbf.
- Earlier non-blocking items N2, N3, N5, N-R2, N-R3 and N-R4 are unchanged.

## Residual risk and what was not checked

- No browser or e2e run; the conductor reports the real journey passed at 7b30dfbf.
- I did not re-run the full permissions or API unit suites for this two-commit delta. It touches only the files above, and the integration tests cover the changed behaviour.
- I did not re-check the hosted CI checks at 7b30dfbf.

Verdict: CLEAR
<!-- END REPORT (sha256 70c325ba4168420ec3b8b0b74d0c82d6d6de9244ed32ebcdd8e0d578f21903a0) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-b658-merge-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 3cf309468994383423ec81b85e9eb07b486f661a505e8876480848ba4ce6547f) -->
# PR #664 merge b658d5cc ordinary review

Reviewer model: Claude Sonnet (fresh independent ordinary-review context)

**Reviewed head:** b658d5cc15a1cb7e03c53a3610a152e6772eee33
Parents: 7b30dfbf7a647119d4247b96248ab9dd89317013 (PR), d9af1c83306a0c752ca38c50e70d8f6cf713ce03 (main)
Merge base of the parents: 8d739bd6a393ad9db5de99c778ebada9d9287ee6
Worktree: /Users/heinthura/.codex/worktrees/delivery-conductor-20261011/Ticketing.v2

## Files examined
All 27 conflicted files: 19 locale files plus i18n/schema.json, packages/ui/src/styles/pairs.json, apps/web/e2e/visual-screens.json, apps/web/e2e/visual.spec.ts, apps/web/src/lib/routes.test.ts, apps/web/src/routeTree.agent.gen.ts, apps/web/src/lib/generated-route-metadata.ts, docs/02-design/screen-inventory.md. Also the visual snapshot directory apps/web/e2e/visual.spec.ts-snapshots.

## Method and results
1. Conflict set: `git merge-tree --write-tree 7b30dfbf d9af1c83` reports exactly 27 conflicts. `git diff HEAD <merge-tree tree>` lists exactly those 27 files, so every non-conflicting file in the merge is byte-identical to git's own auto-merge. The file set changed by the PR vs merge base equals the file set changed by HEAD vs main. No conflict markers remain in HEAD.
2. Locales (20 files under i18n, scripted three-way at leaf-path level, base 8d739bd6): every leaf key and value equals the three-way expectation. 0 mismatches, 0 true conflicts in locale files, no key lost from either side.
3. i18n/schema.json: `required` has 17 entries (base 13; PR added intake and requestTypes; main added instanceUsers and pendingActions). HEAD is the exact union: 0 lost, 0 extra, 0 duplicates. No property dropped. This is the only same-path conflict in the whole JSON comparison, and it resolves correctly as a union.
4. Duplicate-key scan (tokenizer) over all i18n files, visual-screens.json and pairs.json: 0 duplicate keys.
5. pairs.json: scripted per-entry three-way check on occurrence ids (base, PR, main): 418 entries checked, 0 missing, 0 extra, 0 unexpected entries.
6. visual-screens.json: base 7, PR 12, main 10, HEAD 15 = 7 + 5 + 3. No entry from either side lost, no duplicate. 
7. visual.spec.ts: 15 `@visual` tests. Each of the 15 manifest entries has its test title in the spec and a Linux baseline PNG (15 `-linux.png` files, names match manifest screenshot names). `git diff 7b30dfbf HEAD` shows no removed lines; versus main, the only removed line (an `/api/config` branch restructure) is a PR-side edit, not a loss. The sign-in email test and the three #670 tests are all present.
8. routes.test.ts: nothing removed versus the PR; versus main the only removal is the old `portal` toEqual(["/"]) assertion, which the PR itself replaced (three toContain assertions present). Imports and both describe blocks are present.
9. Generated files: generated-route-metadata.ts has 51 routes: all 48 of the PR's and all 46 of main's present, 0 lost, 0 extra. The three #670 routes (/agent/god-mode/users, /agent/settings/profile/pending-actions, /agent/settings/profile/pending-actions/$id) are in the metadata. routeTree.agent.gen.ts has 51 route imports, none lost from either parent. No conflict markers. (Router-plugin regeneration itself was not rerun; correctness is shown by set comparison and by check:inventory.)
10. screen-inventory.md: HEAD has 138 table rows; stage counts counted directly from the table are P0 8, P1 33, P2 15, P3 23, P4 29, P5 28, P6 2, sum 138. The summary table in HEAD matches these counts and Total 138. Main had P0 summary 7 against 8 actual rows and Total 139 against a stage sum of 138, so the correction is right. Diff versus main only shows the PR's intake, request-type and portal row changes; no #670 row lost.

## Commands run (sandbox lifted because builds write inside the worktree)
- `pnpm check:i18n`: pass (all locale files in sync with en-US).
- `pnpm check:tokens`: pass (418 pairs meet thresholds in light and dark built CSS).
- `pnpm check:visual-scope`: pass (15 screenshot cases, 14 active inventory route rows mapped).
- `pnpm check:inventory`: pass (49 generated routes match metadata; 14 in-progress or complete inventory routes exist).
- `pnpm check:openapi`: pass (277 operations).
- `pnpm test:permissions`: pass (5 of 5 tasks successful, 4 cached).
- `vitest run src/lib/routes.test.ts` in apps/web: 1 file, 22 tests passed.

## Findings
- Blocking: none.
- Non-blocking: untracked probe files remain in the worktree (tests/e2e/playwright.intake-probe.config.ts, tests/e2e/tsconfig.intake-probe.json, tests/e2e/zz-intake-ui-acceptance-probe.spec.ts). They are not in the commit; ensure they are never added.

## Residual risk
- Playwright visual comparison, API and integration suites, and the full web test suite were not run (no Docker or browsers). Linux baselines were checked for presence and naming only, not pixel content. The regenerated route files were verified by set comparison and the checks above, not by rerunning the generator. The `cached` permissions result means that task reused a prior cache hit for 4 of 5 tasks.

Verdict: APPROVE
<!-- END REPORT (sha256 3cf309468994383423ec81b85e9eb07b486f661a505e8876480848ba4ce6547f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-12/664-b658-security-rebind-opus.md; Claude Opus 5.5; sha256 42f86f589b4928820f51d5782d4e648baf8defce4c311e0c306fa6f1aa2159be) -->
# PR #664 (Intake) - security rebind review after main merge

- **Reviewer model:** Claude Opus 5.5 (fresh independent security-review context)
- **Role:** independent security reviewer. Did not author, direct or remediate this candidate.
- **Date:** 2026-10-13
- **Worktree:** /Users/heinthura/.codex/worktrees/delivery-conductor-20261011/Ticketing.v2
- **Candidate (merge) SHA:** `b658d5cc15a1cb7e03c53a3610a152e6772eee33`
- **Parent 1 (PR branch, prior cleared head):** `7b30dfbf7a647119d4247b96248ab9dd89317013`
- **Parent 2 (main, carries #670):** `d9af1c83306a0c752ca38c50e70d8f6cf713ce03`
- **Merge base:** `8d739bd6a393ad9db5de99c778ebada9d9287ee6`
- **Prior exact-head clearance:** Opus CLEAR at 7b30dfbf (664-7b30-security-rebind-opus.md).

## Scope of this rebind

The delta 7b30dfbf..b658d5cc is the merge only, with 27 conflicted files:

- `visual-screens.json`
- `visual.spec.ts`
- `generated-route-metadata.ts`
- `routes.test.ts`
- `routeTree.agent.gen.ts`
- `screen-inventory.md`
- 20 i18n locale files plus `schema.json`
- `pairs.json`

What main brought in is #670 only. It is web-only, plus `scripts/ci/check-bundle-size.mjs`
and its test. There are no changes to `apps/api`, `packages/libs`, `packages/domain` or
`tests/`.

## Surfaces examined

1. **Both sides are preserved.**
   - For every file in the PR range (d9af1c83..b658d5cc), I compared the sorted +/- line set
     against 8d739bd6..7b30dfbf. For every file in the main range, I compared
     8d739bd6..d9af1c83 against 7b30dfbf..b658d5cc. All files match on both sides except
     three.
   - The three exceptions are `screen-inventory.md`, `i18n/schema.json` (keys both sides
     added, which now appear once) and `pairs.json` (the contrast-pair union).
   - No PR file was dropped. The PR and post-merge file lists are identical. There are no
     conflict markers in the tree.
2. **Generated route tree and metadata.**
   - I regenerated both route trees with the repo's own `@tanstack/router-generator`
     (1.167.26), using the `vite.config.ts` options, into a temp directory. After
     normalising import prefixes, both are **byte-identical** to the committed
     `routeTree.agent.gen.ts` and `routeTree.portal.gen.ts`.
   - `generated-route-metadata.ts` resolves to the union of #664's
     `/agent/settings/request-types` and `/agent/triage` and #670's
     `/agent/settings/profile/pending-actions` and `.../$id`. Nothing else changed.
   - `check:inventory` reports 49 canonical generated routes in G5 metadata.
3. **Screen inventory.** The resolved P0 row is 8 and the total is 138, which is internally
   consistent (8+33+15+23+29+28+2). This is a documentation table only.
4. **CP-19 portal client-route allowlist.**
   - `apps/api/src/portal-client-routes.ts` is unchanged by the merge. It lists `/`,
     `/catalogue`, `/sign-in` and `/submissions/$ref`.
   - The regenerated portal tree has exactly those four fullPaths. #670 adds only `/agent/*`
     routes.
   - `tests/api/two-entry-host.test.ts` passes. It asserts that the allowlist equals the
     portal tree and that the portal never falls back to agent files.
5. **Interaction with #670 step-up and pending actions.**
   - #670 adds no server code, so the server step-up API, CSRF middleware, auth helpers and
     portal host isolation are exactly as cleared at 7b30dfbf.
   - On the web side, #670's fetchers use `client` from `@taskdesk/libs`. The PR's
     `hono.ts` change only disables the agent CSRF-token fetch when `agentCsrfToken` is false.
     That option defaults to `MODE !== "portal"`, so the agent build (`--mode agent`) still
     sends the CSRF token on #670's unsafe step-up and pending-action requests.
   - The PR's server CSRF branch applies only to `session.portal === "customer"` with the
     portal session cookie. It also requires an exact portal Origin and
     `appOrigin === "portal"`, so agent-session requests take the unchanged token path.
   - No #670 module imports any PR-changed web module: `portal-auth-client`,
     `fetchers/intake`, the portal providers or the intake libs. `use-intent-lifecycle` has
     no portal consumers.
   - The `check-bundle-size` addition only asserts that the two #670 route chunks stay
     outside the initial agent graph.

## Tests and gates run (at b658d5cc)

- **`pnpm test:permissions`:** 14 files, 88 tests, all passed. This includes route coverage
  and no-inherited-integration-routes.
- **`pnpm check:route-policy`:** exit 0. Turbo ran 5 of 5 tasks successfully, and the
  permissions suite inside it reported 14 files and 88 tests passed.
- **`pnpm check:openapi`:** `tests/api-contract/openapi.json` matches the API
  (277 operations).
- **`pnpm check:i18n`:** all locales are in sync with en-US.
- **`pnpm check:inventory`:** passed (49 generated routes, 14 active inventory routes exist).
- **`check-visual-scope`:** passed (15 screenshot cases, 14 active rows mapped).
- **`check-contrast`:** 418 pairs meet thresholds.
- **Web vitest:** 13 files, 75 tests, all passed. This covers the intake validation and
  visibility tests, `routes.test.ts`, the portal providers, request-types, triage, the
  portal catalogue, sign-in and `submissions/$ref` tests, and the #670 users,
  pending-action detail, fetcher and query tests.
- **API vitest:** 3 files, 22 tests, all passed (`two-entry-host`, `csrf-portal-origin`,
  `portal-attachment-storage`).
- **Domain intake:** 1 file, 51 tests, passed.
- **`packages/libs` `hono.test.ts`:** 1 file, 11 tests, passed.

## Secret scanning

- `gitleaks git` (v8.30.1, repo `.gitleaksignore`) over 7b30dfbf..b658d5cc: no leaks found.
- The PR range d9af1c83..b658d5cc (61 commits) has exactly one finding. It is the known
  non-blocking `generic-api-key` test fixture at
  `tests/api/portal-attachment-storage.test.ts:168` (commit 4812dc8c). There are no other
  findings.
- `gitleaks detect --no-git` on all 27 conflict-resolved files as merged: no leaks found.

## Findings

- **Blocking:** none.
- **Non-blocking:**
  - The known gitleaks fixture hit at `tests/api/portal-attachment-storage.test.ts:168` is
    unchanged by this merge. It is a test literal, not a credential.

## Residual risk / not checked

- No browser or Docker run. I did not re-execute the real-browser intake journey, the visual
  baselines or the image build.
- I did not run API integration suites (they need a private Postgres). The API surface is
  line-identical to the cleared 7b30dfbf head.
- I did not run a full web typecheck or build. The route trees were verified by
  regeneration instead.

**Reviewed head:** `b658d5cc15a1cb7e03c53a3610a152e6772eee33`

Verdict: CLEAR
<!-- END REPORT (sha256 42f86f589b4928820f51d5782d4e648baf8defce4c311e0c306fa6f1aa2159be) -->
