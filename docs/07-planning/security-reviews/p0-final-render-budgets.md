# P0 final render-budget batch — exact-head reviews

**Reviewed head:** `9bced3e3178a70b3a1984837836824e4a193c89f`

**Review scope:** The rendering and deferred-create-dialog source/test batch from whole-batch base `7c5ae58c67c3572b2f4f52864788f78e726daa0d`, including the intermediate geometry-fix commit at `a0ec2679c95c6de91e7a17196e62566cbcd45a28`. This note records review and available evidence for this exact source head. It does not claim P0 completion or G11 acceptance.

## Review record

### Ordinary review 1 — GPT-6 Luna

- **Reviewed head:** `9bced3e3178a70b3a1984837836824e4a193c89f`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate the candidate.
- **Checked:** Exact head and worktree, full source delta and relevant call sites, and `git diff --check`. No tests, builds, browser, or performance runtime were run by this reviewer.
- **Verdict:** **CLEAR — no blocking source-level finding.** The prior intrinsic-size geometry defect is resolved: intrinsic-size and `content-visibility` behavior was removed, normal variable card dimensions remain, and the create-dialog entry points remain reachable.
- **Limits:** Root-reported lint, typecheck, tests, builds, and browser results were not independently reproduced. This review does not establish G11.

### Ordinary review 2 — GPT-6 Luna

- **Reviewed head:** `9bced3e3178a70b3a1984837836824e4a193c89f`
- **Independence:** Fresh reviewer context; independently inspected the exact-head delta and surrounding paths.
- **Checked:** Exact head and worktree, full source/test delta, modal, trigger, board, and test behavior, and `git diff --check`. No tests, builds, browser, Docker, server, database, or performance runtime were run by this reviewer.
- **Verdict:** **CLEAR — no blocking source finding.** Confirmed the earlier card-geometry issue is structurally removed and board/list create-dialog interactions remain represented in the retained same-origin smoke result.
- **Limits:** The reported browser run is author-produced evidence inspected by the reviewer, not an independent reproduction. It is not a performance measurement and does not clear G11.

### Required security review — GPT-6 Sol

- **Reviewed head:** `9bced3e3178a70b3a1984837836824e4a193c89f`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate the candidate.
- **Scope:** The changed Playwright E2E file is within the repository's security-review path list. This is a bounded UI/rendering and browser-assertion change; the reviewer found no change to authorization, policy, route coverage, CI authority, thresholds, or gate pass/fail semantics.
- **Checked:** Full six-file delta from `7c5ae58c67c3572b2f4f52864788f78e726daa0d`, both ordinary reports, relevant call sites and test fixture, landed history, exact head, and `git diff --check`. No tests, browser, Docker, server, database, or performance runtime were executed by this reviewer.
- **Verdict:** **CLEAR — no blocking source or security finding** for this exact head.
- **Limits:** The reviewer considered root-reported checks as reported, not reproduced. Required CI, deployability, G11, and stage acceptance remain separate.

## Preserved prior finding and disposition

The two ordinary reviews of `a0ec2679c95c6de91e7a17196e62566cbcd45a28` independently blocked the 80px intrinsic fallback: valid variable-height cards could exceed it, changing the long-board scroll range and sortable geometry as offscreen cards rendered. They requested corrected geometry and browser verification without changing the canonical workload or budgets. That history remains a real finding; this later exact-head review batch verifies its disposition and is not a rewrite of the earlier verdict.

At `9bced3e3178a70b3a1984837836824e4a193c89f`, the underestimated placeholder/content-visibility mechanism is removed. The browser smoke retains the 200-card fixture and compares terminal-card height and column offset before and after scrolling it into view. It also exercises keyboard drag cancel/drop and board/list create flows. The two fresh ordinary reviewers and the required Sol reviewer found no blocking finding in the corrected delta.

## Candidate evidence (root-run; reviewer reproduction is stated above)

All following source-bound evidence identifies `9bced3e3178a70b3a1984837836824e4a193c89f`:

- Standard checks: lint **8/8**, typecheck **9/9**, tests **12/12**; web suite **112 files / 455 tests**. Retained result receipts are under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/p0-render-9bced-standard/`.
- Browser: the initial default-origin attempt failed because the built app called `localhost:1337` while the fixture used another origin; its failure record is preserved at `p0-render-9bced-browser/`. The source-unchanged corrected build used `VITE_API_URL=''` for same-origin fixture requests. Its retained Playwright run passed **1 test / 1 file** in **7.33 seconds**, using desktop **1280×900** and mobile **390×844**, with reduced motion. It exercised task detail status/assignee fixture writes, help open/close, the 200-card board, terminal-card geometry through scroll, board/list create dialog open/Escape/focus return, and keyboard drag cancel and persisted drop. This is interaction evidence, not a G11 measurement. Trace and receipts are under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/p0-render-9bced-same-origin/`.
- The browser transport used preview port **4199** and an owned shim; cleanup passed, and the unowned service on **4178** remained untouched.
- Container image built from the exact source with digest `sha256:171d2ca2038dd26a3e41a712fa5e889bfd56b0157609911a7b10986d1af473a2`; image build receipt is under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/p0-render-9bced-image/`.
- A bounded local boot/health check using the root stock Traefik setup passed all four JSON health endpoints (`ticket-live`, `ticket-ready`, `portal-live`, `portal-ready`) with runtime UID **10001**. Cleanup receipt passed. This check used the above image and is recorded at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/p0-local-lifecycle-runs/20261007T132753Z-832e51/render-boot-health.json`. It is not official-installer acceptance, G11, or phase acceptance.

## Remaining acceptance and screen evidence

- **G11 remains pending.** No candidate G11 performance result is claimed. The old base's 20/22 hosted result does not transfer to this head, and the interaction smoke is not a substitute.
- Required hosted CI and protected acceptance remain outside this note's evidence.
- The changed work-route lazy shell's modern work screen was not opened in this retained browser run. The run covers task detail, board, and list paths; do not imply it verified the separate work-route screen.
- No P0 phase-finalizer verdict or P0 completion is claimed. Human H1–H6 review remains deferred to integrated P4 review.

## Reviewer source records

- `/private/tmp/taskdesk-p0-render-luna-one-9bced3e3.md`
- `/private/tmp/taskdesk-p0-render-luna-two-9bced3e3.md`
- `/private/tmp/taskdesk-p0-render-sol-9bced3e3.md`
- Historical geometry-blocking reports: `/private/tmp/taskdesk-p0-render-luna-one-a0ec2679.md` and `/private/tmp/taskdesk-p0-render-luna-two-a0ec2679.md`
