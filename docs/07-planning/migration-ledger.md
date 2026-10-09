# Migration allocation ledger

Live owner update verified 2026-10-09 06:17 UTC. Final numbering is allocated centrally during post-P0 integration freeze. A branch-local provisional number is not a final reservation and must not be applied over accepted history without reconciliation.

| Number | PR / branch | Stage | Source SHA | Status |
| --- | --- | --- | --- | --- |
| 0000–0087 | accepted main | accepted foundation | 3096cb044bdf6ae98488bfc385f532fa6386343a | Accepted journal; preserve applied history |
| 0000–0087 | #602 | P0 | 66c736e71c87b2372ba1cbf8250236ac37191565 | Frozen candidate accepted-prefix journal unchanged by test/review-note descendants; exact image boot passed. No stage acceptance |
| 0112, branch-local provisional | #608 canonical Users batch | P4 | 8f1713934cb91fb7048930ae9b776b29cb67089b | Current canonical DTO delta has two Luna and full Sol CLEAR, focused PostgreSQL 18/18 and OpenAPI 225 operations PASS. Unaccepted/conflicting #589 base, composed CI and integration acceptance remain. NOT a final integration reservation; preserve accepted history |
| 0102_sla_pause_PROVISIONAL.sql, unjournaled branch-local filename | #611 existing SLA completion | P2 | 95927e4635f2cc2e7b66fe2ee94b82297ef7bf7e | Provisional child schema only; explicit disposable test-fixture application, 24 affected cases PASS. No final number reservation, accepted journal entry, migration replay or deployability claim; allocate and reconcile centrally after accepted P0 |
| final numbers unallocated | historical #589 | P1–P4 integration | 2350397b18f83ed417bf63d73970daacdbaae49c | Frozen historical train; recreate from accepted post-P0 main before final allocation |
| final numbers unallocated | #598 | P2 | 3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e | Feature history; reconcile centrally with integration train |
| final numbers unallocated | #585 | P4 | 5a371451d2d05777a8815639b18cd2ac8085578b | Feature history; existing snapshot conflicts stay open |

The Users development base already has unaccepted0109–0111 history and vocabulary differing from canonical delete/user. Its historical tags are preserved during isolated development; this does not approve those tags/vocabulary or make that base deploy-compatible with accepted main. Final integration reconciles source and migration snapshots against accepted history. Never rewrite a migration already applied to accepted environments.


## Freeze reconciliation note — 2026-10-08 13:27 UTC

Thomas's final integration directive stops new features and feature branches. Continue only existing integration/correctness/acceptance fixes and the authorized final image/SIT acceptance cycle, then stop for the next roadmap. Accepted `0000–0087` history remains immutable. The shared cumulative trains contain duplicate/provisional `0088–0118` allocations; do not assign final numbers by branch ancestry or rewrite accepted applied history. Reconcile SQL, Drizzle snapshots and journal centrally against accepted `main` before integration. #609 `da4e0f62` has no migration allocation recorded in the captured slice inventory. This note allocates no new migration number and claims no migration acceptance.
