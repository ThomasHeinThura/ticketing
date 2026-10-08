# Migration allocation ledger

Verified 2026-10-08 13:27 UTC. Final numbering is allocated centrally during post-P0 integration freeze. A branch-local provisional number is not a final reservation and must not be applied over accepted history without reconciliation.

| Number | PR / branch | Stage | Source SHA | Status |
| --- | --- | --- | --- | --- |
| 0000–0087 | accepted main | accepted foundation | 3096cb044bdf6ae98488bfc385f532fa6386343a | Accepted journal; preserve applied history |
| 0000–0087 | #602 | P0 | 23a01a62ece3ca7d17105626f64ad78641435ec1 | Frozen candidate journal; exact88 insertion-order hashes verified |
| 0112, branch-local provisional | #608 canonical Users batch | P4 | 76b833be5b46589229a630738c5b436365eba409 | Current exact source. Focused 2-file/17-test verification only; final reviews and integration remain pending. Earlier 32-test and image/migration evidence belongs to prior source and does not transfer. NOT a final integration reservation; preserve accepted history |
| final numbers unallocated | historical #589 | P1–P4 integration | 2350397b18f83ed417bf63d73970daacdbaae49c | Frozen historical train; recreate from accepted post-P0 main before final allocation |
| final numbers unallocated | #598 | P2 | 3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e | Feature history; reconcile centrally with integration train |
| final numbers unallocated | #585 | P4 | 5a371451d2d05777a8815639b18cd2ac8085578b | Feature history; existing snapshot conflicts stay open |

The Users development base already has unaccepted0109–0111 history and vocabulary differing from canonical delete/user. Its historical tags are preserved during isolated development; this does not approve those tags/vocabulary or make that base deploy-compatible with accepted main. Final integration reconciles source and migration snapshots against accepted history. Never rewrite a migration already applied to accepted environments.


## Freeze reconciliation note — 2026-10-08 13:27 UTC

Thomas's final integration directive stops new features and feature branches. Continue only existing integration/correctness/acceptance fixes and the authorized final image/SIT acceptance cycle, then stop for the next roadmap. Accepted `0000–0087` history remains immutable. The shared cumulative trains contain duplicate/provisional `0088–0118` allocations; do not assign final numbers by branch ancestry or rewrite accepted applied history. Reconcile SQL, Drizzle snapshots and journal centrally against accepted `main` before integration. #609 `da4e0f62` has no migration allocation recorded in the captured slice inventory. This note allocates no new migration number and claims no migration acceptance.
