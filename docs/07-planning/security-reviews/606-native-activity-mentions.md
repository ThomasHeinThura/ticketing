# PR606 native activity, bounded history and scoped mentions review record

**Reviewed head:** `a4c5971b2d6c470867de0a619e8db4fb6b2dcb6e`

## Independent review chain

- Ordinary substantive batch at843e996: three independent GPT-6 Luna contexts reviewed authority, UI and integration. Authority/integration passed; UI blocked duplicate posts and draft loss while mention preflight awaited.
- Completed69482ef correction: independent GPT-6 Luna UI delta passed with1file/5componenttests; independent authority delta passed with3files/52APIunits. The full independent GPT-6 Sol review at69482ef blocked customer candidate exclusion on private items; no demonstrated disclosure was reported.
- Completeda4c5971 correction: independent GPT-6 Luna authority delta passed,3files/52APIunits; independent GPT-6 Sol security delta passed. The requester/participant allowlist now admits reachable private customers without admitting other customers, changing serving-organisation masking or weakening save-time/delivery checks. This closes the sole blocking694 finding. Reviewers did not materially author or remediate the candidates; they wrote review findings only.

## Security model and scope

Creation/preflight only: permissioned workspace/project-scoped candidate enumeration and warnings; actual author and recipient reach rechecked on save; serving organisation comes from canonical project facts. Staff/customer visibility rules remain distinct; internal comments exclude customers. Mentions use registered work_item.mentioned payloads, deduplicate recipients, preserve explicit watcher mutes and apply current delivery eligibility. Existing session-only admin withdrawal, scoped requester withdrawal, activity/history cursor and query-ownership evidence retain their earlier exact-source scope. Edit-triggered mention events remain a previously raised decision and are not introduced.

The full694 Sol review covered the new mentions batch from independently reviewedb6 source. The currenta4 Sol review covers only the two-file694→a4 security delta; it does not relabel a new full repository audit. Reviewer at a4 ran git diff --check; no reviewer PostgreSQL/browser result is claimed.

## Actual verification

Root a4 PostgreSQL18 integration:1file/24tests PASS,04:14:19–04:14:33UTC. The broad added regression exercises requester/participant picker positives, same-org nonparticipant and foreign-org negatives, preflight, public/internal saves, recipient records and explicit mute preservation. Root694 native suite23tests and separate legacy comments5tests are historical source-bound passes. Root694 built-UI/mock-API journey1PASS in4seconds; apps/web and packages/ui have no694→a4 source delta, so it retains its precise UI scope and original source identity. It does not claim live API/browser/DEV/provider acceptance.

Author API typecheck, native mention units3/3, query gate and formatting pass. Root694 container build passes with OCI694; currenta4 image build/boot status is separate and must not be inferred from it. Hosted checks are read from GitHub and remain mandatory on the merge candidate.

## Residuals and limits

Security delta is clear; overall PR acceptance is incomplete. Hosted OpenAPI breaks, inherited visual inventory and performance failures, current image boot, broader integration and persistent Chrome certificate handoff remain tracked. No stage completion, protected merge, gate waiver or deployment is authorized by this review record alone. Nonblocking UI observation: submit-time preflight is advisory, and the refreshed warning may not be visible before the write; server reach checks remain authoritative.

Private full reports retain exact SHA/model/independence/check counts and prior failures. No credential, session cookie or seeder source is stored in this note or repository.
