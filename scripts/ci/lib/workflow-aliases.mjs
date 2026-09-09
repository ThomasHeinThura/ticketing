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
 * **This map lives in its own file (review PR #91, MEDIUM 1) so its probe can pin the
 * ACTUAL RUNTIME VALUE, not a guess reconstructed from source text.**
 * `scripts/ci/probes/workflow-alias-table.test.mjs` used to regex this map's entries out
 * of `test-all.mjs`'s source text — never `import()`ing that file, because it self-executes
 * `await main()` at its top level. A regex over source text is fooled by anything Node
 * still executes correctly but the regex cannot parse: a `WORKFLOW_ALIASES.set(...)` call
 * after this literal, a comment interposed between one entry's two strings, or
 * `new Map([...someOtherArray, ...])`. Each of those installed a live sixth alias while the
 * old text-regex pin, `pnpm test:all --list` and `pnpm lint:ci` all stayed green — so the
 * pin's claim ("cannot be added, retargeted or removed unnoticed") was false for exactly
 * those three shapes. This file has no top-level side effect of its own — it only defines
 * and exports the Map — so the probe imports it directly and asserts against
 * `[...WORKFLOW_ALIASES.entries()]` itself. Whatever code ran to build the Map, the probe
 * sees the Map's actual entries: all three shapes above (and any other way of mutating it)
 * are closed at once, because none of them can produce a live sixth alias without it
 * showing up in this export.
 */
export const WORKFLOW_ALIASES = new Map([
  ["pnpm check:route-policy", "pnpm test:permissions"],
  ["pnpm check:pr-template", "pr-template check"],
  ["pnpm check:openapi", "pnpm test:contract"],
  ["pnpm lint:ci", "pnpm lint"],
  ["pnpm install", "pnpm install --frozen-lockfile"],
]);
