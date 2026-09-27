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

---

## Delta review (Opus 5.5) at 61cf175

**Reviewer:** Opus 5.5, a fresh independent context commissioned by the orchestrating session. It did not author, direct or fix this change.
**Reviewed head:** `61cf175df8e1c9b685d2403b201372bf1c24e728`
**Previous review:** `a9cffc263c73c4ad6b1371fb95c93b61f0cb1e52`
**Fix under review:** `1eabb43`, "fix(identity): close domain review findings"
**Date:** 2026-09-24

**How the head was confirmed.** `git fetch origin pull/346/head` and `gh pr view 346 --json headRefOid` both return `61cf175`.

**Scope of the delta.** `git diff --stat a9cffc2 61cf175 -- packages/domain/src/identity/` shows only `identity.ts` (+58/-8) and `identity.test.ts` (+69). `git log a9cffc2..61cf175 -- packages/domain/src/identity/` lists only `1eabb43`. So the two `main` merges (`b3c88de`, `577aa22`) and the status-only commits did not touch the identity code.

**Probes.** They ran in a scratch test file that was deleted afterwards, and `git status` was clean.

### Closure of the blocking findings

**S1 (ReDoS): CLOSED.**
- **Every regex left in `identity.ts`:**
  - the tenant GUID check at `:141`, which is anchored and uses fixed counts;
  - `/\/(common|organizations)(\/|$)/iu` at `:160`, which has no nested quantifier and no overlapping alternation;
  - `/[_.-]/gu` at `:202`, a single character class.
- All three are linear. `EMAIL_PATTERN` is gone. The PATCH path now uses `String.prototype.trim()`. `normaliseEmail` is now a single loop with a length cap of 254.
- **Timings in Node 24.20.0.**

  | Input | Before (the removed regex) | After (at head) |
  | --- | --- | --- |
  | email `"!@!." + "!.".repeat(50_000) + "@"` | 5,592 ms | 0 ms |
  | email `"a@" + ".".repeat(50_000) + "@"` | 2,555 ms | 0 ms |
  | PATCH path `"x" + " ".repeat(50_000) + "x"` | 2,054 ms | 0 ms |
  | email `"a@".repeat(200_000)` | — | 0 ms |
  | PATCH paths of 200k `/` or 200k `.` | — | 2 ms or less |
  | an issuer made of 200k `/` characters | — | 0 ms |
  | a SCIM key of 600k `_-.` characters | — | 6 ms |

- `CodeQL` is green at the head.

**S2 (`externalId` through PATCH): CLOSED.** At the head, `applyScimPatchOps({externalId: "ext-1", userName: "u"}, [op])` gives:

| PATCH operation | Result |
| --- | --- |
| no path, value `{externalId}`, with op `replace`, `add`, `remove` or `Replace` | `forbidden_attribute` |
| no path, value `{ExternalId}` or `{EXTERNALID}` | `forbidden_attribute` |
| no path, value `{schemas: [core], externalId}` | `forbidden_attribute` |
| JSON with duplicate keys, `{"externalId":"X","externalId":"Y"}` (the last key wins, and it is still refused) | `forbidden_attribute` |
| no path, value `{"urn:ietf:params:scim:schemas:core:2.0:User:externalId": "X"}` | `invalid_resource` |
| no path, value `{"__proto__": {externalId}}` | `invalid_resource` |
| no path, value `{name: {externalId}}` | `invalid_resource` |
| no path, the enterprise-extension key holding `{externalId}` | `ok`, **no-op**. The extension object is ignored and the stored `externalId` is unchanged. |
| `path` of `externalId`, `ExternalId`, `" externalId "` or `urn:…:User:externalId`, with add, replace or remove | `invalid_patch` |
| `path: "active"` with an object value | `invalid_patch` |

- `validateScimPutExternalId` behaves as follows:

  | Stored | Incoming | Result |
  | --- | --- | --- |
  | `"a"` | `"b"` | refused |
  | `"a"` | `"A"` | refused (case-exact, which is correct for `externalId`) |
  | `"a"` | absent | `ok` (see D5) |
  | absent | `"b"` | `ok` |

**S3 (role mapping fails open): CLOSED.** With agent `maxRoleRank: 3`, each of these mapping variants yields `[]`:

| Field | Values tried |
| --- | --- |
| `roleRank` | `NaN`, `undefined`, `null`, `Infinity`, `-1`, `1.5`, `"2"`, `100` (above the ceiling) |
| `grantsInstanceAdmin` | `undefined`, `null`, `true` |
| `grantsSeesAll` | `undefined`, `"false"` |
| `roleIsCustomer` | `undefined` |
| `roleScope` | `"Agent"` |

- **Bad connections also yield `[]`:** `maxRoleRank` of `null`, `NaN`, `undefined` or `-1`, and `portalScope` of `"Agent"` or `"__proto__"`.
- **Empty inputs:** an empty group list or an empty mapping list yields `[]`.
- **Group ids that are prototype keys:** `__proto__`, `constructor` and `toString` with no mapping yield `[]`. The code uses a `Map`, so no prototype lookup happens. A mapping that is literally keyed `__proto__` resolves only to its own valid role.
- **Duplicate mappings for one group:** the last one wins. A valid mapping followed by a malformed one gives `[]`, which fails closed. A rank-99 mapping followed by a valid one gives only the valid role.
- The domain has no role-name dimension, so "unknown role name" is out of scope here. Role existence is the persistence layer's concern (see D3).
- A result above the ceiling, or an authority flag other than exactly `false`, is never returned.

**Consumer-tenant guard (the former S5): CLOSED, with notes.**
- The check is an exact comparison after `toLowerCase()` (`identity.ts:144`). The lowercase and uppercase forms of `9188040d-6c67-4c5b-b112-36a304b66dad` are both refused as `invalid_tenant_id`. With a leading space, the GUID regex refuses it.
- Issuer forms:
  - `/consumers/v2.0` is refused as `tenant_issuer_required`, because it cannot equal `https://login.microsoftonline.com/<tenantId>/v2.0`;
  - `/common` and `/COMMON` are refused as `multi_tenant_issuer_forbidden`;
  - a real tenant paired with the consumer issuer is refused as `tenant_issuer_required`.
- Only that one GUID is blocked, so no legitimate organisation tenant can be caught. The probe `…36a304b66dae`, which differs in the last digit, is accepted.
- The `consumers` issuer is refused under a different error code from `common` and `organizations`. That is cosmetic.

### New findings in the delta

**D1 — BLOCKING (a gate, not a security hole). The domain suite is red at the head, because of the new consumer-tenant assertion.**
- `identity.test.ts:193-197` calls `connection({tenantId: "9188040d-…"})`. That fixture keeps the default tenant's issuer, so the result is `errors: ["invalid_tenant_id", "tenant_issuer_required"]`.
- `toMatchObject` compares arrays by length, so the test fails.
- `pnpm --filter @taskdesk/domain test` at the head gives **9 files, 482 tests: 481 passed, 1 failed.** The required CI checks `unit + component` and `domain coverage (90%)` are both **FAILURE** on `61cf175`.
- The guard itself works (see above). The assertion is what is wrong.
- **Fix:** pass `issuer: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0"` in that fixture, and keep the exact `["invalid_tenant_id"]` expectation.
- **Knock-on effect:** the failing assertion aborts the test early, so the `staff_role_required` assertion after it never runs. That is part of why coverage is low. Coverage with the failure: all files have 89.13% branches, which is under the 90% gate. `identity.ts` has 80.13% branches and 83.09% lines.

**D2 — NON-BLOCKING. The S1 regression tests would not catch a return of the regexes.**
- The committed inputs are `"a".repeat(200_000) + "!@example.com"` and the path `"  " + " ".repeat(100_000) + "active  "`. Run against the *removed* code, both finish in 0 ms.
- The email input is refused only by the new length cap.
- The spaces sit at the start of the path, which `^\s*` consumes in one pass.
- **Suggested inputs:**
  - the path `"x" + " ".repeat(50_000) + "x"`, which took 2 s under the old code, with a time bound (for example `< 200 ms`) or a check on the returned reason;
  - an explicit test of the 254-character cap.

**D3 — NON-BLOCKING, handoff to persistence. `roleId` is not validated.**
- A mapping with `roleId: undefined` or `roleId: ""` passes and is returned, with a valid rank and flags.
- It cannot raise authority, because rank and flags are still checked. It will, however, become an insert with a null or empty foreign key.
- **Fix:** require `typeof roleId === "string" && roleId.length > 0`, which follows the same fail-closed rule as S3.

**D4 — NON-BLOCKING.** `mapExternalGroupsToRoles(["g"], [null], conn)` throws `TypeError` while building `mappingByGroup` (`identity.ts:445-447`). This is the same class as S8: it surfaces as a 5xx, not as a grant. Skip non-record entries instead.

**D5 — NON-BLOCKING, handoff to the SCIM PUT route.**
- `validateScimPutExternalId("stored", undefined)` returns `ok`.
- The route must treat an absent `externalId` on PUT as "keep the stored value", not as "clear it". Otherwise a PUT without the attribute unbinds the identity key, and the next PUT could set a new one.
- The route must also call the function at all, because nothing forces it to.
- Either document the "absent means keep" contract on the function, or return the value to persist.

**D6 — NON-BLOCKING. What remains of S6 after the new email check.**
- The loop now refuses non-ASCII input, so zero-width, full-width and Cyrillic look-alikes are refused. That is an improvement.
- The Kelvin sign is the gap. `toLowerCase()` runs **before** the ASCII check, so `"Kelvin@x.com"` normalises to `kelvin@x.com` and is accepted, and two different claim strings still produce the same address.
- The domain check looks only at the first dot, so `a@b..` and `a@b.c.` are accepted.
- **Fix:** run the ASCII check before `toLowerCase()`.

**D7 — NON-BLOCKING. Tenant-id case.**
- A connection saved with an uppercase GUID, together with its matching uppercase issuer, validates `ok`.
- Entra sends `tid` and `iss` in lowercase, and `normaliseEntraClaims` compares them exactly, so every login on that connection fails closed.
- **Fix:** normalise `tenantId` to lowercase at save, or refuse uppercase.

**Carried forward, unchanged by `1eabb43`:**
- S4 (the default role is not validated as a mapping);
- S7 (`remove active`, and a scalar value with no path treated as `active`);
- S8;
- S9;
- S10's customer-positive mutation, M6. The customer scope still has no rank ceiling, which is by design.

The gate observations in the previous review (independence of the ordinary review, the attribution mismatch, the draft state) are not re-adjudicated here.

### Verdict

**CHANGES NEEDED at `61cf175df8e1c9b685d2403b201372bf1c24e728`.**
- **Closed:** S1, S2 and S3, and the consumer-tenant guard. Their security content is sound, and I found no new authority, tenant-binding or disclosure hole in `1eabb43`.
- **Blocking:** D1. The fix commit ships a failing test, so the required `unit + component` and `domain coverage (90%)` checks are red on this head. The fix is a one-line change to a test fixture.
- **After the fix:** a short Opus delta confirmation on the new SHA is enough. It should verify that the diff touches only `identity.test.ts` (plus any of the D2/D3 hardening) and that the suite is green.

---

## Delta review (Opus 5.5) at fafa8ec

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or fix this change.
**Reviewed head:** `fafa8ec09dabdc6db4186f05c7d19ad198d81a6e`
**Previous review:** `61cf175df8e1c9b685d2403b201372bf1c24e728`
**Base:** rebased onto `origin/main` = `0b1bcc1d82f340a8d624fb053835ce3152d8b51d`
**Date:** 2026-09-27

**How the head was confirmed.** `git fetch origin feat/p3-identity-portal` and `gh pr view 346 --json headRefOid` both return `fafa8ec`.

**Scope of the delta.** Compared file by file with `61cf175`:
- `identity.ts`, `portal.ts` and `types.ts` are byte-identical.
- `identity.test.ts` differs only by the D1 fixture's added `issuer`.
- `index.ts` differs only by main's intake/sla-scan exports, picked up by the rebase.
- Every other difference is documentation.

**Suites (Node 24.20.0).**
- `pnpm --filter @taskdesk/domain test`: 11 files, 542/542 passed.
- `tsc --noEmit`: clean.
- Coverage: exit 0 (92.96% statements, 94.15% lines).

### Closure

- **D1: CLOSED.** The fix is test-only. The consumer tenant with a matching issuer gives exactly `["invalid_tenant_id"]`, in lower and upper case.
- **S1: CLOSED.** These all run in 0–11 ms: PATCH paths of 50k and 1M characters with whitespace inside, the old worst-case email inputs at 1 MB, 900k-character `_-.` keys, and a 1 MB `/` issuer.
- **S3: CLOSED.** These give `[]`: rank NaN, null, undefined, Infinity, 2^53, `"20"`, a boxed Number, or above the ceiling; flags null, 0, boxed false, undefined or `"false"`; a mismatched `roleIsCustomer`; an uppercase scope; a bad connection rank or scope.
- **S2: NOT FULLY CLOSED (P1).** Every JSON-shaped input is refused, but an inherited property gets through (below).

### Findings

**P1 — BLOCKING. The S2 guard is bypassed by prototype-inherited fields.**
- **The gap.** The pathless-PATCH guard lists keys with `Object.keys` / `Object.entries`. `parseScimUserFields` reads `input.externalId` and `input.active` through the prototype chain.
- **Reproduction.** Build the value as `Object.assign({}, JSON.parse('{"__proto__":{"externalId":"HIJACK","active":false},"title":"t"}'))` and pass it as a pathless `replace`. The result is `ok`, with `externalId: "HIJACK"` and `active: false`.
- **When it is reachable.** Only when the route copies the body with a plain-assignment copy before calling the function. Raw JSON.parse output is refused.
- **Fix.** `isRecord` (`identity.ts:23-25`) should also require the prototype to be `Object.prototype` or `null`. This was trialled: the probe gives `invalid_patch`, and the 542 existing tests still pass.
- Add a regression test using this input.

**N1 — NON-BLOCKING (functional bug, not security); fix in the same commit.**
- `identity.ts:419-422` and `432-435` use the lowercased path as the key. `replace name.familyName` writes `name.familyname`, and `remove name.givenName` does nothing.
- It has been there since `65a746d` and is untested.
- Map the lowercased path to the real key.

**N2 — NON-BLOCKING.**
- `validateIdentityConnection` returns `ok` for `portalScope: "admin"` or `"Agent"`, because all scope-specific checks are skipped. Mapping still yields `[]`. Refuse any scope that is not `agent` or `customer`.
- A customer `defaultRoleIsCustomer: "false"` passes a truthiness check. This goes with S4.

**N3 — NON-BLOCKING, handoff to the SCIM route and persistence.**
- `userName` is not canonicalised: it is case-insensitive under RFC 7643, and NFC/NFD forms differ. The uniqueness check needs a canonical form.
- `externalId: ""` and a whitespace-only `userName` are accepted.
- Deeply nested extension objects make `hasForbiddenScimAttribute` recurse (the S8 class; the route's body cap covers it).

**Carried forward:** S4, S7, S8, S9, D2, D3, D4, D5, D6 (the Kelvin sign) and D7.

### Verdict

**CHANGES NEEDED at `fafa8ec09dabdc6db4186f05c7d19ad198d81a6e`.**
- **Closed:** D1, S1 and S3.
- **Still blocking:** S2 remains open through P1, a one-line fix plus a test.
- **Recommended in the same commit:** the N1 fix.
- **After the fix:** a short Opus delta confirmation on the new SHA is enough.

---

## Fix landed (Claude Sonnet 5) at 919f59c

**Session:** implementation lane, 2026-09-27, in response to the P1/N1 findings directly above.

- **P1 fixed.** `isRecord` (`identity.ts:23-32`) now also requires
  `Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null`,
  rejecting the prototype-inherited-property bypass. The exact reviewer repro
  (`Object.assign({}, JSON.parse('{"__proto__":{"externalId":"HIJACK","active":false},"title":"t"}'))`
  as a pathless `replace` value) is now a regression test in `identity.test.ts`, confirmed to
  return `{ ok: false, reason: "invalid_patch" }` (previously returned `ok` with the hijacked
  `externalId`).
- **N1 fixed.** A `NAME_FIELD_BY_LOWER_PATH` lookup maps the lowercased PATCH path segment back
  to its real camelCase key (`name.givenname` → `givenName`, `name.familyname` → `familyName`,
  `name.formatted` → `formatted`), used by both the `remove` and `add`/`replace` branches
  (`identity.ts:435-451`). A regression test confirms `replace name.familyName "Smith"` now
  actually updates `familyName`, and `remove name.givenName` now actually clears it.
- **Scope.** Diff against `fafa8ec` is exactly two files: `identity.ts` (+35/-9) and
  `identity.test.ts` (+46). `portal.ts`/`types.ts` untouched.
- **Suites:** `pnpm --filter @taskdesk/domain test` — 11 files, 544/544 (542 baseline + 2 new).
  `pnpm typecheck` and `pnpm lint` clean across all 9 workspace packages.

**Awaiting:** the lightweight Opus delta confirmation this review's own verdict called for,
on head `919f59c1e3e...` (full SHA to be confirmed by the confirming reviewer).

---

## Delta confirmation (Opus 5.5) at aa3a4dd

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or fix this change.
**Reviewed head:** `aa3a4dd7efc024780051bd0f3582d6023fcfbe3e`
**Fix commit:** `919f59c998c1bab9ba81bb97240c23fc1dc693f6`
**Previous review:** `fafa8ec09dabdc6db4186f05c7d19ad198d81a6e`
**Date:** 2026-09-27

**How the head was confirmed.** `gh pr view 346 --json headRefOid` returns `aa3a4dd`. The confirmation ran in a detached worktree at that SHA.

**Scope of the delta.**
- `git diff --stat fafa8ec 919f59c` shows only `identity.ts` (+35/-9) and `identity.test.ts` (+46).
- `919f59c..aa3a4dd` touches only this review document.
- The code diff contains exactly two changes: the `isRecord` prototype check, and the `NAME_FIELD_BY_LOWER_PATH` lookup used by the `remove` and `add`/`replace` name branches. The test diff adds exactly two tests, one for each change. Nothing else changed.

**P1: CLOSED.**
- `isRecord` now returns true only when `Object.getPrototypeOf(value)` is `Object.prototype` or `null`.
- **The exact reproduction.** The value `Object.assign({}, JSON.parse('{"__proto__":{"externalId":"HIJACK","active":false},"title":"t"}'))`, sent as a pathless `replace`, now gives `{ ok: false, reason: "invalid_patch" }`. The committed regression test asserts this exact result.
- **Probes** (a scratch file, deleted afterwards; `git status` was clean):

  | Input | Result |
  | --- | --- |
  | The same polluted value with `add` or `Replace` | `invalid_patch` |
  | The polluted value with `path: "active"` | `invalid_patch` |
  | A polluted nested `name` object | `invalid_resource` |
  | A polluted object passed to `parseScimUser` | refused |
  | A class instance | `invalid_patch` |
  | A null-prototype object, or a plain object | `ok`, as intended |

- The polluted value with a pathless `remove` gives `ok`. It leaves `externalId` unchanged and deletes `active`. That is the S7 residual already on record (a pathless `remove` is treated as `remove active`). It is not a P1 bypass, and this delta did not introduce it.

**N1: CLOSED.**
- `replace name.familyName "X"` sets the real `familyName` key. `NAME.FAMILYNAME` does the same.
- `remove name.givenName` clears `givenName`.
- `add name.formatted` and `remove name.formatted` both behave correctly.
- No lowercased key is ever written.
- A `remove` when the user has no `name` is a no-op.
- The input object is not mutated.
- The lookup is reached only after the existing path allowlist, so only its three keys can be looked up.

**Suites (Node 24.20.0).**
- `pnpm --filter @taskdesk/domain test`: 11 files, **544/544** passed.
- `pnpm typecheck` (forced, uncached) and `pnpm lint`: both exit 0.

**Carried forward, unchanged:** N2, N3, S4, S7, S8, S9, D2 to D7.

### Verdict

**CLEAR at `aa3a4dd7efc024780051bd0f3582d6023fcfbe3e`** for the security scope of this review. S2 is now fully closed through P1. The gate observations in the first review (independence of the ordinary review, the attribution mismatch, the draft state) are not re-adjudicated here.

The commit that adds this section is docs-only. It moves the PR head but changes no code.
