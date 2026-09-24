# Security review — P3 identity domain foundation (#346)

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating session. Did not author, direct, or remediate this change.
**Reviewed head:** `a9cffc263c73c4ad6b1371fb95c93b61f0cb1e52`
**Reviewed SHA:** `a9cffc263c73c4ad6b1371fb95c93b61f0cb1e52` (confirmed via `gh pr view 346 --json headRefOid` before starting)
**Pull request:** #346 (draft), branch `feat/p3-identity-portal`
**Base at review time:** `origin/main` = `7bebaf61c50d2a65255e459827c88c1d30230340`; the branch's merge base is `21c6a719a00ac5642c4bfd1bfc44606f2507cd41`, so it is one commit behind (#351). A trial merge is textually clean.
**Date:** 2026-09-24

## Surfaces examined

- `packages/domain/src/identity/identity.ts` (the whole file): `normaliseEntraClaims`, `validateIdentityConnection`, `parseScimUser`, `applyScimPatchOps`, `scimConflictResponse`, `mapExternalGroupsToRoles`, `decideProvisioningTransition`
- `packages/domain/src/identity/portal.ts` (`canReachCustomerPortalResource`), `types.ts`, `identity.test.ts`, and the `packages/domain/src/index.ts` re-exports
- Specs:
  - `docs/03-features/identity-provisioning.md`: IP-1 to IP-33, the 25 named acceptance tests, and the IP-18/IP-32 conflict rule as amended by this PR
  - `docs/01-architecture/rbac.md`: the role table (rank, where higher wins), the guardrails, the special customer role, and Reach
  - `docs/03-features/customer-portal.md`: CP-1, CP-2 and CP-16
- Decision log:
  - on the PR branch: the three new 2026-09-23 entries (the GPT-6 ordinary-review substitution, the 25-test Entra gate, and the single generic SCIM 409)
  - on `main`: #336 (three lane agents), #345 (Sonnet fallback) and #351 (current-model fallback)
- GitHub: check runs at the head, the two CodeQL review comments, and the `protect-main` ruleset

## What I probed

Probe tests were scratch files (`pr346-opus-probe.test.ts`). None was committed, and `git status` was clean after removal.

1. **Suites at this head (Node 24.20.0).**
   - `packages/domain` vitest: **9 files, 482 tests, all passed.** The identity file has 12 tests.
   - `tsc --noEmit`: clean.
   - `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 0 fail.**
   - `check-pr-template.mjs --body <PR body>`: **1 problem.** The "Opus security review completed and recorded" box is unticked. It also reports "no security-review path touched" (see S11).
2. **Entra claims.**
   - `tid` and `iss` are both compared exactly against the connection before anything is returned. A wrong tenant, or a `/common` issuer on the token, is refused.
   - The subject is `{oid, tid}`. `sub` is never used, and a non-string or empty `oid` is refused. The address is a snapshot only, so email-to-UPN confusion cannot change the subject. No takeover by mutable email is possible in this layer.
   - `email_verified`, when present and not `true` (including the string `"true"`), is refused. Absence is accepted, as IP-9 requires for Entra.
   - Groups:
     - Overage via `_claim_names.groups` gives `"overage"` (IP-28).
     - A non-string marker, or non-string group entries, are refused.
     - `_claim_names` as an array, and `__proto__`-keyed `_claim_names`, give no overage and no groups, which fails closed.
     - `roles`, `wids`, `hasgroups` and `xms_*` are ignored and confer nothing.
   - Unicode: zero-width, full-width and Cyrillic look-alike addresses all pass `EMAIL_PATTERN`. `U+212A` (the Kelvin sign) lowercases to ASCII `k` (S6).
   - The claims type is named "Verified" but is not branded. Signature, `aud`, `exp` and `nonce` validation is upstream (IP-7), and nothing here can check it.
3. **Connection validation.**
   - These are refused: `/common`, `/organizations`, `{tenantid}`, the v1 `sts.windows.net` issuer, a customer connection with no organisation, an agent connection with an organisation, a customer connection with a `maxRoleRank`, and a NaN rank.
   - **These are accepted:**
     - the Microsoft personal-account (consumer) tenant `9188040d-6c67-4c5b-b112-36a304b66dad` (S5);
     - a customer connection with `defaultRoleRank: 100` (S4).
4. **SCIM parse and PATCH.**
   - These are refused:
     - `__proto__` (from JSON.parse), `constructor`, `id` and `meta`;
     - `roles`, `groups` and `entitlements`, all as `invalid_resource`;
     - `ROLE` and nested `organisation_id` inside `name` or `emails`, as `forbidden_attribute`;
     - a mixed-case `UserName`;
     - filtered paths (`members[value eq "x"]`, `emails[type eq "work"].value`, `roles[primary eq "True"].value`) and enterprise-extension paths, all as `invalid_patch`.
   - No prototype pollution occurred.
   - Patches are atomic: a forbidden op after a valid one refuses the whole patch, and the input is never mutated.
   - **These are accepted:**
     - `externalId` replaced by a PATCH with no path, although the path form refuses it (S2);
     - `remove` with no path and an object value, which is applied as a replace;
     - a scalar value with no path, applied as `active`;
     - `remove userName`, `remove active`, and `replace userName ""` (S7);
     - 100,000 operations in one patch.
   - A non-string `path` or a `null` op **throws** `TypeError` (S8).
5. **ReDoS (the CodeQL alerts at `identity.ts:31` and `:351`), timed in Node 24.**
   - Path trim `/^\s*|\s*$/gu` on `"x" + " ".repeat(n) + "x"`:
     - 10k: 103 ms
     - 30k: 826 ms
     - 100k: **8.5 s**
   - `EMAIL_PATTERN` on `"!@!." + "!.".repeat(n) + "@"`:
     - 20 KB: 285 ms
     - 60 KB: 2.3 s
     - 200 KB: **24 s**
   - A 2 KB input costs about 2 ms (S1).
6. **Role limits and customer reach.**
   - With valid inputs, customer connections take only `customer`-scope, `roleIsCustomer` roles, and agent connections take only staff roles at or below `maxRoleRank` (rbac: higher wins).
   - `grantsInstanceAdmin` and `grantsSeesAll` are refused. An unknown `portalScope`, and the group ids `__proto__` and `constructor`, give nothing.
   - **Accepted (fail-open):** a NaN or `undefined` `roleRank`, and an `undefined` `grantsInstanceAdmin` (S3).
   - If one group has two mappings, the last one wins.
   - Reach:
     - cross-organisation is always false, including when the person is a listed participant;
     - `private` allows only the requester and the participants;
     - an unknown visibility falls through to private semantics.
7. **The 409 rule.**
   - `scimConflictResponse` ignores its argument and returns one constant `{status: 409, scimType: "uniqueness", detail}`. It carries no id and no class, and the two classes compare deep-equal.
   - No other error path in this layer reveals whether an identity exists. `ScimResult` reasons describe the input only.
8. **Purity.**
   - There is no `Date`, `Math.random`, `crypto`, `process`, `fetch` or `node:` import in `identity/`.
   - Every function is deterministic over its arguments.
9. **Mutation checks** (restored after each; `git status` was clean).

   | # | Mutation | Result |
   | --- | --- | --- |
   | M1 | Drop the rank ceiling | Killed |
   | M2 | Drop the org check in `canReachCustomerPortalResource` | Killed |
   | M7 | Drop the `grantsInstanceAdmin` check | Killed |
   | M8 | Drop the `tid` check | Killed |
   | M3 | Drop the `roleIsCustomer` check | **Survived** |
   | M4 | Drop the `grantsSeesAll` check | **Survived** |
   | M6 | Apply the rank ceiling to customer connections | **Survived.** No test maps a customer group positively. |
   | M9 | Drop the `{tenantid}` check | Survived. It is redundant with the equality check. |

   See S10.

## Findings

**S1 — BLOCKING. Polynomial ReDoS in SCIM PATCH path trimming, plus the same class in email validation.**
- **The PATCH path (`identity.ts:351`).** `operation.path?.replace(/^\s*|\s*$/gu, "")` is quadratic. A 100 KB path containing spaces blocks the event loop for 8.5 s. The path is chosen directly by whoever holds a SCIM bearer token, and that includes a customer connection's token, which the customer's own directory holds. So one customer organisation's credential can stall the whole instance for every tenant.
- **Email validation (`identity.ts:19` and `:31`).** `EMAIL_PATTERN` is the same class of bug. It can only be reached today through signed Entra claims, which Entra bounds at about 256 characters, so it is not exploitable now. It will be exploitable as soon as the helper is reused for an unbounded input (for example, the anonymous email field of IP-29 home-realm discovery).
- **Why it blocks.** Both are open CodeQL high alerts, and they fail the `CodeQL` check on this head. The PR body does not mention them; it mentions only the Copilot AI workflow failing.
- **Fix.** Use `String.prototype.trim()` for the path. Replace the email regex with a linear check: one `@`, no whitespace, and a domain with at least one interior dot. Add a timing regression test for each.

**S2 — BLOCKING. A PATCH with no path can rewrite `externalId`, the SCIM identity key.**
- **What happens.** `applyScimPatchOps(cur, [{op: "replace", value: {externalId: "ext-OTHER"}}])` returns `ok` with the new `externalId` (`identity.ts:360-368` via `:241-245`). The path form `{path: "externalId"}` is refused `invalid_patch` (`:379-387`).
- **Why it matters.** `externalId` is part of the external-identity key (identity-provisioning.md, "Identity key"). IP-19 links the first OIDC login by `oid` and `externalId`. IP-17's permitted-attribute list (name, email snapshot, `userName`, title, locale) does not include it. Refusing an attribute through one PATCH form while accepting it through the other is the classic PATCH bypass shape.
- **Fix.** Refuse `externalId` in partial (PATCH) parsing. For PUT, expose a domain check that refuses a changed `externalId` against the stored value, so the future route cannot forget it. Add a test for both PATCH forms.

**S3 — BLOCKING. Role mapping fails open on malformed rank or authority flags.**
- **What happens.** In `mapExternalGroupsToRoles` (`identity.ts:425-434`), `mapping.roleRank > connection.maxRoleRank` is `false` for `NaN`, `undefined` and `null`. The authority flags are tested for truthiness, so a missing flag counts as `false`. Probe results:
  - `roleRank: NaN` returns the role;
  - `roleRank: undefined` returns the role;
  - `grantsInstanceAdmin: undefined` returns the role.
- **Why it matters.** The owner's requirement is that role limits fail closed on anything unknown, and `validateIdentityConnection` already applies `Number.isSafeInteger` to the connection's own ranks. The realistic path is a `LEFT JOIN` from `scim_group_mapping` to a deleted or missing role row, which yields `null` rank and `null` flags.
- **Fix.** Require `Number.isSafeInteger(mapping.roleRank)` (and `>= 0`), `grantsInstanceAdmin === false`, `grantsSeesAll === false`, and exact `roleIsCustomer` booleans. Add a test for each.

**S4 — NON-BLOCKING, must be fixed before the connection-save route lands. The JIT/overage default role cannot be validated like a mapping.**
- **What happens.** `IdentityConnectionDraft` describes the default role only as `defaultRoleRank` and `defaultRoleIsCustomer` (`types.ts:8-10`, `identity.ts:132-160`). The domain therefore cannot refuse a default role that grants instance admin or `sees_all`, or one that is in the wrong scope. A customer connection's default rank is not checked at all (probe: `defaultRoleRank: 100` is accepted).
- **Why it matters.** The default role is granted on every JIT login and on every group overage (IP-28). IP-6 says a mapping to `instance:admin` or `sees_all` must be impossible, and the default role is effectively such a mapping.
- **Fix.** Take the default role as an `AllowedRole`-shaped value and run it through the same predicate as `mapExternalGroupsToRoles`: one shared function, not two copies.

**S5 — NON-BLOCKING. The Microsoft consumer tenant is accepted as a "specific tenant".**
- **What happens.** `tenantId = 9188040d-6c67-4c5b-b112-36a304b66dad`, with its matching v2.0 issuer, validates `ok` (`identity.ts:126-150`).
- **Why it matters.** That tenant represents every personal Microsoft account, so it defeats IP-26's intent in the same way `/common` does. Configuring a connection is instance-admin only (IP-5), so this is a foot-gun rather than an exploit.
- **Fix.** Refuse it at save, alongside `/common` and `/organizations`.

**S6 — NON-BLOCKING. Addresses are not Unicode-normalised, and SCIM email is not validated.**
- **OIDC side.** `normaliseEmail` (`identity.ts:28-32`) trims and lowercases. It accepts zero-width, full-width and Cyrillic look-alike domains. Because `toLowerCase` maps `U+212A` to ASCII `k`, two different claim strings can produce the same address.
- **Impact today.** No takeover is possible: `tid` and `iss` gate first, and the address is not a key. However, IP-9's domain-binding refusal will compare against this output, and a look-alike domain evades that refusal.
- **SCIM side.** SCIM `emails[].value` (`:303-311`) is neither validated nor normalised (probe: `"not an email"` is accepted). IP-18's cross-connection email conflict check needs one canonical form on both paths.
- **Fix.** Use one shared normaliser: NFKC, then an ASCII or punycode domain; reject anything that is not an address.

**S7 — NON-BLOCKING. PATCH semantics are looser than RFC 7644. None of this changes authority.** All in `identity.ts:352-409`:
- `remove` with no path and an object value is applied as a replace (probe: it sets `title`).
- A scalar value with no path is treated as `active`, so `{op: "replace", value: "False"}` deactivates.
- `remove active`, `remove userName` and `replace userName ""` are accepted, and the patched result is not revalidated.
- RFC 7644 §3.5.2.2 requires `noTarget` for a remove with no path.
- Refuse `remove active` explicitly. An absent `active` risks the persistence layer reading it as "default true", which would be a reactivation that bypasses `decideProvisioningTransition`.
- Related: `decideProvisioningTransition("deactivate", "placeholder")` reports `already_deactivated` (`:453-462`), which is a mislabel.

**S8 — NON-BLOCKING, handoff to the SCIM route.**
- `applyScimPatchOps` throws `TypeError` on a non-string `path` or a `null` operation (`identity.ts:349,351`). That surfaces as a 5xx, which Entra retries (IP-32).
- It also accepts any number of operations.
- The route must schema-validate the `PatchOp` body and cap the op count and body size (IP-14) before calling this function. Alternatively, the domain function can take `unknown` and refuse bad input itself.

**S9 — NON-BLOCKING. Authority-attribute classification and Entra interop.**
- **Wrong refusal code.** `roles`, `groups` and `entitlements`, both top-level and as PATCH paths, are refused as `invalid_resource` or `invalid_patch` rather than `forbidden_attribute`. IP-4 says a role supplied in the payload is refused `forbidden_attribute` and recorded as a provisioning-event denial. Add them to `FORBIDDEN_SCIM_KEYS` (`identity.ts:166-184`).
- **Standard attributes refused.** The enterprise extension's standard `organization` attribute is refused `forbidden_attribute`, although IP-31 says the extension is ignored unless mapped. Entra's default `displayName`, `emails[type eq "work"].value` and enterprise-extension PATCH paths are all refused.
- **Risk.** All of these fail closed, so none is a security hole. They do put the real-Entra 25-test gate at risk.

**S10 — NON-BLOCKING. Test gaps on the security branches.**
- Mutations M3 (`roleIsCustomer`), M4 (`grantsSeesAll`) and M6 (rank ceiling applied to customer connections) survive the suite.
- Add three tests:
  - a `sees_all` mapping;
  - a same-scope mapping whose `roleIsCustomer` does not match;
  - a positive customer-group-to-customer-role mapping.
- The tests use ranks 1 to 4, not rbac's real ladder (10 to 100). Using the real values would also catch a comparison written the wrong way round. `identity.test.ts:284-339`.

**S11 — NON-BLOCKING, process, for the orchestrator.**
- `packages/domain/src/identity/**` is not in `ci-cd.md`'s security-review scope list. The template gate therefore reports "no security-review path touched" and would not demand this note.
- This code decides tenant binding and role limits. Adding the path to the scope list is the orchestrator's call, because `ci-cd.md` is orchestrator-owned.

## Gates, at `a9cffc2`

- **Implemented by.** `## Implemented by` says OpenAI GPT-6, in a Codex implementation session. All six commits in `origin/main..a9cffc2` are authored as `Claude Code <noreply@anthropic.com>`. Under the 2026-09-23 decision (#336), that mismatch must be noted on the PR before merge. It is not noted in either the body or the comments.
- **Ordinary review.** Two GPT-6 contexts reviewed it, at `b37cf1d`, then delta-reviewed `a9cffc2`.
  - That is the same model, and by its own description the same tool (Codex, `/root/...` sessions), as the author. Under #336 ("the same agent or tool is never both author and ordinary reviewer"), it is **not independent**.
  - The entry authorising the substitution exists **only on this PR branch**, written in this PR's own commits. It is not on `main`.
  - `main`'s #351 fallback authorises the *orchestrating session* to commission a current-model context. Nothing on record shows the orchestrating session commissioned these two reviews.
  - I cannot verify Thomas's authorisation. It needs his direct confirmation, or a genuinely independent ordinary review.
- **CI.** Every produced required check is green except `pull request template + security review` (the Opus box is unticked). `CodeQL` fails with 2 high alerts (S1). `GitGuardian` fails on `charts/taskdesk/values.yaml:245`, inherited from `main`. The `protect-main` ruleset (updated 2026-09-23T23:33Z) requires two checks that no workflow produces, on this head or on `main`: `domain coverage (90%)` and `e2e - protected-route redirect`. No merge is possible without a bypass until those checks exist.
- **Draft and staleness.** The PR is still a draft. It is one commit behind `main` (#351), and the merge is clean. Any update-branch changes the SHA, so the reviewed SHA needs an explicit delta re-confirmation.

## Verdict

**CHANGES NEEDED at `a9cffc263c73c4ad6b1371fb95c93b61f0cb1e52`.** Three findings block.
- **S1:** a SCIM-token-reachable ReDoS that stalls the instance, plus the CodeQL failure.
- **S2:** the SCIM identity key can be rewritten through a PATCH with no path.
- **S3:** role mapping fails open on a malformed or missing rank or flag.

All three are small, local fixes, and each needs a regression test.

The core design is sound:
- tenant and issuer binding on `oid`+`tid`;
- scope resolved from the connection;
- the customer and staff role split;
- cross-organisation reach refused;
- a byte-identical generic 409;
- pure, deterministic functions.

After the fixes, a delta Opus pass on the new head is enough. The independence and attribution gates above must be resolved separately before merge.
