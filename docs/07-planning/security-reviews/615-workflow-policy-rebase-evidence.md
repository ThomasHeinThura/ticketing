# 615 — rebase onto main after #602: equivalence evidence

Records only; no review verdict. The reviewed head is unchanged in content.

- **Reviewed head (before rebase):** `5f2d6503c817ef42b7d618ea312b88d4e60811bc`, kept at branch
  `claude/workflow-policy-restructure-20261009-reviewed`. Last content review: `33cbf71e`.
- **Old base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`. **New base:** `origin/main` =
  `b64f806230e2cb2c87913d71c9acd9e53c3fb3b8` (#602 merged).
- **Rebased head before this note:** `2698fd461a2f1168b95f46f5cc63fcaa5174c62b`.
- **Overlap:** the only path changed by both #615 and main is `docs/07-planning/decision-log.md`.
  #615 does not touch `docs/02-design/ux-quality-gates.md` or `docs/04-engineering/ci-cd.md`.
- **Conflict resolution (scripted, every conflicted step):** main's new entries placed in date
  order around #615's entries, text unchanged — the 2026-10-10 G11 entry and the 2026-10-09
  diagnostic-witness entry above #615's 2026-10-09 entries, the 2026-10-06 entry below them.
  No entry from main or from #615 was edited.

Checks run:

1. **Per-path blobs.** All 36 paths #615 changes, other than the decision log, have blobs at
   the rebased head equal to `5f2d6503`. Every other path (2,617 checked in all) equals
   `origin/main`. Mismatches: none.
2. **Decision log.** The rebased file equals main's prepended entries, split by date around
   #615's added text, over the old base's file. The added and removed lines of
   `git diff origin/main HEAD` equal those of `git diff 3096cb04 5f2d6503`: 285 added,
   0 removed, byte-identical.
3. **Whole diff.** `git diff origin/main HEAD` excluding the decision log is byte-identical
   to `git diff 3096cb04 5f2d6503` excluding it.
4. **range-diff** `3096cb04..5f2d6503` vs `origin/main..HEAD`: 37 commits paired, 31
   identical (`=`). 6 differ (`!`) only in decision-log hunk position and context; one of
   those also shows a changed hunk-header line for a file a later commit removes.
5. **check:policy** (from #616) on the rebased tree: 8 policy files coherent, exit 0.
