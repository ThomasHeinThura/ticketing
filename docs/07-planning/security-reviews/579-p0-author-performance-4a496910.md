# P0 structural dialog, list and board batch — author evidence

**Source head:** 4a4969108d6753c4d6439ad423dd24b0f87a558d
**Author model:** GPT-6 Luna; implementation author, not independent reviewer.
**Verdict:** author verification only; current hosted acceptance and bulk review pending.

The accessible create-dialog shell mounts outside the lazy work-list panel while its form
remains lazy. Full list rows and board card lists use stable memoization boundaries.
Assignment preserves cancellation-before-write, immediate optimism and stale-result/rollback
protection. The 500 rows, 1,000 links, 200 cards, budgets and test timeouts remain unchanged.
The 500-row semantics test replaces repeated accessibility-tree rescans with equivalent DOM
assertions; it retains its original 15-second timeout.

## Actual source and checks

The canonical test began with HEAD f4f37ef54c7c8b462a90a05998abadb7033911ad and the
completed staged source. Its staged tree 58092c225e39315a119164cb93d5e30ee92c9052 equals
the later committed tree; no clean future-SHA run is claimed. The pre-run tracked diff
SHA-256 is 39bc67362f4dc16382079e7e674b3b5ab9be89e9e48244e9612e77247ec0e40a.

- Scoped Vitest: 3 files / 30 tests pass (list, dialog, optimistic mutations).
- Web types, both production entries and targeted Biome pass.
- Built browser: create dialog 1/1, list geometry/keyboard 1/1, board smoke 1/1.
- One canonical performance run: 22/22, 4.6 minutes. List182.3ms, LCP2348ms,
  create76.0ms, state85.0ms, assignment79.7ms, comment68.8ms, route70.5ms,
  board275.0ms, drag p95 16.8ms, CLS0. Each of three drag samples preserves
  100 successful CSRF-protected versioned writes and persisted final column.
- Agent build manifest SHA-256:
  af660daadf999b24a77e0d13a7974f180a7d8083cff3b07b71cc861a91faa530.
  Portal: 8696ad4db1a9d4f6e54c38d809b2953cbe76c9eb4b6e47e590982232d8c356d4.

Full raw output/source packet is retained privately. An initial wrong-config invocation
ran zero tests; it is not passing evidence. The subsequent correct configuration ran once.

## Screens opened

Create dialog: open/title, Escape close, Enter reopen. List: all 500 rows and 1,000 links,
WLP-500 keyboard reach, normal/200% zoom, intrinsic geometry21552→21634→21552.
Board: all200 cards and actual fixture writes. These are built fixture browser journeys,
not interactive OrbStack/provider acceptance.

## Limits and completeness

The separate standalone legacy task-details status window has no structural change in this
checkpoint. Its local85ms pass does not prove a correction to that hosted failure; its
sidebar/controls rendering split is being completed before the next published bulk candidate.
Latest published f4 hosted performance remains16/22 and unit/component remains416/417.
No fresh independent review, protected acceptance, development refresh or phase claim is
made from this author packet. No unchanged canonical rerun is needed for bookkeeping.

## Completed standalone path supplement

Source ed8f9f4ff9c79c90f5d8e4d74453e223b615795c narrows sidebar chrome to
id/projectId/number/title and puts current property selection in the controls. The move
popover observes status locally. Full-task cache/version authority remains intact. Its
built/tested staged tree d3765585533c7c0a719fb043d21d8b0197d0286a equals the commit tree.
Focused tests pass 5 files/21 tests, web types, Biome and both builds. Exact standalone
status benchmark passes1/1 (three samples, median79.3ms); version-freshness browser and
200-card board smoke each pass1/1. Agent manifest SHA-256:
3b2d303922fab82eb1624eccdbe77d6478a5e6c7472afd72faaea94daf3ef9d5; portal unchanged.
Raw scoped logs and hashes are retained privately with the parent packet. No full local
canonical rerun follows this source change; hosted canonical acceptance remains pending.
