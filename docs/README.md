# TaskDesk: current direction

**Reset: 22 October 2026.** Document and deliver the whole product using the original Kaneo interface: P0–P7, with later candidates visible in proposed P8/P9 groups. Integrate the code already present. Show working journeys on the laptop before asking Thomas to review.

| Read | Purpose |
| --- | --- |
| [Feature catalogue](features.md) | Whole-product features, subfeatures and Kaneo placement |
| [Full roadmap](roadmap.md) | P0–P7 delivery and proposed P8/P9 extension groups |
| [Original alignment](alignment.md) | Source mapping, preserved decisions and scope questions |
| [Agent coordination](agent-work.md) | Bounded assignments, file/runtime ownership and handoffs |
| [Requirements](requirements.md) | Preserved scope and exact original requirement references |
| [Audit](audit.md) | Source findings, gaps and limits of the evidence |
| [Testing](testing.md) | Laptop setup, tests, browser checks and phase review |
| [Integration contracts](contracts.md) | Distilled semantics for current code integration |
| [Screen coverage](screens.md) | Maintained route coverage; no acceptance inferred |
| [Status](status.md) | What changed, what was verified and what remains blocked |

The workflow is in [AGENTS.md](../AGENTS.md). No separate lifecycle or review ceremony.

## Maintained contracts and archive

Active checker inputs now live in [technical](technical/ci-gates.md): [configuration](technical/configuration.md), [permissions](technical/permissions.md), [features](technical/features.md), [schema](technical/data-model.md), [jobs](technical/background-jobs.md), [events](technical/events.md), [UI boundaries](technical/ui-boundaries.md) and [workspace boundaries](technical/workspace-boundaries.md). Readers and fail-closed tests move together. The [foundation details](technical/foundation-details.md) preserve the non-table constraints alongside those registries. The full retained clauses are in [architecture/experience](technical/architecture-and-experience.md), [safety/runtime](technical/safety-and-runtime.md), [import/cutover](technical/import-and-cutover.md), [operations/distribution](technical/operations-and-distribution.md), [design/decisions](technical/design-and-decisions.md), [retained constraints](technical/retained-constraints.md) and the phase feature references linked from requirements. These contracts describe required behavior; they do not prove implementation or acceptance.

Thomas chose to keep `archive/` ignored on 22 October. The original files remain unchanged on this laptop as historical provenance; a fresh checkout must not need them to run checks or understand retained requirements. All numbered rules and their feature, safety, event and import clauses now link to maintained references in [requirements](requirements.md). All 72 indexed source contracts now have maintained destinations. Linked design, migration, licensing and owner-decision clauses also resolve to maintained references. Combined link and reader checks run without the archive; source names and lines remain provenance, not active instructions. Semantic curation is not an implementation or acceptance claim.

Historical guidance and acceptance claims are inactive. Git-history comparisons may still read prior committed contracts to detect protection shrinkage; that is not a filesystem dependency on the ignored archive. Existing remote branch protection remains in place. PR descriptions now require an outcome and actual checks. Only an explicit phase-completion submission requires the single consolidated, source-bound independent review; Thomas acceptance remains separate. Explicit releases validate that evidence before building.

Legal notices, release history and product help retain operational copies where required. They are not agent instructions.
