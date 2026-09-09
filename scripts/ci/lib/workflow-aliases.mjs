/**
 * `WORKFLOW_ALIASES` — the map of `pnpm <script>` commands a workflow executes that stand
 * in for a DIFFERENT gate `docs/04-engineering/ci-cd.md` declares (M2, `test-all.mjs`).
 *
 * Left key: the command a workflow runs. Right key: the gate ci-cd.md declares.
 *
 *   check:route-policy  runs test:permissions THROUGH turbo so the package build happens
 *                       first (scripts/ci/route-policy-gate.mjs says why the wrapper
 *                       exists). CI runs the wrapper because it is the stricter entry.
 *   check:pr-template / check:openapi / lint:ci
 *                       ci-cd.md names these by WHAT they check; CI names them by the
 *                       script that checks it. Both are accurate.
 *   install             ci-cd.md declares the gate with its flag; the scanner records
 *                       `pnpm <script>` and drops flags, and this one executes inside
 *                       .github/actions/setup rather than in a workflow file. Found by
 *                       A2's reverse direction on its first run, which is the direction
 *                       working: a gate the scanner had never been able to see.
 *
 * Declared here rather than resolved by editing one side until today's strings match. An
 * alias is not an exemption: the gate it points at must still be declared in ci-cd.md AND
 * enabled in the manifest, and — since A2 — must actually execute. `test-all.mjs` reads
 * this map in both directions: `aliasSources()` there inverts it, and `GATE_OBSERVATIONS`
 * (also there) covers the gates whose executed form is not a `pnpm` command at all.
 *
 * **`check:events` is deliberately NOT an entry here.** An earlier version of this change
 * aliased it to `pnpm check:vocabulary`, reasoning that ci-cd.md already scopes
 * `check:vocabulary` over "a table, capability, event key or job name absent from its
 * authority document". That reasoning is fine for DECLARATION but the alias mechanism also
 * governs ENFORCEMENT, and those are different questions: `aliasSources()` folds an
 * aliased gate's occurrences into its target's candidate set, so Direction 2 is satisfied
 * the moment *either* command executes. Concretely, that made the `check:events` step
 * deletable, `continue-on-error`-able, or `if: false`-able with `pnpm test:all` staying
 * exit 0 — Direction 2 never asks about `check:events` on its own, because it is not a
 * declared gate — and it let `check:vocabulary`'s OWN step be removed or neutered the same
 * way, since `check:events` covered for it. A gate that can vanish with the reconciler
 * green is worse than one that costs a documentation row, so `check:events` has its own
 * row in ci-cd.md and its own manifest entry in test-all.mjs instead.
 *
 * **This map lives in its own file** (review PR #91, MEDIUM 1) and the probe at
 * `scripts/ci/probes/workflow-alias-table.test.mjs` pins its five entries, its `.get()`
 * channel, and this file's comment-stripped body.
 *
 * **What that does and does not close is deliberately NOT described here.** Four successive
 * versions of this comment tried, and independent review falsified every one — including the
 * version that was itself a correction of the previous falsification, and whose own commit was
 * the counter-example to the sentence it added. The property being described is defeasible in
 * more ways than a comment reliably tracks, and a stale guarantee in a guard is worse than no
 * guarantee, because it is read as one.
 *
 * **See issue #102**, which carries the current analysis — the known bypasses, the reason a
 * defence placed on this object is not sufficient on its own, and the proposed consumer-process
 * assertion — and which is maintained. Do not restore a summary of it here.
 */
const sealed = new Map([
  ["pnpm check:route-policy", "pnpm test:permissions"],
  ["pnpm check:pr-template", "pr-template check"],
  ["pnpm check:openapi", "pnpm test:contract"],
  ["pnpm lint:ci", "pnpm lint"],
  ["pnpm install", "pnpm install --frozen-lockfile"],
]);
for (const method of ["set", "delete", "clear"]) {
  Object.defineProperty(sealed, method, {
    value: () => {
      throw new Error(
        `WORKFLOW_ALIASES.${method}() — this Map is pinned; edit the literal in scripts/ci/lib/workflow-aliases.mjs instead.`,
      );
    },
  });
}
Object.preventExtensions(sealed);
export const WORKFLOW_ALIASES = sealed;
