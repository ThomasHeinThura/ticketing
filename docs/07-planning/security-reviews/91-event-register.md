# Pre-merge security review — PR #91 (event-key register, `docs/01-architecture/events.md`, and the derived `check:events` CI gate)

**Reviewed head:** `bb078c10caf5643431ce4b5bfe1a16afb1f97904`

**Verdict: CLEAR WITH FINDINGS.** Seven independent Opus review rounds, on `scripts/ci/check-events.mjs`, `scripts/ci/lib/workflow-aliases.mjs`, and their test suites. No exploitable
security defect at this head. One HIGH and one MEDIUM were found across the rounds and are
both genuinely fixed, independently re-verified against a scratch reproduction of the
original exploit, not merely re-read. A small number of LOW findings remain — all disclosed
directly in `check-events.mjs`'s own "Disclosed limits" doc comment, in the same style the
file already used for the pre-existing cross-file-alias gap, rather than chased into further
review rounds. This is deliberate: per this project's "stop patching and change altitude"
guidance, once a mechanism has had its structural fix and further findings are narrower
instances of the same already-identified class, disclosure (with a real regression test
proving the boundary of what IS caught) is the correct closing move, not an open-ended
review loop.

This note consolidates the review history that was previously narrated only in the pull
request body — the mechanical `pull request template + security review` gate requires a
linked, committed note declaring the reviewed head in the exact `**Reviewed head:**` format,
which this pull request had not yet supplied despite the review work itself being genuine
and extensive. This file is that note, retroactively covering all seven rounds.

## Round-by-round history

1. **Round 1** (head `d08daf1`) — **CHANGES REQUIRED.** Four HIGH, several MEDIUM/LOW. HIGH
   1/2: a cross-file alias (`export const emit = publishEvent`) made the scanner silently
   report a file as publishing zero keys. HIGH 3: `resolveLocalConst` resolved an ambiguous
   local binding with false confidence. HIGH 4: several call shapes (optional chaining,
   generic arguments, namespace-qualified calls) were invisible to the extractor with no
   fail-closed fallback. Remediated: alias tracking within one file, a fail-closed residual
   scan for unrecognised shapes, and the first version of ambiguous-binding refusal.

2. **Round 2** (head `97e3ab7`) — **CLEAR WITH FINDINGS.** Confirmed all four round-1 HIGHs
   genuinely closed. Raised three new MEDIUM findings (the pin/residual-scan interaction,
   the DECLARED count) plus one round-1 LOW found still undisclosed. Remediated.

3. **Round 3** (head `e0cc467`) — **CLEAR WITH FINDINGS.** Confirmed all three round-2
   MEDIUMs genuinely closed, each downgraded to a LOW on further narrowing. Confirmed
   `check-events.mjs`'s executable code byte-identical to the round-2-cleared revision.
   Remediated.

4. **Round 4** (head `83850b1`) — **CLEAR WITH FINDINGS, no HIGH.** Confirmed the three
   round-3 LOWs closed. Found the round-3 pin's fix had moved a channel-divergence problem
   rather than closed it (MEDIUM), a false "structurally cannot" claim in the header (LOW),
   and an unnecessary "at least SIX" hedge (LOW, informational). Remediated — this round's
   fix took several wording-iteration commits to land on accurate phrasing for one comment,
   visible in the branch's own commit history, not a hidden extra review round.

5. **Round 5** (head `416c91d`) — **found one blocking HIGH.** `resolveLocalConst` matched
   its declaration search against `code` (comments stripped, string CONTENTS intact) and
   never checked what kind of binding the resolved name actually was at the call site — a
   same-named `let`/`var`, a function parameter, or a decoy `const` hidden inside an
   unrelated string literal's value would all be silently treated as the real declaration.
   Three concrete exploit shapes reproduced, all previously passing at exit 0. Fixed at
   `32189a3`: the declaration search moved to `structural` (comments AND strings blanked),
   and a new `assertNoOtherBinding()` refuses unless every occurrence of the resolved name is
   either the one legitimate declaration or a recognised call argument.

6. **Round 6** (head `9bdd01c`, the round-5 fix rebased onto `main` after PR #75/#162
   merged) — **CLEAR WITH FINDINGS.** Independently reproduced all three round-5 exploit
   shapes against the fix and confirmed each now fails closed. Verified the
   `structural`/`code` byte-alignment invariant the fix depends on, by reading the stripping
   transform directly rather than trusting the claim, across 907 real source files, zero
   misalignment found. Found one new MEDIUM — `assertNoOtherBinding`'s call-argument
   whitelist matched the same textual shape for a real call and for a function DECLARATION
   whose own name collided with a tracked call name (`function publishEvent(eventType: string,
   …)` reads identically to a call `publishEvent(eventType`), so the declaration's own
   parameter was whitelisted as if it were a real call argument — restoring the round-5
   failure for that one naming coincidence. Reproduced: a wrapper function literally named
   `publishEvent` whose own parameter shadowed an outer `const eventType`. Fixed at `912c2ab`
   with the same `\bfunction\s*\*?\s*$` exclusion `publishedKeysIn` already used elsewhere,
   plus three new tests. Also found one LOW: a Unicode-escaped identifier (`let
   eventType = …`) is, at runtime, the same binding as the plain-spelled identifier, but
   is invisible to any literal-text match — a genuine single-file bypass of both the round-5
   and round-6 checks. Disclosed rather than fixed at `558db1d` — the reviewer's own words:
   "the irreducible floor of a regex-over-text approach," not a one-line gap; closing it for
   real needs an AST parse, which this file deliberately does not carry.

7. **Round 7** (head `bb078c1`, a lightweight delta confirmation of round 6's MEDIUM fix and
   LOW disclosure) — **CLEAR WITH FINDINGS — nothing blocking. Closes the gate.**
   Independently reproduced the round-6 MEDIUM's original bypass against a scratch checker
   binary (not the shipped probe) and confirmed it now fails closed at `912c2ab`; confirmed
   the three new tests are genuinely sensitive by mutation-testing the fix itself (removing
   the new exclusion flips exactly the RED test, nothing else); confirmed no over-refusal is
   introduced (the exclusion can only ever remove a whitelist entry, never add one, so it
   cannot cause a false refusal of a real call — verified against four probe shapes: a
   legitimate declaration-site skip, TS overload signatures, a named function expression, and
   a comment containing the word "function" directly above a real call). Found two further
   LOW, non-blocking, documentation-only findings, both explicitly recommended as narrower
   instances of already-identified classes that "should not spawn round 8":
   - A same-named METHOD declaration (object-shorthand or class) is exactly as blind to the
     round-6 fix as the `function`-keyword case was before it, for the identical reason —
     the exclusion only ever covered the `function` keyword shape. No such method exists in
     `apps/api/src` today.
   - The round-6 LOW disclosure's own cited `grep` command was over-escaped and matched
     nothing regardless of the tree's actual content, and its illustrative before/after
     contrast had collapsed to two identical lines because the escape sequence did not
     survive into the committed comment as literal text.
   Both fixed directly at `bb078c1` (self-verified, not a further review round, per the
   round-7 reviewer's own explicit recommendation and this project's round-count guidance):
   the method-declaration gap is disclosed alongside the existing IDENTIFIER entry, and the
   grep command is corrected and independently re-run to confirm it produces exactly the
   claimed result (`apps/api/src/index.ts` only, a regex character class, never an
   identifier).

## What remains disclosed, not fixed, at the final head

Three gaps are documented directly in `check-events.mjs`'s own "Disclosed limits" section,
each with the reasoning for why disclosure rather than a further fix is the right call at
this point, and each verified to have zero live instances in the current tree:

- **Cross-file alias indirection** (round 2, MEDIUM 3) — a publisher reached only through a
  re-exported alias in a separate file is invisible; closing it needs a repo-wide
  import-resolution pass, real undone work, not a one-line fix.
- **Unicode-escaped identifiers** (round 6, LOW) — the irreducible floor of matching by text
  rather than parsing; closing it needs an AST parse.
- **Same-named method declarations** (round 7, LOW) — a narrower instance of the round-6
  MEDIUM's class, with no live instance in the tree.

## Independently confirmed at the final head (`bb078c1`)

- `pnpm check:events` — 24 published event keys across 242 source files, every one
  registered.
- `scripts/ci/**` probe suite — 446 tests, 75 suites, all passing.
- `pnpm lint` / `pnpm typecheck` — clean.
- The rebase chain (`9bdd01c` → `558db1d` → `bb078c1`) touches only
  `scripts/ci/check-events.mjs` and `scripts/ci/probes/check-events.test.mjs` — no other
  file changed since round 6's own confirmed head.

## Status of the gate

This review closes the mandatory independent Opus security review for PR #91
(`scripts/ci/**` is security-review scope per `docs/04-engineering/ci-cd.md`). **Correction
(2026-09-16):** this line previously claimed ordinary independent review was "also complete,"
which was false at the time it was written — no ordinary review had run on any head of this
pull request yet, a genuine self-contradiction the ordinary review itself then caught. A
fresh, independent Sonnet-tier ordinary review has since run and returned CHANGES REQUIRED
on two trivial documentation inaccuracies (this false claim being one of them, and a stale
test count elsewhere in the pull request body being the other) — both fixed in this same
update; see the pull request's own `## Reviewed by` section for the full account. No gate is
waived. The orchestrating session verifies this note, the exact head, and every other
required check before merging through the protected flow.
