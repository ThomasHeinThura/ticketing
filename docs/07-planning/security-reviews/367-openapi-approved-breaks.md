# Pre-merge security review — PR #367 (reviewed allowlist for pre-2.0 OpenAPI breaks)

**Reviewed head:** `625a7a5586273823f50aa16bce5256d1b8592b75`

**Verdict: SECURITY CHANGES REQUESTED.** One HIGH (F1): an allowlist entry is a standing
approval, not a one-PR approval. After the approved break merges, the entry stays in the file
and silently passes every later break with the same (operation, rule). That later PR does not
touch the file, so it gets no Opus review. The rest of the mechanism holds up. Parsing fails
closed, matching is exact, the version gate is sound, and the Redocly ratchet and the pinned
download are unchanged.

**Reviewer independence.** A fresh Opus 5.5 context that did not author, direct or fix this
change. It worked in a separate worktree at the head above. Its only commit is this note.

**Model:** Claude Opus 5.5. **Tier:** final independent security review (the change is in
`scripts/ci/**`, and the new JSON file is listed in ci-cd.md's scope).

## Method

- Read the full diff against `origin/main`: `test-contract.mjs`, `test-contract.test.mjs`,
  `openapi-approved-breaks.json`, `security-paths.test.mjs`, `ci-cd.md`, `api-design.md` and
  `decision-log.md`.
- Downloaded the pinned oasdiff 1.32.1 archive. Its SHA-256 matched the pinned
  `7c8939fc…ee7f`, and it reported `oasdiff version 1.32.1`.
- Ran the real binary with `breaking --fail-on WARN --format json` on synthetic base and
  revision specs. Fed the output through the PR's exported `parseApprovedBreaks`,
  `parseOasdiffBreakingJson`, `partitionApprovedBreaks`, `parseLsRemoteTags` and
  `hasStableV2Tag`.

## Real-oasdiff cases (question 1)

| Case | oasdiff finding (level 3 = ERR) | Exit | Caught without an entry? |
| --- | --- | --- | --- |
| path removed (`/gone`) | `api-path-removed-without-deprecation`, `GET /gone` | 1 | yes |
| path with 2 methods removed | two findings, `GET` and `DELETE /items/{id}` | 1 | yes. It needs two entries |
| required request field added | `new-required-request-property`, `POST /items` | 1 | yes |
| response type changed | `response-property-type-changed`, `GET /items/{id}` | 1 | yes |
| security scheme removed from an operation | `api-security-removed`, `POST /items` | 1 | yes |
| query-param enum value removed | `request-parameter-enum-value-removed`, `GET /items` | 1 | yes |
| request property restricted to an enum | `request-property-became-enum`, `POST /items` | 1 | yes |
| response enum value added | `response-property-enum-value-added`, `GET /items` | 1 | yes |
| parameter made required | `request-parameter-became-required`, `GET /items` | 1 | yes |
| unloadable revision spec | stdout empty, stderr `Error: failed to load…` | 102 | yes. `JSON.parse("")` throws, so the check fails closed |

Every finding that oasdiff emitted carried a non-empty `operation`, `path` and `id`. A
finding without them (tested: `[{"id":"x","operation":"GET"}]`, `{}`, `null`, `""`) throws
and fails the check. It is never skipped. The `breaking` command emits only WARN and ERR, so
no INFO findings are dropped. If oasdiff ever emitted an INFO finding, it would fail as
unmatched, which errs on the strict side.

**What oasdiff itself does not flag.** Removing a security-scheme definition that no
operation uses, changing only the top-level `security` requirement, removing a response
enum value, and removing an optional response property all produced `[]` with exit 0. This
is how oasdiff behaves, and the old exit-code gate had the same blind spot. **This PR neither
adds nor widens it.** It is recorded here so nobody assumes the contract gate covers global
security changes.

## Findings

### F1 — HIGH — an entry keeps approving the same (operation, rule) after its PR merges

Entries are never retired. Matching is keyed only on (operation, rule), and entries that
match nothing are not flagged. Nothing ties an entry to the PR that added it: `pr` is
checked to be an integer and then ignored. Once PR A merges its break with an entry, the
finding disappears, because `origin/main` now contains the break. The entry stays in the
file and is ignored until a later PR B makes another break of the same kind on the same
operation. The gate then passes B. B never touches the allowlist file, so the
security-scope classifier asks for no Opus review.

Reproduced with the real binary. `main` already has PR A's approved required property
`must` on `POST /items`, and the file still holds
`{"operation":"POST /items","rule":"new-required-request-property","pr":320,…}`. PR B adds
another required property:

```
$ oasdiff breaking --fail-on WARN --format json rev-reqFieldAdded.json rev-later.json
→ new-required-request-property POST /items :: added the new required request property `must2`
partitionApprovedBreaks → matched 1, unmatched 0   (gate passes)
```

The same problem shows up within one PR. One entry covers every finding with that pair.
A PR that adds required properties `a` and `b` passes on one entry (`matched 2`), even if
the review only looked at `a`.

This contradicts the PR's own docs and decision entry: "every entry is added in the PR that
makes the break and needs an Opus review there" and "Any other breaking finding still fails
CI". #320's list-envelope change (`GET` list routes, response-body/type rules) is the first
planned use. It would leave standing approvals on exactly the routes most likely to change
again.

**Required fix, smallest version.** Count only the entries this PR adds. Read the base copy
with `git show origin/main:scripts/ci/openapi-approved-breaks.json`, treating a missing file
as `[]`. Match findings only against entries that are not in that base copy, compared by
exact key. Entries already on `main` become inert history, and an approval can only come
from a diff that touches the security-scope file. Also fail when a newly added entry matches
no finding, so the file never takes on speculative approvals. For the one-entry-many-findings
case, either match one entry to exactly one finding or add oasdiff's `fingerprint` to the key.
Add a regression test for each: a stale base entry does not approve, and an unused new entry
fails.

### F2 — LOW — oasdiff's exit status is no longer checked

The old gate failed on `breaking.status !== 0`. The new code decides only from the parsed
stdout. Every error I could produce gives empty stdout, so the check still fails closed. For
defence in depth, fail when `status` is not 0 or 1, and when `status === 1` while the
findings list is empty. Not blocking.

### F3 — INFO — allowlist breadth checks (question 2): pass

Matching is exact string equality on `"METHOD path"` plus `id`, joined with `\u0000`. None of
these matched `POST /items` + `new-required-request-property`: `post /items`,
`POST /items/`, `POST  /items`, `POST /items*`, `* /items`, or rule `*`. Path-parameter name
variants never match loosely: a finding's `path` is oasdiff's literal string. Renaming
`{id}` to `{itemId}` produced no finding at all, because oasdiff normalises parameter names.
Duplicate entries and extra or missing keys are rejected. The only problem with breadth is
F1's many-findings-per-entry case.

### F4 — INFO — version gate (question 3): sound

- `hasStableV2Tag` is anchored: `^v?(\d+)\.(\d+)\.(\d+)$`. It rejects `v2.0.0-rc.1`,
  `v2.0.0+build`, `2.0.0-alpha`, `release-2.0.0`, `v2.0`, `V2.0.0`, `"v2.0.0 "` and `v1.9.9`,
  and accepts `2.0.0`. It also accepts `v02.0.0`. That errs toward "post-2.0", which is the
  safe side. `^{}` peeled refs are dropped.
- The tag source matches #331. `release.yml` creates `v${version}` from a SemVer-validated
  input with no build metadata. A pre-release such as `v2.0.0-alpha.1` does not trip the
  gate, and the first stable `v2.x.y` does.
- The remote is right. On `pull_request`, `actions/checkout` sets `origin` to the base
  repository and keeps its token. The same job already runs `git fetch --no-tags origin main`
  against it, so `ls-remote` will work. There are no tags on origin today (`git ls-remote
  --tags origin` is empty). If the lookup fails, the check fails closed.
- Skipping the lookup when the list is empty is correct. An empty list approves nothing, so
  it has nothing to gate. This also keeps the lookup's network dependency off every ordinary
  PR.
- Only someone with write access can add or delete a tag, so a PR author cannot fake
  "pre-2.0".

### F5 — INFO — security scope (question 4): pass

`scripts/ci/openapi-approved-breaks.json` is on its own line in ci-cd.md's scope block.
`readSecurityReviewPaths()` returns it among 37 entries. `scripts/ci/**` covers it anyway.
`security-paths.test.mjs` (7/7) now lists it under `MUST_REQUIRE_REVIEW`. **An edit to the
file cannot skip Opus.** F1 is about approvals that come without any edit to the file.

### F6 — INFO — unchanged machinery (question 5): pass

In `test-contract.mjs`, the only lines the diff removes are the old exit-code branch and its
success message. `version`, `archiveName`, `archiveSha256`, the download, the SHA-256 check,
the `--version` pin check, `redoclyLint` and `unapprovedProblems` are all untouched. Live
run: `Redocly lint: 16 finding(s) remain from origin/main's 16`.

### F7 — INFO — decision-log entry (question 6): accurate

It quotes Thomas's choice ("Reviewed allowlist file"). It names what it supersedes: narrowly,
#355's unconditional failure, and only for exact matches before 2.0. It says the tag is read
from origin, not from `package.json`. ci-cd.md explains why `package.json` (`2.22.0`) is not
used. Once F1 is fixed, the entry's "added in the PR that makes the break" will be enforced
by code rather than only asserted. The entry needs no change for that.

## Test counts at the reviewed head

- `node --test scripts/ci/test-contract.test.mjs scripts/ci/lib/security-paths.test.mjs`:
  **30/30** pass (23 + 7).
- `pnpm test:ci-scripts`: **530/530** pass, 89 suites, 0 fail.
- `pnpm test:contract` (after `git fetch --no-tags origin main`): passes. Redocly 16/16,
  oasdiff 1.32.1 verified, `no unapproved breaking API changes against origin/main (0
  approved)`.
- GitHub checks at `625a7a5`: `contract - OpenAPI drift`, `route policy coverage`, `static`,
  `registers`, `CI matches ci-cd.md`, CodeQL, supply chain, helm and GitGuardian were
  SUCCESS. `integration`, `unit + component`, `build`, `gate checkers + red probes` and
  `pull request template + security review` were still pending when I checked.

## Gate status

This review covers the head above only. **It does not clear the PR.** F1 must be fixed and
get a fresh Opus delta review on the new head before merge. F2 is advisory. No waiver was
sought or used.
