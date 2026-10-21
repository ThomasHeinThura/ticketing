# Workflow

How a change gets from an idea to `main`. This is the only process document. It replaces
`agent-workflow.md`, `sdlc.md`, `error-fix-loop.md` and the process sections of
`definition-of-done.md`, which are archived under
[`docs/07-planning/archive/`](../07-planning/archive/README.md).

Why it is short: the previous process cost more tokens and round trips than the work itself,
and produced documents that contradicted each other. Keep this file under 150 lines.

Thomas's 22 October directive: no AIDLC/SDLC paperwork or micro-review cycle. Implement
coherent complete feature batches, test the product and changed screens, then use one
aggregate standard review and one security review. Batch routine documentation/evidence
updates; do not restart expensive CI for intermediate prose. Required checks and truthful
completion evidence still apply.

## The loop

1. **Pick** the next item from [status.md § Current work](../07-planning/status.md#current-work) or a GitHub
   issue. If the behaviour isn't specified, ask Thomas and write the answer into the feature
   spec in [`docs/03-features/`](../03-features/README.md).
2. **Branch** in your own worktree. Keep a PR to one coherent change, ideally under about
   1,500 changed lines (generated files excluded).
3. **Build** with real data and kaneo's components ([AGENTS.md § The rules](../../AGENTS.md#the-rules)).
4. **Check** before opening the PR:
   - `pnpm lint && pnpm typecheck && pnpm test`, plus `pnpm test:integration` (API changed)
     and `pnpm test:permissions` (route changed).
   - For a web change, open every touched screen on `pnpm dev` or SIT and take a
     before/after screenshot next to the kaneo original.
   - If the change ships in the image, `docker build .` and boot it.
5. **Open the PR** from the template. CI runs the full required checks on every PR. Never
   `[skip ci]`, and never post statuses by hand.
6. **One independent review.** A different session, which can be a fresh subagent, reads the
   diff and posts its verdict as a PR comment. Then:
   - **Security review:** when the diff touches the security paths in
     [ci-cd.md](ci-cd.md), the reviewer also checks auth, permissions and tenancy and says so
     in the comment. Use Claude Opus or GPT Sol for this.
   - **Findings:** fix them on the branch. The reviewer re-checks only the delta.
7. **Merge** when CI is green and the review is clean. Use a squash merge through the normal
   protected flow. Thomas, or a session he delegated to, merges.
8. **Update** [status.md](../07-planning/status.md) when something becomes true or false for
   users. Record a decision in the decision log only when Thomas makes one.

That's the whole process. There are no review-note files, operating modes, conductor queue,
model-label paperwork or phase finalizers.

## Pull requests

The template ([`.github/pull_request_template.md`](../../.github/pull_request_template.md)) has six
short sections, and `check:pr-template` enforces them:

- every section is filled in, or says "n/a — reason";
- `Reviewed by` is never n/a;
- `Security` is not n/a when security paths change;
- `Screens` is not n/a when `apps/web/` changes.

## When something fails

- Read the error and fix the cause, not the symptom.
- Two failed attempts on the same mechanism means you stop patching. Trace the whole path,
  from input through the code to output, and then fix it.
- A flaky test is a bug. Fix it or open an issue. Never skip it to go green.

## Done means

| Level | Means |
| --- | --- |
| **Change done** | Merged, CI green, reviewed, and the touched screens opened and working with real data. |
| **Feature done** | Every rule in its spec is implemented and tested, it's reachable from the kaneo navigation, and it has no mock data. Its screens are ✅ in [screen-inventory.md](../02-design/screen-inventory.md). |
| **Stage done (✅)** | Exit criteria in [phases.md](../07-planning/phases.md) hold, an end-to-end journey runs on SIT with real data, and **Thomas has walked through it and signed off** in the decision log. |

A gate Thomas defers is written as **deferred**, with an issue to track it. It is never written
as approved or passed.

## Releases and SIT

- `scripts/deploy.sh local` brings up SIT (`https://ticketing.localhost:8443` for agents,
  `https://portal.localhost:8443` for the portal) with seeded accounts.
- Tag a pre-release (`v2.0.0-alpha.N`) when a meaningful set of user-visible changes has
  landed. Update `CHANGELOG.md` in the same PR.
- Never change remote UAT or production without Thomas's instruction.

## Roles

- **Thomas** sets direction, makes decisions, defers gates and signs off stages.
- **An implementing session** builds one change on its own branch.
- **A reviewing session** is independent of the author and comments on the PR.
