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

## Completed visual and zoom batch — reviewed exact badb055

Independent ordinary GPT-6 Luna and independent GPT-6 Sol cleared `badb055f623040c358cef01c6c1c4bd887a08264` for the six-file delta from `f995abbeb2a01a9f3b5f35f61571f08d7fe64df3`. Neither reviewer authored or remediated it. The prior Luna blocker at `0a7212d` was an unsupported jsdom scroll API in the focused test; the scoped row mock resolves it without changing browser behavior or weakening prefetch assertions. Luna and Sol each actually ran one file/13 component tests successfully. Sol also ran the visual-scope checker:17 screenshot cases,16 active route rows,125 total inventory rows. Earlier a4 authority reviews retain their exact unchanged scope.

The new saved-view detail screenshot uses the structured filter/sort contract and CSRF mock; Linux baseline generation and comparison each passed their one case. The existing 500-row 200% zoom journey passes after focus scrolls the owning table row fully into view. These are built UI/mock-API evidence, not persistent DEV or server authorization acceptance.

Exact product `0a7212defb2126ec442277a4d63020a70705f9fc` image `sha256:a463ea67a4ef7603d179af89af1b20f4de714fe49a6000abea70f4bcbc57362f` built and booted05:03:02–05:03:41UTC: OCI revision matches,UID10001,live/ready200. Owned containers/volumes/network were removed; original DEV network members were preserved. The only0a→badb delta is the component test; image identity remains0a, not relabeled badb.

Hosted badb full37730574097: PostgreSQL154files/1813testsPASS; E2E and G4PASS; G8 is9/17 and G11 is18/22. The newly added detail visual case passes, but eight other visual cases remain failed. G11 fails LCP2796/2500ms, create-work-item visibility, assignment235.1/200ms and board652.7/500ms. Fast37730574034 passes build/unit/static/route-policy/supply-chain; OpenAPI and acceptance metadata remain failed. API compatibility and pending-action enum decisions remain unresolved. No full visual/performance green, protected merge, release, persistent deployment or phase closure is claimed.
