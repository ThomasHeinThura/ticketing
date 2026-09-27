# PR #422 — ambient module augmentation misattribution in check-deps.mjs (issue #393)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; used direct
manual analysis rather than `pal-mcp`'s `coder` chain — author identity wasn't stated
up front and it flagged the ambiguity itself rather than assume independence, per its own
rule; resolved separately, see below)
**Session:** subagent `aed7457b4631a3d24`
**Verdict: APPROVE**, at head `04721e543620630551908ebacad54200c62a65ab`.

Read the full `resolveWorkspaceTarget` function and `workspaceTargetForSpecifier` directly
(not just the diff's ~2 lines of context) to verify the comment's claim that "the checks
above already handled" every case except third-party specifiers. Traced the loop's
fall-through when `symbol.declarations` contains only `ModuleDeclaration` entries: exits
normally, falls to the relative-path branch or returns null — never a throw, never a false
violation from a null workspace. Confirmed via `typescript/unstable/sync`'s
`getDefaultProjectForFile` that this codebase assigns one Program per tsconfig, so the
regression test's `include`-widening trick genuinely exercises the "same Program" condition
the bug depends on. Confirmed the violation-message assertion matches the real call site's
format. Grepped the whole file for other `.declarations` walks: exactly one call site.

**Author-independence note:** `## Implemented by` on the PR records the implementer as
Sonnet 5 (not `pal-mcp`'s `coder` failover chain), so there was no conflict either way —
this repo's committed-author line reads "Codex GPT-6" for unrelated historical reasons (the
git identity configured on this host), not the implementing model.

## Security review

**Model:** Opus 5.5, fresh independent context (did not author, orchestrate, or previously
review this change)
**Session:** subagent `ae59a5848393e0ee3`

**Reviewed head:** `04721e543620630551908ebacad54200c62a65ab`

**Verdict: CLEAR WITH FINDINGS (all non-blocking)**, at head
`04721e543620630551908ebacad54200c62a65ab`.

Independently verified the fix empirically, not just by reading: checked out the real
pre-fix commit `bc7c798`, ran the actual checker, confirmed 69 real "vitest misattributed to
@taskdesk/ui" violations; applied only the new guard line, re-ran, confirmed 0 violations
("1017 source files … package boundaries hold"). Ran the PR's own regression test with the
guard removed — fails with exactly the three predicted messages — and with the guard
present — passes, full `check-deps.test.mjs` suite 17/17.

**Resolved the ordinary review's flagged discrepancy (the `.declarations`/`.path`
question):** the orchestrating session's own minimal repro (using classic TypeScript's
public API) showed a bare `ModuleDeclaration` node has no own `.path`, suggesting the
pre-existing `typeof resolvedFile !== "string"` check should already have filtered it —
appearing to make the new guard redundant. Opus identified why the repro didn't match
reality: `check-deps.mjs` uses **TypeScript 7.0.2's native API**
(`typescript/unstable/sync`'s `API`), not classic TypeScript — and in that API, every
declaration entry is a `NodeHandle` that carries a `path` (the containing file) on **every**
node kind, not just `SourceFile`. So `declaration.path` on a `ModuleDeclaration` handle is a
real string in the actual code path, and the pre-existing check does *not* filter it out —
the new guard is genuinely load-bearing, not redundant. Confirmed directly against the real
repo at `bc7c798`: `vitest`'s declarations were `[SourceFile .../vitest/dist/index.d.ts,
ModuleDeclaration .../packages/ui/src/test/a11y.ts]` — both with string paths.

**F1 (informational, doc-only):** the fix's own code comment and the `error-fix-loop.md`
entry both describe the bug as "array order" ("the module's own true declaration can sort
after [the augmentation]... trusting whichever comes first") — verified this is not
accurate. In both the real repo and a fresh repro, the real module's `SourceFile`
declaration consistently comes **first**; order is irrelevant. The actual mechanism: the
real declaration lives under `node_modules` (no workspace owns it, loop continues past it
harmlessly), and the augmentation — wherever it sits in the array — is the first (and only)
declaration found *inside* a workspace, so it wins regardless of position. Worth a follow-up
doc correction, not a blocker.

**F2 (informational, wording only):** the comment claims this fallback "only runs for
[specifiers that are] neither a workspace name nor a declared/aliased dependency — i.e.
third-party packages." Relative specifiers (`./…`, `../…`) also reach this loop, since the
`specifier.startsWith(".")` branch is checked *after* it, not before. Doesn't affect
correctness (relative specifiers resolve to real files with real paths, so the loop behaves
correctly for them too) — just an incomplete comment.

**F3 (informational, pre-existing, out of scope):** a narrow gap already existed before this
PR and is not created or widened by it: if a bare specifier links into another workspace via
a mechanism TypeScript can't type-resolve, and a `declare module` shim for that specifier
exists somewhere, the violation was (and, in the shim's-own-workspace case, still is)
detectable only if the shim happens to sit in the target workspace. The real fix, if wanted,
is validating bare names against `package.json`'s declared dependencies — separate, filed as
a follow-up issue, not attempted here.

**A real improvement found, beyond what this PR set out to fix:** Opus adversarially tested
whether the fix could hide a genuine cross-workspace violation and found the opposite — a
case that was silently uncaught *before* this fix (a relative import crossing into another
workspace, disguised by a same-workspace ambient shim like `declare module "*.svg"`) is
correctly caught *after* it, because the shim is now skipped and the loop falls through to
the real cross-workspace file.

**Surfaces examined:** `scripts/ci/check-deps.mjs`'s full `resolveWorkspaceTarget` and
everything downstream that decides violation status; the real historical bug at `bc7c798`
(re-executed, not just read); the new regression test (re-executed both with and without the
fix); two adversarial hand-built cases probing for a new false negative; every other
`declare module` in the repo (`apps/web/src/routeTree.gen.ts`,
`packages/domain/src/audit/node-crypto.d.ts` — both unaffected).

**Filed as follow-ups, correctly out of scope for this PR:** doc-accuracy correction for F1
and F2's comment wording, and F3's pre-existing bare-name-validation gap.
