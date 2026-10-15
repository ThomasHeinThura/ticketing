# PR #771 security review record: God Mode Authentication/SCIM administration UI (#713)

PR #771 closes #713 (M2). It is the God Mode Authentication/SCIM administration UI over the accepted identity API (#622): connections, SCIM settings, group mappings and token rotation, each with operation-bound step-up and version preconditions. The rotated token is shown once and kept only in component state; client secrets are cleared when a save settles. Non-admins get a client-side denied state, and the server still enforces. Owner decision (2026-10-15): the enable actions ship, and nothing is activated on SIT, UAT or production without approval.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `0b0ad382` (every mutation matches the API), delta APPROVE at `b81491ca`.
- Ordinary review B by Claude Sonnet 5.5: APPROVE at `0b0ad382`, delta APPROVE at `b81491ca`.
- Ordinary reviewers C and D by Claude Sonnet 5.5: mechanical APPROVE of the main merge `8254a594`.
- Security review by Claude Opus 5.5: CLEAR at `0b0ad382` with non-blocking findings (token-in-cache test gap, client-secret retention, `/new` pre-gate), all fixed at `b81491ca`; delta CLEAR there (the admin gate reads the instance-admin bit). Mechanical rebind CLEAR at `8254a594` by a separate Opus context.

**Reviewed head:** `b81491ca4460b08aaa122b1538057c3c2c0a2adc`
**Reviewed head:** `8254a5949657572fe1219eef007814c83154f938`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `771-ordinary-a-sonnet.md` | Ordinary review A (main..b81491ca) | Claude Sonnet 5.5 | `b81491ca` | APPROVE | `c8f54e1905c7563dc3d68c82abe17b89cd218a5a107a8569178d07c77a501ea8` |
| 2 | `771-ordinary-b-sonnet.md` | Ordinary review B (main..b81491ca) | Claude Sonnet 5.5 | `b81491ca` | APPROVE | `0dbec3df3a4f513c772f2a45cb803e39f0902d2c199045f47fd0b523c1e1eb78` |
| 3 | `771-ordinary-c-sonnet.md` | Mechanical check C (b81491ca..8254a594) | Claude Sonnet 5.5 | `8254a594` | APPROVE | `a4949284f348f99cbba1a71e51eae4f321cb853dc9b112f7555ceb19d1e16196` |
| 4 | `771-ordinary-d-sonnet.md` | Mechanical check D (b81491ca..8254a594) | Claude Sonnet 5.5 | `8254a594` | APPROVE | `5d70b8466d082f06f83c5264fcebf02bc4da3a7785a2fe54c0d16848ce61a8f3` |
| 5 | `771-security-opus.md` | Security review, delta and rebind (main..8254a594) | Claude Opus 5.5 | `8254a594` | CLEAR | `cd78cc6f117dfee1c343e34cbfd363d0afaee4e23d8a915ff10c4da167a6636d` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/771-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 c8f54e1905c7563dc3d68c82abe17b89cd218a5a107a8569178d07c77a501ea8) -->
# PR #771 ordinary review A (#713 God Mode Authentication/SCIM admin UI, web-only)

**Reviewed head:** 0b0ad382acf086f23590772b9cb1325c997a27ee
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed live. Scratch worktree `$TMPDIR/rvA-771` at the exact head, removed afterwards. 62 files, web only (no apps/api, packages or control-plane edits). Implementer notes read; I re-derived the contract from the API source rather than trusting them.

## API contract, line by line (against main's accepted API)
| UI mutation | Checked against | Result |
|---|---|---|
| POST /api/instance/identity-connections | `createConnectionRoute` + `identityConnectionCreateRequestSchema` (strict) | DTO fields exactly match (portalScope, organisationId, defaultWorkspaceId, displayName, tenantId uuid, clientId uuid, clientSecret, scopes, optional claimMapping, domainBindings, jitPolicy {enabled, default_role_id, required_entra_app_role}, maxRoleRank). UI always sends portalScope agent, organisationId null, maxRoleRank required, JIT-needs-workspace rule mirrored. Header `x-taskdesk-step-up-token` present. |
| PATCH /api/instance/identity-connections/{id} | `configureConnectionRoute` + configure schema (strict, needs configVersion plus at least one field) | Sends configVersion plus changed fields only; "unchanged" short-circuits before any proof is spent. Never sends tenantId/provider fields. claimMapping only as repair of an `invalid` stored map. |
| GET list / events | list route; `eventHistoryQuery` is strict | `limit`/`cursor` only. Event DTO matches `eventSummary` (kind, outcome, actorType, createdAt). |
| GET/PATCH .../scim | `requestSchema` discriminated union (4 variants) and domain `validateScimAdminRequest` | settings (allowedResources always includes users, matchAttributes canonical order required-first), attribute_mapping (closed 4-field map + version), mapping_create (workspace sends scopeId, customer/organisation omits it as the validator requires), mapping_update (changed fields only, rejects empty update client-side). All match. |
| GET .../scim/mapping-options | strict query (workspaceId, cursor, limit<=100) | Matches; three response variants typed correctly. |
| POST .../scim/rotate-token, revoke-token | `tokenOperationRequest` {version} strict; 200 {configVersion, token, tokenRotatedAt}; 409 {message, currentVersion} | Matches. |
| Step-up | `step-up-api.ts` challenge/proof unions | Operations bound: identity_connection_create (request), identity_connection_configure (connectionId, request), scim_admin_update (connectionId, request), scim_token_rotate/revoke (connectionId, version). Same binding object goes to challenge, proof (plus challengeId, nonce, method, password or code) and the mutation. No new operation invented. |

Version precondition: every parent write carries the version of the snapshot the draft was based on (`useServerDraft` keeps `base`, no silent rebase). 409 shapes handled for all three wire forms (`{message:"version_conflict", currentVersion}`, problem JSON `{title, status, currentVersion}`, challenge `{message, version}`); duplicate 409 (no version) classified separately; plain-text 403 `step_up_unavailable` handled.

No obsolete #589 shape found (no claimMapping-on-every-save, no direct apiFetch from components, no mapping DELETE/bulk, no test-connection). No mutation outside the API's defined set. Customer connections are read-only; creation is staff only and starts disabled; holds respected (no registration, invitation, typed-domain SSO).

## Secrets
- Rotated bearer: obtained inside the mutation function and handed to the caller by callback; the mutation returns only `{configVersion, tokenRotatedAt}`, so it is not in mutation data or any query cache. Held in `useState` in the SCIM panel, cleared on dismissal, on the next action, on unmount. Not in URL, localStorage/sessionStorage, console (grep over all new non-test files: none).
- Client secret: `type="password"` input, never rendered back (only "configured / missing" status); the draft clears after a successful save; a rejected save keeps the draft (intended).
- Step-up secret cleared from state when submitted and on any failure; error classification uses status/kind only and never surfaces server text.
- Fixtures use obviously fake values (`fake-bearer-fixture-value-...`, `csrf-fixture`, `"p".repeat(43)`).

## 409 handling
Conflict keeps the draft and its original base version; a Reload button discards explicitly. Covered by unit tests (editor, SCIM panel) and e2e "a stale SCIM version keeps the draft and reloads on request".

## Commands (exact head)
- `vitest run` (apps/web): Test Files 196 passed, Tests 1102 passed, exit 0.
- `turbo run typecheck --filter=@taskdesk/web`: 5/5 successful, exit 0.
- e2e: identity-connection-admin, identity-connection-events, scim-match-attributes on a scratch config at port 4297 (not committed, deleted): 20 passed, 0 failed, including the axe-tagged cases.
- check:i18n, check:ui, check:tokens (incl. contrast, 418 pairs), check:vocabulary, check:skips, check:policy, check:inventory, check:route-policy: all exit 0. check:visual-scope: exit 0 (21 screenshot cases; the two Linux baselines are committed in the PR).

## Findings
Blocking: none.

Non-blocking:
1. Mutation variables (create/configure bodies including `clientSecret`; step-up token) live in the TanStack mutation observer in memory while the component is mounted (create/configure use `gcTime: 0`; updateScim/revokeToken use the default gcTime but carry no secret). Not persisted or exposed in any shipped path; mention only for devtools-visible memory.
2. `updateScim` and `revokeToken` mutations keep default gcTime; harmless (no secrets) but inconsistent with the others.
3. The step-up challenge/proof bodies for configure/create embed `clientSecret` (that is how the API binds a canonical body); it is sent over the existing authenticated session only, consistent with the API contract.
4. Wording: the fetchers comment says "five closed PATCH variants" but the type (and the API) has four. Comment only.
5. UI cannot show SCIM token presence, test connection, or OIDC group-mapping admin (API gaps recorded by the implementer); #561 status should be reconciled by the conductor, as the implementer noted.

## Residual risk
Mock-API e2e, not a real API run, so shape agreement rests on my line-by-line comparison above (strict zod schemas on the API side make a mismatch a 400/422, never silent). Real-browser run against the real stack is a separate acceptance step.

**Verdict:** APPROVE

---
# Delta review (0b0ad382 -> b81491ca)

**Reviewed head:** b81491ca4460b08aaa122b1538057c3c2c0a2adc
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Live head confirmed. 14 files (+393/-9): new `identity-access-denied.tsx`, `use-instance-admin-signal.ts`; edits to the editor, mutations hook, fetchers (comment only), two routes; new/extended unit and e2e tests.

## Correctness
- Client secret: after each create/configure `step.run` settles (success or failure) the editor calls `mutation.reset()` and blanks `draft.clientSecret`, so the secret leaves both the mutation cache variables and the input. Behaviour change: a rejected save now also loses the typed secret (user must re-enter); other draft fields are kept, and this is the safer choice. `gcTime: 0` is now also set on `updateScim` and `revokeToken` (they carried no secret; consistency only). This resolves my earlier non-blocking points 1 and 2; the "five" comment is fixed to "four" (point 4).
- Instance-admin gate: `useInstanceAdminSignal()` = session `user.role === "admin"`, the same signal already used by the command palette, workspace switcher and approvals. The API's `isCurrentInstanceAdmin` requires `user.role === "admin"` plus an active staff person, so the UI signal is a necessary-condition mirror (it can show the page to an admin whose person is inactive, and the API 403 is still handled). It gates rendering and the data hook (`useIdentityConnections(isAdmin)`, `!creating && isAdmin`), so a non-admin session issues no identity request and renders no form. Hook order is preserved (hooks run before the early return). The API remains the authority.
- Fetcher test: asserts, for all five protected writes, exact URL (including `encodeURIComponent`), method, `x-taskdesk-step-up-token` header and exact JSON body, no header/body on reads, and a classified 403 without the token in the failure. Matches the API contract I verified earlier.

## Commands (exact head, targeted only)
- Unit: `src/fetchers/god-mode`, `src/components/god-mode`, the two authentication route tests, `use-server-draft`: 10 files, 70 tests passed. The three files I mutated: 39 tests passed at baseline.
- Mutations (each reverted, tree clean): drop `forgetClientSecret(configure.reset)` -> 2 fail; blank the draft secret removal -> 2 fail; remove `resetMutation()` -> 3 fail; disable the admin gate in the list route -> 1 fail (non-admin renders nothing test); make the rotate mutation return the bearer -> the "never reaches any cache, URL, history state or web storage" SCIM test fails. Survivor: removing `gcTime: 0` from `updateScim` is not detected (no test covers it; harmless since that mutation holds no secret).
- e2e (scratch port 4296, uncommitted config, deleted): identity-connection-admin, identity-connection-events, scim-match-attributes: 21 passed (the new test covers a non-admin session on the list, `/new` and detail routes: access-denied shown, no form, zero identity API requests, no serious axe violations).
- `turbo typecheck --filter=@taskdesk/web` exit 0 (cached, source unchanged since); check:i18n, check:ui, check:tokens, check:visual-scope: exit 0.

## Findings
Blocking: none. Non-blocking: untested `gcTime: 0` on `updateScim`; the UI admin signal is slightly looser than the API's (inactive staff person case), which is safe because the API still decides.

**Verdict:** APPROVE
<!-- END REPORT (sha256 c8f54e1905c7563dc3d68c82abe17b89cd218a5a107a8569178d07c77a501ea8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/771-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 0dbec3df3a4f513c772f2a45cb803e39f0902d2c199045f47fd0b523c1e1eb78) -->
# Ordinary review B, PR #771 (#713 God Mode Authentication/SCIM admin UI): spec, contract, holds, UX

**Reviewed head:** 0b0ad382acf086f23590772b9cb1325c997a27ee
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** main 8ed5fef24f2e43aa09ac721e3c6faedda9c45030 (merge base)
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only. Reviewer A's report was not read. The implementer's notes (713-impl-sonnet.md) were read as the claimed contract table and checked against specs and source.

## Commands and counts
- `gh pr view 771 --json headRefOid` = head above. 62 files, +14061/-7: web routes, components, fetchers, hooks, lib, 20 locale files plus schema, pairs.json, screen-inventory rows, e2e specs, two Linux visual baselines.
- Web unit suite, run once (`CI=true pnpm exec vitest run` in apps/web): **196 files, 1102 tests passed**, 0 failed.
- `check-ui`: exit 0. `check-tokens` + `check-contrast`: exit 0 (418 source-grounded pairs meet thresholds). `scripts/i18n/check.mjs`: all 20 locale files in sync with en-US, exit 0. `check-inventory`: G5 metadata matches 55 generated routes, the in-progress inventory routes exist. `check-skips`: 792 test files, none skipped or focused.
- Playwright and e2e not run, as instructed.

## Spec and contract consistency
- **Routes and screen inventory:** `/agent/god-mode/authentication` and `/agent/god-mode/authentication/{id}` match the inventory URLs; the two rows are moved from not-started to in-progress only, which is accurate given the gaps below. Registered in `lib/routes.ts` with a typed builder and round-trip tests; generated route metadata updated. The id `new` opens the create form (service-calendar precedent).
- **URL state:** tab (`scim`, `events`), `eventsCursor` and open SCIM `mapping` are in the search string, validated by `parseIdentityConnectionEditorSearch` (cursor pattern and length bounds, unknown tab falls back to the connection tab). This satisfies god-mode.md's "OIDC mapping selection/open state is represented in the screen URL" in spirit for the SCIM mappings it builds.
- **Accepted API only:** every action in the implementer's table maps to an existing route (list, create, configure PATCH with `configVersion`, events, SCIM read, SCIM PATCH kinds settings/attribute_mapping/mapping_create/mapping_update, mapping options, rotate/revoke token). No mutation outside the table; no new step-up operation; no mapping delete or bulk (none exists by contract). Changed-field-only PATCH bodies; a stale `configVersion` yields 409 handled with an explicit reload, not a silent rebase. Fetchers use apiFetch with mirrored DTOs because the generated client cannot address the union-mounted identity routes; acceptable and documented.
- **Step-up (IP-6, PA-15):** per-operation fresh verification via the two-step challenge/proof flow, token carried only in the mutation header, single use; the SCIM bearer is held in component state, shown once, and never reaches the query or mutation cache or the URL. Both `403 step_up_unavailable` (fail closed, per god-mode.md "a mounted route without the verifier fails closed") and denial paths have dedicated copy.
- **IP-5 (instance admin configures every connection; customers cannot):** customer-portal connections are listed read-only with a pointer to the organisation Identity tab; there is no customer editor and customers get no access. Create is staff-portal only.
- **Holds respected:** registration, invitations and typed-domain SSO are not exposed or described as active. The domain-bindings help text states that typed-domain sign-in routing is not active and bindings are stored for discovery and collision checks only. Creation is always disabled. No outbound notification activation. Customer SSO not editable here. No MFA policy, session policy or password policy controls (planned, not built). No sign-in or portal changes.
- **Conductor decision to expose staff-connection and SCIM enable actions:** consistent with the specs, not contradicted by them. identity-provisioning.md IP-6 defines `enabled:false` as the disable path in the configuration CAS and "Create starts disabled", so enabling is the same elevated, audited CAS; god-mode.md lists "enable, disable" among connection actions; SCIM enable additionally requires an issued token (UI hint plus server 422). The decision-log holds list does not include enabling a staff connection. I found no spec sentence that forbids it. One cross-reference to settle: open issue #561 says the SCIM PATCH must stay unavailable until the owner contract is implemented; api-design.md now documents the contract and main implements it (per the implementer notes and the god-mode.md text), so this should be noted on #561 rather than left implying the PATCH is unavailable.

## UX, G6 and accessibility
- **G6 four states:** list route has loading (status region with skeletons), error (alert with retry, and a distinct denied state without retry), empty (Empty component), success. The editor route has loading, error/denied, not-found and success; the SCIM panel has loading (status region), error alert, info and success alerts. Editor-level states are exercised by the route and panel unit tests.
- **Access gating:** no client-side instance-admin check; the screen relies on the API's `instance:admin` 403, rendered as a clear denied state. Sibling `users.tsx` does the same, so this is consistent. There is still no God Mode navigation link (shared gap, noted by the implementer).
- **A11y:** labelled status regions, associated labels (grep shows label or aria usage across all new components), alert roles for errors, keyboard-reachable tab and form controls; axe serious/critical scans were run by the implementer in Playwright (not re-run by me).
- **i18n:** new `identityConnections` namespace added to all 20 locales with the repository convention (non-English fall back to en-US text) and schema regenerated; the copy-coverage test and `check:i18n` pass.
- **Design tokens/contrast:** pairs.json occurrence contracts extended; contrast check passes.

## Findings
**Blocking:** none.

**Non-blocking**
1. Spec items not built, recorded in #770: connection delete (specified as a separate typed-name pending action), "Test connection" and "Test SCIM" (no API), SCIM token presence/prefix/rotated-at/last-sync/health (API does not return them; both token buttons are always offered and a revoke with no token is a 422 no-op), no GET-by-id (detail reads the list), OIDC group-mapping admin UI, organisation Identity tab. The 🟡 inventory status and the on-screen note ("token presence, last synchronisation and connection tests are not reported by the API") state this honestly.
2. Default workspace and default role are free-text ids because no selector API exists for the connection editor; usable but error-prone. Client validation catches empty values and malformed UUIDs only; the server remains the authority.
3. The SCIM endpoint URL is derived in the UI (`<api origin>/scim/v2`) and labelled as derived; if the agent origin differs from the API origin in some deployment the shown URL could mislead. Worth a spec line or API field later.
4. Request #561 cross-reference (above): update the issue so the repo does not carry two contradictory statements about SCIM PATCH availability.
5. `packages/libs/src/identity-provisioning.ts` is stale and unused (noted by the implementer); out of scope here but a trap for future callers.

## Residual risk
Playwright, visual comparison and live backend behaviour were not exercised by me; Linux visual baselines are in the diff, macOS ones are not. Security-sensitive behaviour (step-up binding, secret handling) is architectural-level reviewed only; the Sol/Opus security tier is separate.

**Verdict:** APPROVE

---
## Delta review (0b0ad382 to b81491ca)

**Reviewed head:** b81491ca4460b08aaa122b1538057c3c2c0a2adc
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Delta: 14 files (+393/-9): new `use-instance-admin-signal.ts` and `identity-access-denied.tsx`, route gating in `authentication.tsx` and `authentication/$id.tsx`, client-secret clearing in the editor, `gcTime: 0` on the SCIM settings and revoke mutations, a comment correction ("four" PATCH variants), and tests (editor, scim-panel, fetcher, routes, e2e fixture).
- Targeted unit run (`CI=true vitest run` on `components/god-mode`, `fetchers/god-mode`, the God Mode routes, `use-step-up-action`): **10 files, 73 tests passed**, 0 failed. Playwright not run.

## Admin gate signal
- Signal is the session user's `role === "admin"`. Per auth-and-identity.md the instance-administrator grant "changes only the existing `user.role = 'admin'` source", so this is the real instance-admin marker, and `instance:admin` is what the identity routes require server-side (IP-5/IP-6). The same expression is already used client-side in `workspace-switcher.tsx`, `command-palette/index.tsx` and `work-item-approvals.tsx`, so the hook adds no new convention. The doc's "never use `session.user.role` to decide what a person may do" rule is about authorisation; here the value only decides what renders and the hook's comment says every request is still authorised by the API, whose 403 remains handled. That is the correct reading.
- Consistency with other God Mode screens: `users.tsx` has no client gate and relies on the API 403; this PR is stricter. Acceptable and arguably better; the two screens now differ, so a later shared gate for God Mode would be tidy (non-blocking).
- Staleness: a revoked admin whose session still says `admin` sees the screen, but every request 403s into the existing denied state; a non-admin never fires the requests (`useIdentityConnections(isAdmin)` and `!creating && isAdmin` disable the queries), so no wasted or probing calls and no data fetched for non-admins.
- No denied-state flash: the auth provider renders a loading skeleton for the first session fetch, so `isAdmin` is false only when the user is genuinely not an admin.

## Denied-state UX
- Non-admins get the page title, an `h1`, and an error Alert with title and text ("denied"), shared via `IdentityAccessDenied` on both the list and the editor (editor keeps the back link). The same copy is reused for the API 403 case, so both denial paths read identically. No form, no data, no create button is rendered. Nothing in the denied state implies the screen exists in a usable form. Fine.

## Secret hygiene changes
- Client secret: the editor now clears the input draft and resets the mutation (so retained variables drop it) as soon as create or configure settles, on success or failure; tests cover create success, configure success and failure (user must re-enter). `gcTime: 0` on the SCIM settings and revoke mutations removes them from the mutation cache promptly. The bearer test asserts it never reaches any cache, the URL, history state or web storage. These close the gaps I could only note as "held in component state" in the first review.
- Only residual: browser autofill or the user's own clipboard are out of scope.

## Findings
**Blocking:** none.
**Non-blocking:** (1) a shared God Mode gate hook for `users.tsx` for consistency; (2) the earlier non-blocking items (spec gaps #770, free-text ids, derived SCIM URL, #561 cross-reference) are unchanged.

**Verdict:** APPROVE
<!-- END REPORT (sha256 0dbec3df3a4f513c772f2a45cb803e39f0902d2c199045f47fd0b523c1e1eb78) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/771-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 a4949284f348f99cbba1a71e51eae4f321cb853dc9b112f7555ceb19d1e16196) -->
# PR #771 ordinary review C (mechanical check only)

No full review by this reviewer exists for this PR; this file records only the mechanical merge check below.

---

## Mechanical check: merge of main 9bb28099 (#767 merged)

**Reviewed head:** 8254a5949657572fe1219eef007814c83154f938
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate). Mechanical check only: no tests were re-run.

- `gh pr view 771` head equals 8254a5949657572fe1219eef007814c83154f938. Parents: b81491ca4460b08aaa122b1538057c3c2c0a2adc (the previously reviewed head) and 9bb28099a69d1e599e1d7451ebdf6225e380546c (main).
- `git merge-tree --write-tree b81491ca4460b08aaa122b1538057c3c2c0a2adc 9bb28099` prints the same tree as the new head's tree: the merge is clean, with no hand edits or conflict resolution.
- Merge base with main is 8ed5fef2. Main brought 23 files; the diff from the old head to the new head is exactly that file list. None of them is also changed on the PR side since the merge base (overlap: 0 files).

**Verdict:** APPROVE
<!-- END REPORT (sha256 a4949284f348f99cbba1a71e51eae4f321cb853dc9b112f7555ceb19d1e16196) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/771-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 5d70b8466d082f06f83c5264fcebf02bc4da3a7785a2fe54c0d16848ce61a8f3) -->
# #771 ordinary review D

(Created by a mechanical-check append; see the review reports for this PR where they exist.)

---

## Mechanical check after main moved to 9bb28099a69d1e599e1d7451ebdf6225e380546c

**Reviewed head:** 8254a5949657572fe1219eef007814c83154f938
**Model / context:** Claude Sonnet 5.5, fresh independent context (mechanical verification only; no code re-review)

- `gh pr view` head = 8254a5949657572fe1219eef007814c83154f938 (confirmed).
- Parents: first = b81491ca (previously reviewed head), second = 9bb28099a69d1e599e1d7451ebdf6225e380546c (equals origin/main, ancestor of origin/main).
- `git merge-tree --write-tree <p1> <p2>` = 4df06359680daba98635d5c02b22ef1f207cd827, identical to the merge commit's tree: clean merge, no manual conflict resolution or extra edits.
- Overlap between files changed on the PR side and on the main side since the merge base: none (23 files changed on main).
- Tests not re-run (no PR-side change between the reviewed head and this one).

**Verdict:** APPROVE (unchanged from the prior review of b81491ca; for a PR with no prior review of mine, this is a mechanical check only)
<!-- END REPORT (sha256 5d70b8466d082f06f83c5264fcebf02bc4da3a7785a2fe54c0d16848ce61a8f3) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/771-security-opus.md; Claude Opus 5.5; sha256 cd78cc6f117dfee1c343e34cbfd363d0afaee4e23d8a915ff10c4da167a6636d) -->
# PR #771 (#713) — God Mode Authentication / SCIM administration UI — security review

**Reviewed head:** 0b0ad382acf086f23590772b9cb1325c997a27ee
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context

- Reviewer role: independent security reviewer. Did not author, direct or remediate this change.
- Head confirmed via `gh pr view 771` (headRefOid = 0b0ad382acf086f23590772b9cb1325c997a27ee, branch `codex/god-mode-authentication-713`, state OPEN).
- Merge base with origin/main: 8ed5fef24f2e43aa09ac721e3c6faedda9c45030 (origin/main at review time 1455ed80d87806c7c5e22c34e5f0f07c72782289).
- Scope: web-only (apps/web, i18n, ui pairs.json, screen-inventory doc). 62 files; 32 under apps/web/src (+5689). No API, migration or CI change. The API it calls is the accepted #622 surface.
- Read-only: scratch detached worktree, no push/comment/approval/merge.

## Surfaces examined

- `fetchers/god-mode/identity-connections.ts`, `identity-step-up.ts`, `identity-admin-error.ts`
- `hooks/use-step-up-action.ts`, `hooks/use-server-draft.ts`, `hooks/mutations/god-mode/use-identity-connection-mutations.ts`, `hooks/queries/god-mode/use-identity-connections.ts`
- `components/god-mode/identity-connection-editor.tsx`, `scim-panel.tsx`, `scim-token-settings.tsx`, `scim-group-mappings-settings.tsx` (submit path), `step-up-fields.tsx`
- routes `god-mode/authentication.tsx`, `authentication/$id.tsx`, `lib/routes.ts` (search parsing), `query-client/index.ts` (global cache handlers)
- `lib/identity-connection-form.ts` (body builders / configVersion source)
- e2e fixture `e2e/helpers/identity-admin-fixture.ts`, specs, visual baseline PNG (editor)
- API cross-check: `apps/api/src/auth/step-up-api.ts` operation enum / route binding (server binds operation+route+connection+version+body)

## Findings by surface

1. **SCIM bearer (shown once).** The rotate mutationFn passes the bearer to an `onBearer` callback and returns only `{configVersion, tokenRotatedAt}`; `gcTime: 0`. Bearer lives only in `ScimPanelLoaded` React state; cleared on dismiss, on any other SCIM write, on rotate/revoke start, on `ScimTokenSettings` unmount, and on tab switch (Base UI TabsPanel unmounts when inactive). Not in URL (search schema only allows tab/eventsCursor/mapping), not in history state, no localStorage/sessionStorage/IndexedDB/cookie writes, no console/analytics in new code (diff grep: none outside tests). Error objects never contain it. Input is `readOnly`, `autoComplete="off"`, `spellCheck={false}`. Clipboard copy only on explicit click. OK.
2. **Client secret.** `type="password"`, `autoComplete="new-password"`; sent only when non-empty on configure; draft reset after a successful configure; create navigates away (unmount). The create/configure mutations set `gcTime: 0`, so the variables (which include `clientSecret` and the spent step-up token) are removed when the editor unmounts, but remain in the mounted observer's `mutation.state.variables` until then. Severity: low, non-blocking — same in-memory, same-origin lifetime as the form itself, no persister, no devtools in the production client, no global handler serialises variables (global `MutationCache.onError` logs only the error object, whose message is static and whose detail is the server error text). Recommended hardening (non-blocking): call `mutation.reset()` after a successful configure so the secret does not outlive the reset draft.
3. **Step-up binding.** Each protected write goes through `useStepUpAction.run(binding, execute)`; the same request object is used for the challenge, the proof and the mutation body. Operations used: `identity_connection_create`, `identity_connection_configure`, `scim_admin_update`, `scim_token_rotate`, `scim_token_revoke` — matching the server enum and route binding. A fresh challenge+proof is obtained per call; the token is returned to the single `execute` and not stored in state, query cache or storage. The factor secret is cleared from state before the network call and never enters a query/mutation (proof is a direct fetch, not a mutation). A `busyRef` guard prevents concurrent double-spend. Header `x-taskdesk-step-up-token` is set per request in `request()`. OK.
4. **CAS.** All bodies take `configVersion` from the server snapshot the draft was based on (`useServerDraft` base; dirty drafts do not rebase). Configuration queries have `staleTime: Infinity`, no focus refetch, no retry on 4xx. A 409 surfaces a conflict alert (with current version number only) and a user-initiated Reload; no automatic retry with the newer version anywhere (`retry: false` for mutations globally; `run` has no retry loop). OK.
5. **Authorization UX.** No client-side instance-admin route guard; screens rely on server 403 → "Access denied" with no data/forms (list and existing connection), consistent with the existing `god-mode/users` pattern and with server-side enforcement. Customer-portal connections render read-only info only (no editor/SCIM/tabs). No registration/invitation/typed-domain sign-in UI; domain bindings are explicitly labelled as storage-only. Non-blocking note: `/agent/god-mode/authentication/new` renders the create form without a prior read, so a non-admin sees the form; any submit is refused server-side at the step-up challenge/create. UX-only.
6. **Unsafe rendering.** Issuer/redirect URI/display names are rendered as React text (`<dd>`), never as `href`, `window.open`, or `innerHTML`; no `dangerouslySetInnerHTML` in the diff. Navigation targets are constant routes; `id` is URL-encoded in fetch paths. No open redirect. OK.
7. **Fixtures/baselines.** Fixture values are fake (`example.test` domains, `fake-bearer-fixture-value-…`, `fake-secret-placeholder`, repeated-digit GUIDs); inspected the editor baseline PNG — fake values only, secret field empty. OK.

## Commands (scratch worktree $TMPDIR/opus-771 at the exact head)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck` | exit 0, 9/9 tasks successful (8 cache hits) |
| `vitest run` on the 11 new web test files | exit 0, 11 files, 112 tests passed |
| `pnpm --filter @taskdesk/web build` | exit 0 |
| Playwright (scratch config, port 4278, not committed) on `identity-connection-admin`, `identity-connection-events`, `scim-match-attributes` specs | 20/20 passed |

## Mutation tests (all reverted; `git status` clean apart from the uncommitted scratch config, then removed with the worktree)

| Mutation | Expected | Result |
| --- | --- | --- |
| M1: rotate mutation returns `token` in its data (bearer into mutation cache) | test fails | **Killed**: `scim-panel.test.tsx` "never stores the bearer in the mutation cache" failed (1 failed / 16 passed) |
| M2: rotate writes the bearer into the query cache via `setQueryData` | test fails | **Survived**: 17/17 passed. No test asserts the query cache is bearer-free |
| M3: drop the `x-taskdesk-step-up-token` header in `request()` | test fails | **Killed by e2e**: 2 failed / 15 passed (editor configure; SCIM settings save). Unit suites 54/54 passed in three reruns (one earlier run showed 2 transient unit failures that did not reproduce) — header coverage is e2e-only |

## Findings

Blocking: none.

Non-blocking:
- NB-1 (low): client secret and spent step-up token remain in the mounted mutation observer's variables until the editor unmounts (`gcTime: 0` handles post-unmount). Suggest `configure.reset()` / `create.reset()` after success.
- NB-2 (test gap): no unit/e2e assertion that the query cache is bearer-free (M2 survived). Suggest extending the existing mutation-cache assertion to `client.getQueryCache().getAll()`.
- NB-3 (test gap): the step-up header is asserted only in e2e; consider a fetcher-level unit test of `request()`.
- NB-4 (UX): `/authentication/new` shows the create form to a non-admin before any server denial; server enforcement unaffected.

## Residual risk / not checked

- No live-API run against the real #622 server (e2e is mock-API); binding correctness relies on the accepted server-side binding plus fixture shapes.
- Visual spec not re-run (only one baseline image inspected by eye); i18n files and `pairs.json` not reviewed beyond grep for held-capability strings.
- Browser-level memory forensics, extensions and clipboard history are out of scope.

**Verdict:** CLEAR

---

# Delta security review — 0b0ad382..b81491ca

**Reviewed head:** b81491ca4460b08aaa122b1538057c3c2c0a2adc
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), same independent reviewer context as above (not an author, director or remediator of the fix)

- Head confirmed via `gh pr view 771` = b81491ca4460b08aaa122b1538057c3c2c0a2adc. 0b0ad382 (the head reviewed above) is an ancestor; the delta is the single commit b81491ca. 14 files, +393/−9, all web (apps/web/src and apps/web/e2e). No API, migration or CI change.
- Fresh scratch detached worktree at b81491ca; removed afterwards.

## Delta surfaces

1. **Client secret retention (was NB-1).** `IdentityConnectionEditor.forgetClientSecret` calls `mutations.create.reset` / `mutations.configure.reset` and clears `draft.clientSecret` once the write settles, on success and on failure. `updateScim` and `revokeToken` now also use `gcTime: 0`. This resolves NB-1. Minor UX note (non-blocking): the secret is also cleared when `run` returns early because no step-up factor was entered, so the admin has to retype it. That fails safe.
2. **Bearer never cached (was NB-2).** The SCIM panel test now checks the mutation cache, query cache, URL, history state, localStorage and sessionStorage. Production rotate path unchanged. Resolved.
3. **Step-up header coverage (was NB-3).** New `fetchers/god-mode/identity-connections.test.ts` asserts the header, method and exact body on every protected write. Resolved.
4. **Client-side gate (was NB-4).** `useInstanceAdminSignal` returns `useAuth().user.role === "admin"`. Verified this is the instance-admin bit and not a workspace role:
   - It reads the Better Auth user record's `role` from the session (`AuthContext`). The API uses the same field as its only instance-admin signal: `apps/api/src/utils/is-instance-admin.ts` (`user.role === "admin"`), `require-session.ts`, `permissions/resolve-identity.ts` ("today's only instance-admin bit") and `instance/users` (`isInstanceAdmin: row.role === "admin"`).
   - Workspace roles come from a separate source (`use-workspace-permission.ts`, owner/admin per workspace) and are not used here.
   - The same signal is already used client-side in `workspace-switcher.tsx`, `command-palette/index.tsx` and `work-item-approvals.tsx`.
   - The gate runs before any identity query: `useIdentityConnections(isAdmin)` and `(!creating && isAdmin)`. It renders a static denied alert with no forms, which also closes the `/new` gap.
   - Spoofing: someone who tampers with their own client state can only reveal empty UI shells. Every read and write is still authorised server-side, and a 403 shows the existing denied state.
   - A demoted admin with a stale session still sees the shell but gets 403 from the server.
   - This is UX hardening, not an authorization boundary.

## Commands

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck` (whole repo) | exit 0 |
| vitest: `src/components/god-mode src/fetchers/god-mode src/hooks src/lib/identity-connection-form.test.ts src/lib/routes.test.ts src/routes/.../god-mode` | exit 0, 41 files, 258 tests passed |
| `pnpm turbo build --filter=@taskdesk/web^...` then `pnpm --filter @taskdesk/web build` | exit 0 / exit 0 (the first web build attempt in the fresh worktree exited 1 because the workspace dep `@taskdesk/permissions` was not built yet; after building deps, dist was wiped and rebuilt clean; all e2e results below are from clean builds) |
| Playwright, uncommitted scratch config on port 4278: `identity-connection-admin`, `identity-connection-events`, `scim-match-attributes` | 21/21 passed (includes the new non-admin gate spec) |

## Mutations (all reverted; tree clean apart from the scratch config, removed with the worktree)

| Mutation | Result |
| --- | --- |
| M2: rotate writes the bearer into the query cache (`setQueryData`) | **Killed**: scim-panel "never lets the bearer reach any cache, the URL, history state or web storage" failed (1 failed / 16 passed). Survived at 0b0ad382, now covered |
| M3: drop the `x-taskdesk-step-up-token` header | **Killed at unit level**: identity-connections.test.ts "sends the step-up token header, method and exact body on every protected write" failed (1 failed / 2 passed) |
| M4: make `forgetClientSecret` a no-op (no reset, no clear) | **Killed**: 3 editor tests failed (3 failed / 12 passed) |
| G1: `useInstanceAdminSignal` always returns `true` | Unit route tests **survive** (62/62), because they mock the hook. **Killed by e2e**: "a session without the instance-admin signal never sees the create form or reads identity data" failed (1 failed / 10 passed) |
| G2: disable the `!isAdmin` branch in the `$id` route | **Killed**: 2 `$id` route tests failed (2 failed / 20 passed) |

## Delta findings

Blocking: none. NB-1 to NB-4 from the 0b0ad382 review are resolved.

Non-blocking:
- ND-1 (test note): the hook body of `useInstanceAdminSignal` is covered only by e2e, because unit route tests mock it. A two-line unit test of the hook would make coverage independent of e2e. Optional.
- ND-2 (UX): the client secret is cleared even when submit stops before any network call because the step-up factor is missing. This fails safe.

## Residual risk

- Same as above: mock-API e2e only, with no run against the real #622 API. Visual spec not re-run (baselines unchanged in the delta).
- The client gate depends on the session's `role` field. That is display-only; enforcement stays with the server.

**Verdict:** CLEAR

---

## Mechanical rebind by a separate Opus context (not the author of the review above)

This section was written by a different Claude Opus 5.5 context from the one that wrote the original review above. It covers only the mechanical rebind; it does not re-review the PR.

**Reviewed head:** 8254a5949657572fe1219eef007814c83154f938

**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context (the same context that wrote the #760/#768/#769 security reports)
**Main:** 9bb28099a69d1e599e1d7451ebdf6225e380546c (#767 merged: `PUT /api/project/{id}` engagement fields need `project:manage_settings`, plus docs, tests and the review note)
**Previous reviewed head:** b81491ca4460b08aaa122b1538057c3c2c0a2adc

Method (read-only, no checkout of the working tree): `git fetch`, `gh pr view --json headRefOid` (confirmed OPEN, MERGEABLE).
- **Parents:** `git log -1 --format=%P <new>` = `b81491ca4460b08aaa122b1538057c3c2c0a2adc 9bb28099a69d1e599e1d7451ebdf6225e380546c`, which is the previous head plus the new main. It is a plain "Merge remote-tracking branch 'origin/main'" commit.
- **Merge-tree equality:** `git merge-tree --write-tree b81491ca4460b08aaa122b1538057c3c2c0a2adc 9bb28099a69d1e599e1d7451ebdf6225e380546c` = 4df06359680daba98635d5c02b22ef1f207cd827, which equals `<new>^{tree}` = 4df06359680daba98635d5c02b22ef1f207cd827. The merge adds nothing beyond a clean, conflict-free merge.
- **Overlap:** the files the PR changes (from its old merge base) do not intersect the files main changed since that base (empty intersection). `git diff <old> <new> -- <PR files>` is empty, so the PR's own content is byte-identical.
- **Interaction:** main's changes since 8ed5fef2 are the project engagement server rule (#767), deploy/compose/traefik and loopback scripts, docs, the release workflow, and the web test `setup.ts` cleanup hook (test-only). The PR's surfaces are God Mode identity connections, SCIM settings, step-up and the identity e2e fixtures. Main touches none of them, and nothing in #767 interacts with identity administration.
- The original CLEAR at b81491ca carries over to identical PR content.

**Verdict:** CLEAR
<!-- END REPORT (sha256 cd78cc6f117dfee1c343e34cbfd363d0afaee4e23d8a915ff10c4da167a6636d) -->
