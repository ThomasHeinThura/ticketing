# Security review — #170 `check:dockerfile-deps` (PR #237)

> **Record-recovery note (2026-09-22).** The orchestrating session read this file directly
> from round 1's own write location, saved a copy aside, then deleted the file from the
> working tree while resetting onto a clean branch for an unrelated commit — without first
> checking it into any branch. Round 1's note was genuinely absent from every branch and the
> filesystem when round 2 began (round 2's own note said so honestly, below), which is a real
> process failure independent of the content itself: a security-review finding that exists
> only as a live agent's stdout, with no committed home, is one accidental `git reset` away
> from being gone for good. The saved copy survived in the orchestrating session's own scratch
> directory and is restored below, byte-for-byte, as round 1 originally wrote it. Nothing in
> it has been reconstructed, paraphrased, or edited.

---

## Round 1 — independent Opus review, 2026-09-22 (recovered text, see note above)

**Reviewed head:** `5d9ea27dcb2d116f392c97b2e5921f8e6c381ed4`

Reviewed in an isolated detached worktree at that exact commit, not on `main`. Merge base
with `origin/main`: `88daaf01aee8842c179342a4414ed99fb50fea96`.

### What this PR does

Closes issue #170. Adds `scripts/ci/check-dockerfile-deps.mjs`, which parses the
`Dockerfile`'s `FROM base AS deps` stage and asserts its per-package
`COPY <pkg>/package.json <pkg>/` list matches `pnpm-workspace.yaml`'s discovered workspace
members exactly, using the shared `scripts/ci/lib/workspace-membership.mjs` derivation.
Wired into `package.json` as `check:dockerfile-deps`, into `.github/workflows/ci-fast.yml`'s
`registers` job as a new step, into `scripts/ci/test-all.mjs`'s manifest, and declared as a
row in `docs/04-engineering/ci-cd.md`'s Fast-stage box.

In security-review scope: `.github/**`, `scripts/ci/**`, `docs/04-engineering/ci-cd.md` and
`package.json` are all on `ci-cd.md`'s path list (lines 129–132). This file *is* the gate
machinery.

### Verdict

**CHANGES NEEDED (blocking).** Two demonstrated false negatives in the exact defect class
this gate exists to close (F1, F2), each a one-line fix; plus no test coverage at all (F4)
and a factually false claim in the script's own header (F3), which together are what would
have caught F1 and F2 before review. Everything else verified clean, including the design
decision the whole PR rests on and the CI wiring, both proven empirically rather than read.

---

### Verified clean

**The core claim is true.** Neither workflow builds a container image. Read in full, not
grepped: `.github/workflows/ci-fast.yml` (345 lines), `.github/workflows/ci-full.yml` (119
lines), and the only action either one references,
`.github/actions/setup/action.yml` (corepack, `actions/setup-node`, `pnpm install
--frozen-lockfile` — nothing else). `.github/` contains exactly five files; there is no
other composite or reusable action that could run a build. So the PR's stated reason for a
text-parsing check over BuildKit `COPY --parents` — no pinned `docker`/`buildx` version
exists to confirm support against — is correct as written.

**Scope is exactly as claimed.** `git diff 88daaf01...5d9ea27d --stat` is 5 files, 184
insertions, 0 deletions: the new script, `package.json`, `scripts/ci/test-all.mjs`,
`.github/workflows/ci-fast.yml`, `docs/04-engineering/ci-cd.md`. `git diff ... -- Dockerfile`
is empty — the PR adds a checker and does not touch the checked artifact, as #168 already
fixed it separately.

**The fail/pass proof reproduces**, run directly with `$?` read from the process, not
through a pipe:

| probe | exit | result |
| --- | --- | --- |
| unmodified `Dockerfile` | `0` | `9 workspace package manifest(s) match` |
| `COPY packages/domain/package.json` line removed | `1` | names `packages/domain/package.json` as not COPYed, with the exact line to add |
| stale `COPY packages/ghostpkg/package.json` added | `1` | names it as COPYed but not a workspace package |
| restored | `0` | clean again |

**`readWorkspaceManifests()` genuinely derives from the glob.** Not asserted from the
comment — proven by adding `- tools/**` to `pnpm-workspace.yaml` plus a real
`tools/scaffold/package.json`, after which the gate immediately demanded a COPY line for it.
A two-level-deep `packages/group/nested/package.json` was likewise discovered. No hardcoded
or stale member list on that side of the comparison.

**The root-manifest exclusion is exact and safe.** `readWorkspaceManifests()` seeds its set
with the literal string `"package.json"`, and the PR's filter removes exactly that string.
No real member can produce it: every other entry is `<relative>/package.json` with a
non-empty prefix, because glob roots are non-empty by construction (`globRoot` throws on a
glob whose first segment is a wildcard). There is no way for a real package to be swallowed
by this filter.

**Whitespace tolerance and lookalike rejection are correct.**
`COPY   packages/domain/package.json    packages/domain/   ` passes. All three near-miss
shapes are correctly *not* counted as satisfying: `COPY packages/domain/package-lock.json
packages/domain/`, `COPY packages/domain/src/package.json packages/domain/`, and
`COPY --from=base packages/domain/package.json packages/domain/`.

**Case-different stage names are handled.** `FROM base AS Deps` is found (`STAGE_START`
carries `i`), matching Docker's own case-insensitive stage naming.

**Two stages both named `deps` fails closed.** The parser takes the first and ends at the
second, reporting the rest as missing — exit 1. Moot in practice (BuildKit rejects duplicate
stage names) but it does not silently pick a convenient one.

**The CI wiring is correct and genuinely orphan-proof**, proven by three destructive probes
rather than by reading `test-all.mjs`:

- The step sits in the `registers` job, which is unconditional, has no `if:`, no
  `continue-on-error`, runs on `pull_request` *and* `push: main`, and whose display name
  ("registers - env, vocabulary, reviews, skips, overrides" — the exact string the
  `protect-main` ruleset binds to) is **unchanged** by this PR. A failure goes red on the
  required check.
- Deleting the step from `ci-fast.yml` → `test:all --list` exits 1: *"marks … ENABLED and NO
  workflow executes it."*
- Adding `continue-on-error: true` to the step → exits 1: *"every workflow occurrence …
  CANNOT FAIL A PULL REQUEST … this is a gate in name only."*
- Moving the step to `ci-full.yml` → exits 1: *"is a FAST-stage gate, so it must be satisfied
  by its authorized workflow .github/workflows/ci-fast.yml."*

`ci-cd.md`'s new row parses to the right gate name: the box cell is
`pnpm check:dockerfile-deps Dockerfile=workspace`, separated by a single space, so
`ci-cd-gates.mjs`'s `split(/\s{2,}/)` keeps the whole cell and `normaliseGate` reduces it to
`pnpm check:dockerfile-deps`. Reconciliation is green (`test:all --list` exits 0).

**Test suite.** `node --test 'scripts/ci/**/*.test.mjs'` → **451 tests, 451 pass, 0 fail, 76
suites**, matching the claim exactly. (Node is off-PATH on this host and the fresh worktree
had no `node_modules`; `typecheck-coverage.test.mjs` spawns the real `tsc`, so its three
failures were environmental and cleared once `node_modules` was linked in.)

---

### Findings

#### F1 — BLOCKING. The COPY destination is never validated, so a misdirected manifest passes green

`COPY_MANIFEST` captures the source path as group 1 and matches the destination only as an
unanchored `(?:packages|apps)/[^/\s]+/` — it is never compared to the source's own directory.

Probed for real. Replacing the domain line with:

```
COPY packages/domain/package.json packages/ui/
```

the gate reports `9 workspace package manifest(s) match the deps stage COPY list` and
**exits 0**.

That Dockerfile is broken in precisely the way #168 was: `packages/domain` gets no
`node_modules` after `pnpm install --frozen-lockfile`, and `packages/ui/package.json` is
overwritten with domain's manifest on top. This is not an exotic shape — copying an adjacent
line and editing only the first path is the single most likely way a human adds a new package
to this list, and it is the error mode the gate is being added to catch.

**Fix:** tie the destination to the source. Capture the source directory and backreference
it, or compare in code — e.g. `^COPY\s+((packages|apps)/[^/\s]+/)package\.json\s+\1\s*$`,
with a test for the mismatched-destination case.

#### F2 — BLOCKING. A `FROM` with no `AS` is not treated as a stage boundary, so a later stage's COPY satisfies the gate

`ANY_STAGE` is `/^FROM\s+\S+\s+AS\s+\S+\s*$/i` — it requires an `AS <name>`. A Dockerfile
stage written without one (which is ordinary: the final stage frequently has no name) is not
recognised as the end of the `deps` stage, so `extractDepsStage` keeps slicing forward and
`copiedManifests` counts COPY lines from later stages.

Probed for real. With `COPY packages/domain/package.json packages/domain/` **deleted** from
the `deps` stage and an unnamed intermediate stage added afterwards:

```
FROM deps
COPY packages/domain/package.json packages/domain/
FROM deps AS build
```

the gate reports `9 … match` and **exits 0**, while the `deps` stage does not copy domain at
all.

Latent today — every stage in the current `Dockerfile` is named — but it is a silent
fail-open that arrives the first time anyone un-names a stage, which is exactly the class of
change nobody would think to re-review this gate for.

**Fix:** make the name optional in the boundary pattern: `/^FROM\s+\S+(\s+AS\s+\S+)?\s*$/i`
(it must stay distinct from `STAGE_START`, and the `deps` line itself is already skipped by
the `start === -1` branch). One regression test.

#### F3 — The header's "heredoc is a HARD FAILURE" claim is false; a heredoc body satisfies the gate

The script's header states:

> Anything the grammar cannot read (a re-ordered arg, a multi-line COPY, a heredoc) is a HARD
> FAILURE rather than a silent skip — a `deps` stage this cannot read is not a `deps` stage
> with nothing in it.

There is no hard-failure path in `copiedManifests` at all. It iterates lines, keeps the ones
that match, and silently ignores everything else. Probed: with the real domain COPY line
replaced by

```
RUN cat <<EOF > /tmp/notes
COPY packages/domain/package.json packages/domain/
EOF
```

the gate reports `9 … match` and **exits 0**. The heredoc case is not a hard failure and not
even a silent skip — it is a silent *satisfy*, the worst of the three directions.

Contrived to exploit deliberately, and I am not claiming anyone would. The problem is the
sentence: a false claim written into gate machinery is the thing a later reader trusts
instead of re-deriving. Either implement it (refuse a `deps` stage containing a line the
grammar cannot classify) or correct the sentence to what the code does.

#### F4 — The PR adds no test or probe for the new gate

`node --test 'scripts/ci/**/*.test.mjs'` returns **451 tests at the merge base
(`88daaf01`) and 451 at the head (`5d9ea27d`)** — verified by running both. Nothing new.
`grep -rl` across `scripts/` and `tests/` for `dockerfile-deps`, `extractDepsStage`,
`copiedManifests` or `DOCKERFILE_RELATIVE_PATH` finds only the script itself and
`test-all.mjs`.

The script `export`s `extractDepsStage` and `copiedManifests` — they are exported for
nothing but testability, and nothing tests them. Every comparable gate in `scripts/ci/` has a
unit test or an adversarial red probe (`workspace-membership.test.mjs`,
`check-events.test.mjs`, `workflow-gate-drift.test.mjs`, `atomic-gate-proof.test.mjs`, …).
CLAUDE.md: *every rule that closes a code defect has a test.* F1, F2 and F3 are all cases a
first sitting of that test file would have surfaced.

#### F5 — `packages|apps` is hardcoded on the Dockerfile side, re-introducing the A5 defect the shared lib exists to remove

`readWorkspaceManifests()` derives correctly from the glob (verified above). `COPY_MANIFEST`
does not: it hardcodes a two-segment `(?:packages|apps)/<name>/package.json` grammar. The two
sides of the comparison therefore disagree about what a workspace path can look like, and the
gate deadlocks on any member outside that shape. Probed both:

- adding `- tools/**` plus `tools/scaffold/package.json`, then adding the natural
  `COPY tools/scaffold/package.json tools/scaffold/` line → still exit 1, still reporting it
  as *not* COPYed;
- a package at `packages/group/nested/`, with `COPY packages/group/nested/package.json
  packages/group/nested/` present → still exit 1.

In both cases the diagnostic instructs the reader to add a line that is already sitting in
the file, with no way to satisfy the gate short of editing the script.

Fail-closed, so not dangerous — but this is the same hand-maintained-list-read-as-a-
membership-rule pattern that `workspace-membership.mjs`'s own header (A5) was written to
eliminate, reappearing one file over. Deriving the accepted prefixes from
`readWorkspaceRoots()`, and accepting any depth, would remove it. At minimum the limitation
belongs in the header so the next reader is not debugging a self-contradicting message.

#### N1 — Non-blocking: fail-closed but misleading diagnostics on legitimate spellings

Both of these are valid Dockerfiles that `docker build` handles fine, and both fail the gate
with a message naming a line that is visibly present:

- a backslash-continued `COPY packages/domain/package.json \` / `     packages/domain/`;
- `COPY ./packages/domain/package.json ./packages/domain/`.

Safe direction, and arguably a reasonable house-style constraint — but the message should say
"this line is in a shape the gate cannot read", not "the deps stage does not COPY it". Same
root cause as F3: unreadable lines are reported as absent rather than as unreadable.
(A same-line trailing `# comment` also fails, correctly — Docker would not treat it as a
comment either.)

#### N2 — Non-blocking: two acknowledged scope limits, worth writing down

- The `proddeps` stage hand-enumerates its own COPY list and is unchecked. It is a
  *deliberate subset* (`apps/web` and `packages/mcp` are excluded on purpose), so exact
  matching cannot apply — but it can drift the same way, and nothing says so.
- Deleting `COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./` entirely leaves
  the gate green (probed, exit 0). The root-manifest exclusion is correct per its stated
  intent, but nothing verifies the line it defers to actually exists.

### What round 1 did not do

Round 1 did not run `docker build` against any of the probe Dockerfiles — the false
negatives above are argued from the stage semantics (`pnpm install --frozen-lockfile` needs
each manifest at its own path) and from #168's own recorded failure, not from a rebuilt
image. It did not review `charts/`, `deploy/entrypoint.sh` or anything else outside the five
changed files and the artifacts they read. The 451-test run needed `node_modules` symlinked
in from the primary checkout, so it is the head's test *code* against the primary checkout's
installed dependency tree, not a fresh `pnpm install --frozen-lockfile` in the worktree.

### What would clear round 1

F1 and F2 fixed (roughly two lines between them), F3's header sentence either implemented or
corrected, and a `scripts/ci/check-dockerfile-deps.test.mjs` covering at minimum: missing
line, stale line, destination mismatch, unnamed-`FROM` boundary, and one unreadable-line
shape. F5 and the two notes are recommendations, not blockers.

---

## Round 2 — independent Opus delta-confirmation, 2026-09-22

**Reviewed head:** `d7048a3d8150521602dc1b3c0653f891e962cf1a`
**Branch:** `fix/170-dockerfile-deps-stage-drift`
**Previous reviewed head:** `5d9ea27dcb2d116f392c97b2e5921f8e6c381ed4`
**Reviewer:** Opus 5, fresh independent context. Did not author, direct, or remediate this
change, and did not perform round 1.
**Method:** own detached `git worktree` at the exact head (not `main`, not the worktree the
fix was authored in); the checker exercised end-to-end against a throwaway copy of the whole
repository so every probe ran the real `main()` path, not just the exported helpers.

### Scope of the delta

`git diff 5d9ea27d..d7048a3d` touches exactly two files —
`scripts/ci/check-dockerfile-deps.mjs` (+198/−17) and the new
`scripts/ci/check-dockerfile-deps.test.mjs` (+317). Explicitly confirmed that the diff
contains **nothing** outside those two paths, and that the real `Dockerfile` is not touched
by the fix commit or by the pull request as a whole (PR scope: `.github/workflows/ci-fast.yml`,
`docs/04-engineering/ci-cd.md`, `package.json`, `scripts/ci/test-all.mjs`, plus the two files
above). Every probe below was run against a *copy* of the Dockerfile in a throwaway
repository; the real file was confirmed byte-identical afterwards.

### F1 — misdirected COPY destination — **CLOSED**

`buildCopyManifestPattern()` builds
`^COPY\s+((?:<roots>)/[^/\s]+/)package\.json\s+\1\s*$`. The destination is a genuine
backreference to group 1 (the captured source directory *including* its trailing slash), not
a second independent `(packages|apps)/…/` alternation. It is a real backreference, not a
cosmetic one: the destination must be byte-identical to the source directory.

Probe, against a scratch copy of the real Dockerfile, replacing
`COPY packages/domain/package.json packages/domain/` with
`COPY packages/domain/package.json packages/ui/`:

```
exit=1
A line in the `deps` stage mentions `package.json` but is not a recognized
`COPY <pkg>/package.json <pkg>/` line or the root-manifest bootstrap COPY:
`COPY packages/domain/package.json packages/ui/`.
```

Previously green, now a hard failure with an actionable message. **Near-miss that must still
pass** — correctly matched source and destination with a tab after `COPY` and three spaces
between the arguments — passes clean (`exit=0`, 9 manifests matched), so the fix did not
close F1 by making whitespace brittle.

Worth recording as intentional strictness: the captured group includes the trailing slash, so
`COPY packages/ui/package.json packages/ui` (no trailing slash) is also now a hard failure.
That is correct — without the slash Docker writes a *file* named `packages/ui` when the
directory does not already exist.

### F2 — stage boundary required `AS <name>` — **CLOSED for the reported shape, but the
class is not closed. See finding R2-1 below.**

`ANY_STAGE` is now `/^FROM\s+\S+(\s+AS\s+\S+)?\s*$/i`. The loop-shape subtlety the fix's own
commit message claims to have checked was verified independently rather than accepted: in
`extractDepsStage`, the `start === -1` branch ends in `continue`, so on the iteration that
matches `STAGE_START` the looser `ANY_STAGE` is never reached. The `deps` stage's own opening
line therefore cannot double-match as its own terminator. Confirmed by reading the loop and
by the extracted stage genuinely containing its `FROM base AS deps` line plus its body.

Probe, against a scratch copy of the real Dockerfile with the `deps` stage's nine per-package
COPY lines removed and re-placed inside an un-named `FROM deps` stage sitting between `deps`
and `FROM deps AS build`:

```
exit=1
check:dockerfile-deps: 9 problem(s)
apps/api/package.json is a workspace package manifest ... that the `deps` stage does not COPY ...
```

Previously silently green; now all nine missing manifests are reported. The reported shape is
genuinely fixed.

### F3 — heredoc handling and the hard-failure path — **CLOSED, with one new false positive
(finding R2-2)**

The header's claim is now backed by code. `copiedManifests()` tracks an open heredoc by
terminator word and throws on *any* body line whatever it contains; a line mentioning
`package.json` that matches neither the per-package pattern nor `ROOT_MANIFEST_COPY` throws;
an unclosed heredoc at end of stage throws from a dedicated guard.

**The hard-failure path really does exit non-zero.** Both throws are caught in `main()` and
routed through `finish({failures: [violation(...)]})`, which sets `process.exitCode = 1`
(`scripts/ci/lib/repo.mjs:150`). Verified empirically, not by reading: every probe below
returned a real shell exit code of 1. Nothing is thrown-and-swallowed.

Probes run — the reported heredoc probe plus four fresh attempts to defeat the fix:

| Probe | Result |
| --- | --- |
| `RUN cat <<EOF` body holding a valid-looking `COPY packages/ui/package.json packages/ui/`, with the real line removed | `exit=1`, "inside a heredoc" |
| Heredoc opened and never closed before the stage ends | `exit=1` (the per-line guard fires first when any line follows; the dedicated end-of-stage "never closed" guard is exercised by the test fixture where the opener is the stage's last line) |
| Terminator word that is itself a Dockerfile instruction (`RUN cat <<RUN … RUN`) | `exit=1` — the body line still hard-fails; the terminator's spelling buys nothing |
| Nested-looking heredoc (`<<OUTER` containing `cat <<INNER … INNER`, `OUTER`) | `exit=1` — the outer heredoc's first body line trips it; the inner opener is never interpreted |
| `<<-EOF` dash form with tab-indented body and tab-indented terminator | `exit=1` — lines are trimmed before comparison, so the indented close is matched and the indented body still hard-fails |

I could not construct a heredoc shape that smuggles a manifest COPY past the gate.

One residual worth recording, not blocking: `ROOT_MANIFEST_COPY` will absorb a line of the
shape `COPY packages/ui/package.json extrafile package.json ./`. Probed: the line is silently
skipped, but the outcome is still a failure — `packages/ui/package.json` is then reported as
missing (`exit=1`). Fails closed, so it is a message-quality wrinkle, not a hole.

### F4 — test coverage — **CLOSED, and the tests are non-vacuous**

`node --test scripts/ci/check-dockerfile-deps.test.mjs` → **19/19 pass**. Read in full and
checked each assertion against what the *pre-fix* code would have done, which is the only way
to tell a real regression test from one that passes for an unrelated reason:

- F1's misdirected-destination test asserts a throw whose message embeds the offending line.
  Under round 1's pattern that line matched and no throw occurred — the test genuinely fails
  without the fix. Its paired non-vacuity assertion (the corrected line does enter the set) is
  real, not decorative.
- F1's direct `buildCopyManifestPattern` test asserts `false` for the misdirected spelling and
  `true` for the correct one — both directions, targeting the backreference itself.
- F2's un-named-boundary test asserts first on `extractDepsStage`'s output (the domain COPY
  line must not be inside the extracted stage) and only then on `copiedManifests`. Under the
  old `ANY_STAGE` the first assertion fails. Non-vacuous.
- F3's heredoc test would have passed silently under the old code (the body line matched the
  COPY pattern), so it fails without the fix.
- F3's malformed-line test uses `COPY --from=base …`, which the old code skipped silently with
  no throw. Fails without the fix.
- F3's unclosed-heredoc test is deliberately built without the shared `dockerfile()` helper so
  the opener is truly the stage's last line — this is the one fixture that actually reaches the
  end-of-stage guard rather than the per-line one. That distinction is correct and was
  checked, not assumed.
- The paired GREEN cases (correct shape, blank/comment lines, restricted-roots pair) mean a
  checker gutted to always-throw would fail this suite too.

I specifically looked for the length-mismatch style trap flagged on this project before
(an assertion that holds regardless of the fix). I did not find one. The suite's one genuine
gap: **no test exercises `main()`**, so the F5 wiring is not covered by a test — see below,
where I verified it by live probe instead. Recommend, non-blocking, adding one test that the
roots actually reaching `copiedManifests` come from `readWorkspaceRoots()`.

### F5 — `readWorkspaceRoots()` — **CLOSED, and genuinely load-bearing**

`main()` awaits `readWorkspaceRoots()` and passes the result into `copiedManifests()`, which
feeds `buildCopyManifestPattern()`. Not a cosmetic reference. Verified live rather than by
reading: in a throwaway repository I added `tools/**` to `pnpm-workspace.yaml` and created
`tools/scaffold/package.json`.

- With no COPY line: `exit=1`, "tools/scaffold/package.json … the `deps` stage does not COPY".
- After adding `COPY tools/scaffold/package.json tools/scaffold/`: `exit=0`, **10** manifests
  matched.

Under round 1's hardcoded `packages|apps` the second step could not have passed — that is the
deadlock F5 named, and it is gone.

### Suite, lint, and CI wiring

- `node --test 'scripts/ci/**/*.test.mjs'` → **tests 470, suites 84, pass 470, fail 0,
  skipped 0, todo 0**. Matches the claimed count exactly. (A first run showed one unrelated
  failure in `typecheck-coverage.test.mjs` purely because a fresh worktree has no
  `node_modules`/`tsc`; with the workspace's `node_modules` linked in, 470/470.)
- `biome check` on both changed files: clean, no fixes applied.
- Gate wiring re-verified at this head, not taken from round 1: `package.json` script,
  `ci-fast.yml`'s `registers` job step, `scripts/ci/test-all.mjs` manifest entry, and the
  `ci-cd.md` gate row are all present. The new test file is picked up automatically by the
  existing `scripts/ci/**/*.test.mjs` glob.
- Original behaviour intact: a deleted per-package COPY still reports the specific missing
  manifest; a stale extra COPY still reports the specific extra. Both `exit=1`.

---

## Round 2 findings

### R2-1 — BLOCKING — a `FROM` line carrying a flag is still invisible as a stage boundary

F2's fix widened `ANY_STAGE` to make `AS <name>` optional, but the pattern still requires the
image reference to be the *first* token after `FROM`:

```js
const ANY_STAGE = /^FROM\s+\S+(\s+AS\s+\S+)?\s*$/i;
```

A `FROM` line with a flag — `FROM --platform=$BUILDPLATFORM base AS mid`, the canonical
multi-arch cross-compilation spelling — leaves ` base AS mid` unconsumed and does not match.
The stage boundary is missed, exactly as in F2, and a later stage's COPY lines are again
counted as if they belonged to `deps`.

Reproduced against a scratch copy of the **real** Dockerfile, with the `deps` stage's nine
per-package COPY lines removed from `deps` and placed in the stage after it:

| Boundary line inserted after `deps` | Result |
| --- | --- |
| `FROM deps` (round 1's F2 probe) | `exit=1` — 9 missing reported ✅ |
| `FROM --platform=$BUILDPLATFORM base AS mid` | **`exit=0` — "9 workspace package manifest(s) match"** ❌ |
| `FROM --platform=linux/amd64 node:24` | **`exit=0`** ❌ |
| `FROM node@sha256:abc` | `exit=1` ✅ |
| `FROM base as mid` (lower-case `as`) | `exit=1` ✅ |
| `FROM base AS mid   ` (trailing spaces) | `exit=1` ✅ |

This is the same false-negative class F2 blocked on, reached by one ordinary Dockerfile edit,
and it is not hypothetical for this repository: `Dockerfile` lines 10–11 document
`docker buildx build --platform linux/amd64,linux/arm64 --push .` as the release build, and
`--platform=$BUILDPLATFORM` on a `FROM` is the standard way that build cross-compiles. The
consequence is precisely #168 recurring behind a green gate: `pnpm install --frozen-lockfile`
runs in a `deps` stage missing manifests while the check reports a match.

**The fix should not be another regex widening.** Widening `ANY_STAGE` to
`^FROM\s+(--\S+\s+)*\S+(\s+AS\s+\S+)?\s*$` closes this instance and leaves the next `FROM`
spelling open. Close the class the same way F3 closed its own: **fail closed on any line
inside the `deps` stage that begins with `FROM` and does not match a recognized
stage-boundary shape.** A `deps` stage containing a `FROM` line this gate cannot read is not a
`deps` stage with nothing relevant in it — the argument the header already makes for
`package.json` lines applies unchanged here, and the gate should stop guessing. Widen
`ANY_STAGE` for the flag form *and* add the fail-closed guard; either alone leaves the class
half-open.

Required with the fix: a regression test per direction — a flag-bearing `FROM` correctly ends
the stage, and an unrecognizable `FROM` inside the stage hard-fails — built the same way the
existing F2 tests are, asserting on `extractDepsStage`'s output first.

### R2-2 — NON-BLOCKING — `HEREDOC_START` matches any `<<word` substring

`const HEREDOC_START = /<<-?(['"]?)([A-Za-z_][\w]*)\1/` is unanchored and unconstrained on its
left, so any line containing `<<` followed by a word character is read as opening a heredoc.
Probed: a `deps` stage containing `RUN echo "shift<<left"` reports

```
exit=1
A line inside a heredoc (opened by `<<left`) sits in the `deps` stage: `RUN pnpm install --frozen-lockfile`.
```

— a false alarm naming an innocent line. This fails *closed* (a noisy CI failure, never a
silent pass), so it is not a hole, and no such line exists in the Dockerfile today. Worth
tightening anyway: require the `<<` to be preceded by whitespace or line start, and require
what follows the terminator to be empty or a redirect target. Shell here-strings (`<<<`) and
arithmetic shifts (`$((1<<2))`) were probed and already do not match.

### R2-3 — INFORMATIONAL — N1's two shapes changed failure mode, not failure

Both spellings N1 raised now take the F3 hard-failure path instead of being silently skipped
and reported as a missing manifest:

- backslash-continued COPY → `exit=1`, "not a recognized `COPY <pkg>/package.json <pkg>/`
  line … a line wrapped across multiple lines"
- `COPY ./packages/ui/package.json ./packages/ui/` → `exit=1`, same message

Before and after, both fail; the new message is more accurate about why. No action. Noting it
because the handling did change and a future reader should not mistake it for a regression.

### R2-4 — PROCESS, NON-BLOCKING — round 1's review note was never committed

See the record note at the top of this file. PR #237's body and
`scripts/ci/check-dockerfile-deps.test.mjs`'s header both cite this path as the home of round
1's full findings; the file did not exist. Forty-six other per-PR security-review notes are
committed under `docs/07-planning/security-reviews/`, so the convention is real and this one
fell through. The round-1 finding text, including its probe snippets, is not recoverable from
the repository. No code consequence; recording it so the gap is visible rather than
rediscovered.

---

## Verdict — CHANGES NEEDED (blocking)

F1, F2's reported shape, F3, F4 and F5 are each genuinely closed, verified independently by
reading the code and by live probe against the real checker, not by trusting the fix's own
report or the PR body's self-verification note. The 19 new tests are real regression coverage
that fails without the fix. Suite 470/470, `biome check` clean, diff confined to the two
intended files, real `Dockerfile` untouched.

**R2-1 blocks.** The gate still passes green over a `deps` stage stripped of its manifest
COPY lines when the following stage's `FROM` carries a flag — the same false-negative class
round 1 blocked on, reachable by one ordinary edit, and directly relevant to the multi-arch
build this Dockerfile's own header documents. Close it structurally (fail closed on an
unreadable `FROM` inside the stage) rather than with one more regex widening, add the paired
regression tests, and this is otherwise ready.

R2-2, R2-3 and R2-4 are not blocking and need no re-review round of their own.

---

## Round 3 — independent Opus delta-confirmation, 2026-09-22

**Reviewed head:** `466b92ee7e36dd75c50307e8de90ed5d23cd8e4f`
**Branch:** `fix/170-dockerfile-deps-stage-drift`
**Previous reviewed head:** `d7048a3d8150521602dc1b3c0653f891e962cf1a`
**Reviewer:** Opus 5, fresh independent context. Did not author, direct, or remediate this
change, and did not perform round 1 or round 2.
**Method:** own detached `git worktree` at the exact head (not `main`, not the worktree the
fix was authored in). Every behavioural probe ran the real `main()` end-to-end inside a
throwaway probe repository built from copies of the script, `scripts/ci/lib/`, the
`Dockerfile`, `pnpm-workspace.yaml` and stub member manifests — never against the real file.

### Scope of the delta

`git diff d7048a3d..466b92e --name-only` is exactly three paths: this note (round 1 +
round 2, committed for the first time — closing R2-4), `scripts/ci/check-dockerfile-deps.mjs`
(+85/−18 net) and `scripts/ci/check-dockerfile-deps.test.mjs` (+86). Nothing else. The whole
PR's diff against its merge base touches `Dockerfile` in **0** lines, and the real
`/home/ubuntu/ticketing.v2/Dockerfile` is byte-identical before and after all probing
(`sha256 d75c8ccad9936c8b382e26a31d5e2a09320ee33f36adb559143057afa1a453c3`).

### R2-1 — **CLOSED, and closed at the class level rather than by another widening**

The fix is what it claims. `FROM_LINE` is now `/^FROM\s/i` — the boundary signal is *only*
that the line's first whitespace-delimited token is `FROM`; no shape between `FROM` and the
end of the line is encoded anywhere. `stageNameOf()` tests `FROM_LINE` and then takes a
trailing `/\sAS\s+(\S+)\s*$/i`, so any number of tokens or flags may sit between them;
`isDepsStageStart()` is `stageNameOf(line)?.toLowerCase() === "deps"`. Traced by reading, not
from the docstrings: the `start === -1` branch still ends in `continue`, so the `deps` line
matched by `isDepsStageStart` on that iteration is never re-tested against `FROM_LINE` and
cannot terminate its own stage (confirmed live — `stageLines[0]` is the `FROM ... AS deps`
line and the stage has a body).

Round 2's exact probe, reproduced against a scratch copy of the **real** Dockerfile with the
domain COPY removed from `deps` and re-placed after the inserted boundary:

| Boundary inserted after `deps` | Round 2 | Round 3 |
| --- | --- | --- |
| `FROM --platform=$BUILDPLATFORM base AS mid` | `exit=0` ❌ | **`exit=1`** ✅ |
| `FROM --platform=linux/amd64 node:24` | `exit=0` ❌ | **`exit=1`** ✅ |

### The latent mirror-image bug — **confirmed real, and confirmed closed**

Giving the `deps` stage's *own* opening line a flag:

- `FROM --platform=$BUILDPLATFORM base AS deps`, stage otherwise intact → `exit=0`, 9 matched
  (the stage is still found — not "no `deps` stage found");
- the same line with the domain COPY also deleted → `exit=1` naming
  `packages/domain/package.json` specifically, i.e. the check is genuinely reading that stage
  rather than passing by accident.

### Hunting a fourth instance of the boundary-detection class

Nineteen fresh probes beyond anything rounds 1–2 tried. **All fail closed.** Reported in full
including the ones that found nothing:

| # | Probe | Result |
| --- | --- | --- |
| N1 | digest-pinned unnamed intermediate stage, `FROM base@sha256:<64 hex>` | `exit=1` ✅ |
| N2 | three flags at once + tabs and multiple spaces between every token | `exit=1` ✅ |
| N3 | all-lowercase `from --platform=linux/arm64 base as mid` | `exit=1` ✅ |
| N4 | leading spaces and a tab before the boundary `FROM` | `exit=1` ✅ |
| N5 | trailing tab and spaces after `AS mid` | `exit=1` ✅ |
| N6 | top-level `ARG TARGETPLATFORM` between stages, then a flagged `FROM` | `exit=1` ✅ |
| B1 | CRLF line endings throughout, flagged boundary | `exit=1` ✅ |
| B2 | CRLF pristine control | `exit=0` ✅ |
| B3 | `COPY --link packages/domain/package.json packages/domain/` (real BuildKit flag) | `exit=1`, hard failure naming the extra flag ✅ |
| B4 | `deps` is the **last** stage in the file, domain COPY deleted | `exit=1` ✅ |
| B5 | `deps` is the last stage, intact | `exit=0` ✅ |
| B6 | a second `FROM base AS deps` later in the file holding the domain COPY | `exit=1` ✅ |
| B7 | `AS`-less flagged boundary `FROM --platform=$BUILDPLATFORM base` | `exit=1` ✅ |
| B8 | `COPY <<EOF /dest` heredoc form (not just `RUN <<EOF`) inside `deps` | `exit=1` ✅ |
| B9 | a bare `FROM` line with no arguments inside `deps` | `exit=0` — see R3-2 |
| H1 | heredoc **inside** `deps` whose body holds `FROM scratch AS mid` | `exit=1` ✅ |
| H2 | heredoc **before** `deps` whose body is a complete fake `deps` stage | **`exit=0`** ❌ — see R3-1 |
| H3 | same, but the heredoc body is an *incomplete* fake stage | `exit=1` ✅ |
| H4 | backslash continuation inside `deps` whose wrapped line begins `FROM` | `exit=1` ✅ |

H1 and H4 are the direction the task specifically asked about — a heredoc body or a wrapped
line containing `FROM ...` being misread as ending the stage early. It *is* misread that way
(`extractDepsStage` has no heredoc or continuation awareness), but the consequence is
truncation, which can only ever lose COPY lines, never gain them. Both fail closed with a
correct, specific "the `deps` stage does not COPY …" message. Non-blocking by itself; it is
the input to R3-1 below.

### Round 3 findings

#### R3-1 — NON-BLOCKING (but a genuine fail-**open**) — stage *identification* is not heredoc-aware, so a heredoc body can be read as the `deps` stage instead of the real one

`copiedManifests()` tracks heredocs and hard-fails on their bodies (F3's fix).
`extractDepsStage()` does not — and it runs first, on the raw file, deciding *which* lines are
the `deps` stage. So the `deps` stage it hands to `copiedManifests()` can be a heredoc body.

Probed for real. A `RUN cat <<EOF > /tmp/reference-deps-stage.txt` heredoc placed in the
`base` stage, whose body is a verbatim copy of a complete, correct `deps` stage (its
`FROM base AS deps` line, the root bootstrap COPY, and all nine per-package COPY lines), with
the **real** `deps` stage stripped of all nine per-package COPY lines:

```
exit=0
check:dockerfile-deps: 9 workspace package manifest(s) match the `deps` stage COPY list.
```

The gate read the heredoc body and never looked at the real stage. That is #168 recurring
behind a green gate — the same consequence R2-1 had.

**Why this is not blocking, stated plainly rather than softened.** F2 and R2-1 blocked because
each was reachable by *one ordinary Dockerfile edit* — un-naming a stage, adding
`--platform=`. This is not: it requires someone to write a heredoc into an earlier stage whose
body is a complete and at-the-time-correct duplicate of the deps COPY list, and only then
becomes dangerous once the real stage drifts away from it. Two things bound it further:

- H3 shows the *accidental* version fails closed and loudly. Any such heredoc whose body is
  not a complete correct duplicate turns CI red immediately, so the enabling edit cannot be
  introduced silently.
- The Dockerfile contains no heredocs at all today, and `deps` is 16 lines of literal COPY.

It is also **not a fourth instance of the boundary-detection class** — `FROM_LINE` correctly
recognized every one of the nineteen `FROM` spellings above. It is F3's class (a heredoc body
read as real content) applied to the function F3's fix did not touch. Recording it so the next
reader does not rediscover it.

**Suggested hardening, for whenever this file is next opened — not a condition of this merge.**
Move the heredoc tracking into `extractDepsStage()` (or into a shared single pass) so lines
inside a heredoc cannot be a stage start or a stage boundary. That closes R3-1 and makes H1/H4's
truncation go away at the same time. Roughly ten lines, and a fixture per direction.

#### R3-2 — INFORMATIONAL — a bare `FROM` line is not a boundary

A line that is exactly `FROM` with no arguments does not match `/^FROM\s/i` and is skipped as
an unclassifiable non-manifest line, so the stage continues across it (`exit=0` in B9). No
action: `FROM` with no image is not a valid instruction — `docker build` rejects it outright —
so it cannot exist in a Dockerfile that builds. Noting it only because it is the single `FROM`
spelling the new class-level signal does not treat as a boundary, and a future reader should
know it is deliberate-by-consequence rather than an oversight nobody checked.

#### R2-2, R2-3 — unchanged

Not re-probed beyond confirming the code paths are untouched by this delta. Both remain
non-blocking exactly as round 2 recorded them.

#### R2-4 — **CLOSED**

This note is committed to the branch as part of `466b92e`. Rounds 1 and 2 are present in full,
unmodified; this section is appended below them.

### Regression check — every previous round's probe, re-run at this head

| Probe | Result |
| --- | --- |
| F1 misdirected destination `COPY packages/domain/package.json packages/ui/` | `exit=1` ✅ |
| F1 green pair — tab after `COPY`, three spaces between args | `exit=0`, 9 matched ✅ |
| F2 original — un-named `FROM deps` boundary | `exit=1` ✅ |
| F3 heredoc body holding a valid-looking domain COPY | `exit=1`, "inside a heredoc" ✅ |
| F5a `tools/**` added to `pnpm-workspace.yaml`, no COPY line | `exit=1`, names `tools/scaffold` ✅ |
| F5b same, with `COPY tools/scaffold/package.json tools/scaffold/` | `exit=0`, **10** matched ✅ |
| original — per-package COPY deleted | `exit=1`, names the manifest ✅ |
| original — stale `packages/ghostpkg` COPY added | `exit=1`, names it as extra ✅ |

Nothing regressed.

### The new tests

Three tests in one new `describe` (R2-1's flag-bearing boundary, a multi-flag boundary, and
the latent direction where `deps`'s own line gains a flag). Judged non-vacuous by **mutation
rather than by reading**: restoring round 2's two pre-fix patterns (`FROM_LINE` back to
`/^FROM\s+\S+(\s+AS\s+\S+)?\s*$/i` and `stageNameOf`'s body back to
`/^FROM\s+\S+\s+AS\s+(\S+)\s*$/i`) and leaving everything else alone gives **22 tests, 19
pass, 3 fail** — exactly the three new ones, and none of the pre-existing nineteen. They
cannot pass for the wrong reason, and the fix breaks nothing the earlier rounds pinned.

Each asserts on `extractDepsStage`'s output *first* (the moved COPY line must not be inside
the extracted stage) and only then on `copiedManifests`, which is the ordering R2-1 asked for.
The multi-flag test uses a deliberately unreal flag combination to prove the signal is
shape-agnostic rather than hardcoded to `--platform`. Round 2's one recorded gap — no test
exercises `main()` — is unchanged; I verified that wiring by live probe instead (F5a/F5b
above run the real `main()` against a live `pnpm-workspace.yaml` edit).

### Suite, lint, integrity

- `node --test 'scripts/ci/**/*.test.mjs'` → **tests 473, suites 85, pass 473, fail 0,
  skipped 0, todo 0**. Round 2 was 470/84, so the delta is exactly +3 tests in +1 suite.
  (As in both prior rounds, `typecheck-coverage.test.mjs` spawns the real `tsc` and needs
  `node_modules` present; symlinked in from the primary checkout, then 473/473.)
- `biome check` on both changed source files: clean, no fixes applied.
- The review worktree has no tracked modification after all probing, and the real `Dockerfile`
  hashes identically to the primary checkout's.

### What round 3 did not do

Did not run `docker build` against any probe Dockerfile — R3-1's consequence is argued from
stage semantics and #168's own recorded failure, as in rounds 1 and 2. Did not re-probe R2-2
or R2-3 behaviourally, only confirmed the delta does not touch their code paths. Did not
re-verify the CI wiring (`ci-fast.yml`, `test-all.mjs`, `ci-cd.md`, `package.json`) — round 2
verified it at `d7048a3d` and this delta touches none of those four files. Did not review
anything outside the three changed paths and the artifacts the script reads.

---

## Round 3 verdict — CLEAR WITH FINDINGS (non-blocking)

R2-1 is genuinely closed, and closed the way the standing rule asks: `FROM_LINE = /^FROM\s/i`
is the class-level signal, not a fourth narrow shape. Nineteen fresh adversarial probes across
the full `FROM` grammar — digest pins, stacked flags, tabs, CRLF, lowercase, leading and
trailing whitespace, `ARG` between stages, `deps` as the final stage, duplicate `deps` stages —
found no `FROM` spelling it misses. The latent mirror-image bug the fix claims to have found is
real and is closed in both directions. The three new tests fail against the pre-fix code and
only those three do. Suite 473/473, `biome` clean, delta confined to three intended paths,
real `Dockerfile` untouched.

**No blocking finding.** R3-1 is a genuine fail-open and is recorded as one rather than
downgraded — but it is not an instance of the boundary-detection class this round was convened
over, it is not reachable by any ordinary Dockerfile edit, its accidental form fails closed and
loudly, and the enabling shape does not exist in this repository. It does not justify a fourth
round on a CI-tooling fix of this size. R3-2, R2-2 and R2-3 need no action.

This PR is ready to merge on the gates within this review's scope.
