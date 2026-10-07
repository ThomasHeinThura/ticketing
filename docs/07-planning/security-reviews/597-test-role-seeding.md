# Test-role seeding — independent review evidence

**Reviewed head:** `55b087696a11c06a5acb42efd4a9ca2aff49b5be`

**Model:** GPT-6 Sol
**Reviewer:** independent `/root/p0_v9_frozen_full_sol`
**Verdict:** CLEAR — full producer/control review at345371be followed by independent exact tooling-relocation confirmation at55b08769.
**Base:** `7d86b0a84b47a35065e389ef5e4216c12832e77f`

The orchestrator transcribes actual independent verdicts here; this is not self-review. No usable login identity, password, token, database URL, private manifest or credential Markdown is included.

## Scope and independence

The reviewer did not author or remediate the candidate. Full security coverage includes explicit disposable-database targeting, canonical instance/workspace/customer role sources, customer materialized membership and portal identity, configured bcrypt authentication, private generated identities/passwords, file/path/link controls, additive/idempotent reuse, atomic publication/recovery and secret-free failure diagnostics. Customer provider defaults are observed, never changed by the producer.

Ordinary full reviews A (`/root/test_role_seeding_luna_a`) and B (`/root/test_role_seed_successor_full_luna_b`) cleared source at `cb081b8a005995d58ce9cbc437bbf5efe359912c`. Independent Luna `/root/p1_canonical_full_luna_c` subsequently reviewed the complete customer, origin/bootstrap, random-identity/harness and diagnostics deltas at their actual heads. It cleared `3bd6a4d77ddf01a21f8249615e6f1329a926dad6` with 12 offline tests, `3230feab37a339971bed1747df1dacb7d0b7c025` with 15, and `92539104a1c8f1d160f368794b172b1984ae464d` with 13. These prior reviews are not relabeled as full reviews of the final head.

The recurring diagnostics class receives a structural boolean-only assertion boundary at `86234f560c272b0563ed11bd4d07cdb674f571e3`; the required full Sol pass closes that class under AGENTS.md's repeated-class rule. It identifies one weakened customer-authority cardinality assertion. The initial correction at `129ba7cd02fbf34b19155dd77b2f1b88fd2cb84c` changes the wrong staff block and stays blocked. Final exact-head diff at345371be restores `customerIdentity.authority.length === 1` in the customer safe condition. Sol verifies the actual diff, clean worktree and live PR head before CLEAR. No extra ordinary comfort round or native rerun is claimed for that test-only correction.

## Actual evidence

- Complete dedicated `pnpm test:seed` at3230feab: **4 files / 35 passed**, against one explicitly named isolated PostgreSQL test database. Covers all eight canonical role fixtures, actual local-password sign-in, positive enabled-customer portal session/identity, preservation/idempotence and origin/target harness behavior.
- Root independently verifies zero remaining clients, full container/image/mount/label identity and no other volume references; removes only the bound container/named volume; proves absence, unchanged global container/volume sets and released port. Raw logs and generated credentials stay private; test credential directories are removed.
- The producer, credential publication and customer repository helper are byte-unchanged from3230feab through55b08769. The explicit-database harness is byte-unchanged through345371be, then moved with import/config paths at55b08769; its target, origin and diagnostic behavior is independently confirmed unchanged. The native result remains attributed to3230feab; no later native run is invented.
- Structural diagnostics focused suite at86234f56: **2 files / 16 passed**; meaningful synthetic-secret assertion-failure regression verifies the shared boundary. API typecheck, Biome and diff checks pass.
- Final customer-only correction: author **13 focused tests**, API typecheck, Biome and diff checks pass. Sol performs direct exact-delta/source inspection and diff check, not a fabricated native test.

## Collected findings and disposition

Customer membership/portal role, deterministic usable login names, raw credential-bearing failure diagnostics and customer authority cardinality are resolved. Earlier failed candidates and review reports remain preserved privately. One ordinary nonblocking note asks for a dedicated email-collision regression; collision rejection itself was inspected and is not a blocker.

## Exact tooling-relocation successor

Candidate55b08769 resolves the actual `check:env` failure by placing test-only Vitest setup under `tests/api` rather than the application tree. Five files change: two setup paths, their imports, dedicated Vitest configuration and test TypeScript configuration. No producer, environment gate, baseline, production authority or registered bootstrap setting changes.

Fresh independent ordinary GPT-6 Luna `/root/p1_fcf_bulk_luna_a` clears this exact delta. It runs `check:env` (1,521 application/package files, 47 attributable reads; 52 inherited deviations unchanged), three files/22 no-database seed tests, test TypeScript and test discovery. Independent GPT-6 Sol `/root/p0_v9_frozen_full_sol` clears the exact current-head narrow security confirmation after inspecting the complete delta and the explicit PostgreSQL `_test` guard, contradictory URL checks, configured origin helper, default Testcontainers path, explicit no-Testcontainers path and diagnostic boundaries. It independently runs environment, test TypeScript, discovery (four files) and diff checks. Neither reviewer authors/fixes this candidate or runs native resources. Root verifies clean source and remote exact55b08769 before recording these actual verdicts.

This current-source confirmation carries the earlier full producer review with explicit inspected delta, not a relabeled full review or native result. Original source345371be full Sol record and every prior blocked finding remain in this record/history.

## Limits

This is security clearance for the exact reviewed source, not a phase finalizer or acceptance claim. Required CI, composed image build/boot/health, integration and protected merge remain open. No persistent DEV users are created, production provider defaults altered, gate waived or phase declared complete. No UI changes occur relative to this leaf's base; existing dialog evidence belongs to its parent.
