# PR #650 accepted-main composition handoff

## Result

DONE for bounded composition and focused tests; exact-head independent review, complete required checks, native PostgreSQL integration, browser/image/runtime evidence remain with the orchestrator. No product source was edited to resolve conflicts; the ordinary merge had no conflicts.

## Source

- Branch: `codex/605-native-client-selected`
- Source handoff owner commit: `27b344f33cd1356c38b7254525e9c30b57ddbb96` (preserved selected-client commit)
- Accepted main base: `13aacb2e87c99a280b50e5297cd296aa512dd0aa` (#655 protected merge, including accepted #659 boot deadline and parent-first MFA fixture)
- Composed head: `649beec202b0bd2811e34f97be9fe5d69f1c84f2`
- Merge parents: `2d87ac63a42e09e8899bcf262e5cb9aedeee0fec` (branch) and `13aacb2e87c99a280b50e5297cd296aa512dd0aa` (accepted main)
- PR: https://github.com/ThomasHeinThura/ticketing/pull/650
- Worktree began clean at `2d87ac63a42e09e8899bcf262e5cb9aedeee0fec`; existing history retained and accepted main merged normally. No reset, rebase, force push, resource use or queue edit.

## Four-path conservation

- `apps/web/src/hooks/use-native-work-item-realtime.ts` — source `ee477f942bfc572715805442fde3e772f78d4f76`; candidate `ee477f942bfc572715805442fde3e772f78d4f76`; accepted-main parent `c160a7fc0a0821b3bb1a84b79e04c7300a8cf46b`
- `apps/web/src/hooks/use-native-work-item-realtime.test.tsx` — source `69214d64522f74abdec2dd54343fb9f5863511e8`; candidate `69214d64522f74abdec2dd54343fb9f5863511e8`; accepted-main parent `ea825a8470251ceb508c4fb4617af9e603588d0c`
- `docs/01-architecture/realtime.md` — source `15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef`; candidate `15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef`; accepted-main parent `f7bc8c4c98a93531bf77aa3df4c48c40ca3ad739`
- `tests/api-integration/node-server-websocket.test.ts` — source `0c1f512076da88e3771f3d8a58729281ddb08639`; candidate `0c1f512076da88e3771f3d8a58729281ddb08639`; accepted-main parent `23a76df9ac04045a1049886805e6ac56ce822517`

All four candidate blobs match preserved source commit `27b344f33cd1356c38b7254525e9c30b57ddbb96`. They differ from the accepted-main parent versions where applicable, and the merge retained the selected source tree. Merge-base-to-head diff for these four paths is only the original conserved source change; no intervening merge changed their blobs. Incoming accepted-main changes landed in API utility/fixture tests, review/evidence docs, status and queue only.

## Intervening history accounting

Commands below use merge-aware Git semantics (`-m`), charge each merge per parent, disable rename inference and retain mode/object IDs. Range begins at the previous shared merge base `9e79f7e8d51627ea51b18f7525b6f32baaa7f559`. The exact captured output is included below for audit. Final current merge-parent tree delta: 13 paths, 1,318 insertions / 56 deletions; no four owned paths. `pnpm-lock.yaml` and package manifests are unchanged across the accepted-main merge. Existing `node_modules` was available; no dependency installation or lockfile mutation occurred.

### First-parent commit/parent inventory

```text
649beec202b0bd2811e34f97be9fe5d69f1c84f2 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec 13aacb2e87c99a280b50e5297cd296aa512dd0aa
2d87ac63a42e09e8899bcf262e5cb9aedeee0fec 998fdc5579a762654b75a9133c4e2714d563973f 9e79f7e8d51627ea51b18f7525b6f32baaa7f559
998fdc5579a762654b75a9133c4e2714d563973f 0ed428834d1c84f111d36a6eb506d5334bdda99f 521b886fc06b50fee63f203d90e761bf1330c602
0ed428834d1c84f111d36a6eb506d5334bdda99f 27b344f33cd1356c38b7254525e9c30b57ddbb96 05b2a77fa9bf8560f445fcbb7047a9ace5983970
27b344f33cd1356c38b7254525e9c30b57ddbb96 8973cbb179f490f3ee1d58cd2edea71bda4a4f94
```

### Per-parent raw change records

```text
commit 649beec202b0bd2811e34f97be9fe5d69f1c84f2 (from 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec)
Merge: 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec 13aacb2e87c99a280b50e5297cd296aa512dd0aa
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Mon Oct 12 00:08:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:100644 100644 100db9461be2c740acf6d0050e9aabbb7334f97e b270ed783d48a147696b29e2a10b231efd02b194 M	docs/07-planning/decision-log.md
:100644 100644 457b388b6ff042abc9f076f3246f8e69d0727e8c bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:000000 100644 0000000000000000000000000000000000000000 ea067be5e89717a3a7c2f19596e2e7adf068604d A	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md
:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:000000 100644 0000000000000000000000000000000000000000 ed998a4ca806dd0db771a3ca88f6bb39f67fd355 A	docs/07-planning/security-reviews/657-role-query-ownership.md
:000000 100644 0000000000000000000000000000000000000000 2b8aa64ffae1cdc561bbd243c9b078b45c6d719e A	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
:000000 100644 0000000000000000000000000000000000000000 3edbcd1534547226ea7de29c085764da1d928c4b A	docs/07-planning/security-reviews/659-current-role-query-composition.md
:100644 100644 dd97587265a4f03e8bbbeb39b846902e3390c15d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts
:100644 100644 f85806ed0b176179ca816a2b59fa42841941eb42 ee9094fd34f2d66dbec911b0eceecf3dfbfc7149 M	tests/api/permissions/enforcement-config.test.ts
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts

commit 649beec202b0bd2811e34f97be9fe5d69f1c84f2 (from 13aacb2e87c99a280b50e5297cd296aa512dd0aa)
Merge: 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec 13aacb2e87c99a280b50e5297cd296aa512dd0aa
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Mon Oct 12 00:08:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 ea825a8470251ceb508c4fb4617af9e603588d0c 69214d64522f74abdec2dd54343fb9f5863511e8 M	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
:100644 100644 c160a7fc0a0821b3bb1a84b79e04c7300a8cf46b ee477f942bfc572715805442fde3e772f78d4f76 M	apps/web/src/hooks/use-native-work-item-realtime.ts
:100644 100644 f7bc8c4c98a93531bf77aa3df4c48c40ca3ad739 15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef M	docs/01-architecture/realtime.md
:100644 100644 23a76df9ac04045a1049886805e6ac56ce822517 0c1f512076da88e3771f3d8a58729281ddb08639 M	tests/api-integration/node-server-websocket.test.ts

commit 13aacb2e87c99a280b50e5297cd296aa512dd0aa (from 5abe19bccf0d9c1d61482cb372ea81c40485d4e2)
Merge: 5abe19bccf0d9c1d61482cb372ea81c40485d4e2 b8a276966a895272928fec400113acbc3ba4872e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Mon Oct 12 00:06:47 2026 +0630

    Merge pull request #655 from ThomasHeinThura/codex/mfa-cross-process-barrier
    
    test: order cross-process MFA lock acquisition deterministically

:000000 100644 0000000000000000000000000000000000000000 ea067be5e89717a3a7c2f19596e2e7adf068604d A	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md
:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts

commit b8a276966a895272928fec400113acbc3ba4872e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:44:48 2026 +0630

    docs(review): preserve PR 655 current composition review

:000000 100644 0000000000000000000000000000000000000000 ea067be5e89717a3a7c2f19596e2e7adf068604d A	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md

commit f4bf750712cad6a65f4b86d5a238e8c0da825603 (from 46b846c284d2a80ec621e3242d906bcfd673faf5)
Merge: 46b846c284d2a80ec621e3242d906bcfd673faf5 5abe19bccf0d9c1d61482cb372ea81c40485d4e2
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:30:23 2026 +0630

    chore(integration): compose accepted boot fixture into MFA barrier

:100644 100644 d3c0ba360c1846e633226a530502589808da5081 b270ed783d48a147696b29e2a10b231efd02b194 M	docs/07-planning/decision-log.md
:000000 100644 0000000000000000000000000000000000000000 2b8aa64ffae1cdc561bbd243c9b078b45c6d719e A	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
:000000 100644 0000000000000000000000000000000000000000 3edbcd1534547226ea7de29c085764da1d928c4b A	docs/07-planning/security-reviews/659-current-role-query-composition.md
:100644 100644 f85806ed0b176179ca816a2b59fa42841941eb42 ee9094fd34f2d66dbec911b0eceecf3dfbfc7149 M	tests/api/permissions/enforcement-config.test.ts

commit f4bf750712cad6a65f4b86d5a238e8c0da825603 (from 5abe19bccf0d9c1d61482cb372ea81c40485d4e2)
Merge: 46b846c284d2a80ec621e3242d906bcfd673faf5 5abe19bccf0d9c1d61482cb372ea81c40485d4e2
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:30:23 2026 +0630

    chore(integration): compose accepted boot fixture into MFA barrier

:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts

commit 5abe19bccf0d9c1d61482cb372ea81c40485d4e2 (from be320b612ce26c492a8767b667813972266a7eb5)
Merge: be320b612ce26c492a8767b667813972266a7eb5 eb7d7821ba542bb488af6d1cfeeee4281a5a1b5c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:29:01 2026 +0630

    Merge pull request #659 from ThomasHeinThura/codex/boot-refusal-approved-deadline
    
    test(permissions): apply approved production-import refusal deadlines

:100644 100644 d3c0ba360c1846e633226a530502589808da5081 b270ed783d48a147696b29e2a10b231efd02b194 M	docs/07-planning/decision-log.md
:000000 100644 0000000000000000000000000000000000000000 2b8aa64ffae1cdc561bbd243c9b078b45c6d719e A	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
:000000 100644 0000000000000000000000000000000000000000 3edbcd1534547226ea7de29c085764da1d928c4b A	docs/07-planning/security-reviews/659-current-role-query-composition.md
:100644 100644 f85806ed0b176179ca816a2b59fa42841941eb42 ee9094fd34f2d66dbec911b0eceecf3dfbfc7149 M	tests/api/permissions/enforcement-config.test.ts

commit eb7d7821ba542bb488af6d1cfeeee4281a5a1b5c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:14:27 2026 +0630

    docs(review): record current boot composition reviews

:000000 100644 0000000000000000000000000000000000000000 3edbcd1534547226ea7de29c085764da1d928c4b A	docs/07-planning/security-reviews/659-current-role-query-composition.md

commit 46b846c284d2a80ec621e3242d906bcfd673faf5 (from 7e709db3f13cbc1554a5c95619441b32af36c185)
Merge: 7e709db3f13cbc1554a5c95619441b32af36c185 be320b612ce26c492a8767b667813972266a7eb5
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:08:42 2026 +0630

    chore(integration): compose accepted main into MFA barrier

:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:000000 100644 0000000000000000000000000000000000000000 ed998a4ca806dd0db771a3ca88f6bb39f67fd355 A	docs/07-planning/security-reviews/657-role-query-ownership.md
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts

commit 46b846c284d2a80ec621e3242d906bcfd673faf5 (from be320b612ce26c492a8767b667813972266a7eb5)
Merge: 7e709db3f13cbc1554a5c95619441b32af36c185 be320b612ce26c492a8767b667813972266a7eb5
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:08:42 2026 +0630

    chore(integration): compose accepted main into MFA barrier

:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts

commit 9a15893426b9de5788e4ece65979a5354d928344 (from 18232b937e3cf8fba14d6fc19d65908d163d3933)
Merge: 18232b937e3cf8fba14d6fc19d65908d163d3933 be320b612ce26c492a8767b667813972266a7eb5
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:06:47 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/boot-refusal-approved-deadline

:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:000000 100644 0000000000000000000000000000000000000000 ed998a4ca806dd0db771a3ca88f6bb39f67fd355 A	docs/07-planning/security-reviews/657-role-query-ownership.md
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts

commit 9a15893426b9de5788e4ece65979a5354d928344 (from be320b612ce26c492a8767b667813972266a7eb5)
Merge: 18232b937e3cf8fba14d6fc19d65908d163d3933 be320b612ce26c492a8767b667813972266a7eb5
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:06:47 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/boot-refusal-approved-deadline

:100644 100644 d3c0ba360c1846e633226a530502589808da5081 b270ed783d48a147696b29e2a10b231efd02b194 M	docs/07-planning/decision-log.md
:000000 100644 0000000000000000000000000000000000000000 2b8aa64ffae1cdc561bbd243c9b078b45c6d719e A	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
:100644 100644 f85806ed0b176179ca816a2b59fa42841941eb42 ee9094fd34f2d66dbec911b0eceecf3dfbfc7149 M	tests/api/permissions/enforcement-config.test.ts

commit be320b612ce26c492a8767b667813972266a7eb5 (from 0aa0be2eae80e781754bc7fe0468d8cda1113c99)
Merge: 0aa0be2eae80e781754bc7fe0468d8cda1113c99 0b8e28c557d2bc6a1a9fbba8b57e0e3e9e0692a6
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:04:58 2026 +0630

    Merge pull request #657 from ThomasHeinThura/codex/603-current-role-query-ownership
    
    refactor(api): conserve startup role query ownership

:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:000000 100644 0000000000000000000000000000000000000000 ed998a4ca806dd0db771a3ca88f6bb39f67fd355 A	docs/07-planning/security-reviews/657-role-query-ownership.md
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts

commit 18232b937e3cf8fba14d6fc19d65908d163d3933
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 22:40:17 2026 +0630

    docs(review): preserve approved boot deadline independent reports

:000000 100644 0000000000000000000000000000000000000000 2b8aa64ffae1cdc561bbd243c9b078b45c6d719e A	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md

commit 18068c194ef163802cae855790dd31ec88f006ec
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 22:27:05 2026 +0630

    test(permissions): apply owner-approved boot refusal deadlines

:100644 100644 d3c0ba360c1846e633226a530502589808da5081 b270ed783d48a147696b29e2a10b231efd02b194 M	docs/07-planning/decision-log.md
:100644 100644 f85806ed0b176179ca816a2b59fa42841941eb42 ee9094fd34f2d66dbec911b0eceecf3dfbfc7149 M	tests/api/permissions/enforcement-config.test.ts

commit 0b8e28c557d2bc6a1a9fbba8b57e0e3e9e0692a6
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 22:18:16 2026 +0630

    docs(review): preserve selected role-query independent reports

:000000 100644 0000000000000000000000000000000000000000 ed998a4ca806dd0db771a3ca88f6bb39f67fd355 A	docs/07-planning/security-reviews/657-role-query-ownership.md

commit f39438e291b5942fb1fe801f8dee614ce19fa399 (from 36bcc16ffb53eb16730499a2b70bb07792e8ad0b)
Merge: 36bcc16ffb53eb16730499a2b70bb07792e8ad0b 0aa0be2eae80e781754bc7fe0468d8cda1113c99
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:54 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/603-current-role-query-ownership

:100644 100644 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a d3c0ba360c1846e633226a530502589808da5081 M	docs/07-planning/decision-log.md
:100644 100644 2d04f99a223eb7dfe32d8db33b58e274ecf13964 bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:100644 100644 226d91d1bb4303c6cfb3fdb6d767e9170440de7d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md

commit f39438e291b5942fb1fe801f8dee614ce19fa399 (from 0aa0be2eae80e781754bc7fe0468d8cda1113c99)
Merge: 36bcc16ffb53eb16730499a2b70bb07792e8ad0b 0aa0be2eae80e781754bc7fe0468d8cda1113c99
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:54 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/603-current-role-query-ownership

:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts

commit 7e709db3f13cbc1554a5c95619441b32af36c185 (from 5036913ad20c8c8ed8ba1b66f7788017290859a0)
Merge: 5036913ad20c8c8ed8ba1b66f7788017290859a0 0aa0be2eae80e781754bc7fe0468d8cda1113c99
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:04 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

:100644 100644 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a d3c0ba360c1846e633226a530502589808da5081 M	docs/07-planning/decision-log.md
:100644 100644 2d04f99a223eb7dfe32d8db33b58e274ecf13964 bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:100644 100644 226d91d1bb4303c6cfb3fdb6d767e9170440de7d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md

commit 7e709db3f13cbc1554a5c95619441b32af36c185 (from 0aa0be2eae80e781754bc7fe0468d8cda1113c99)
Merge: 5036913ad20c8c8ed8ba1b66f7788017290859a0 0aa0be2eae80e781754bc7fe0468d8cda1113c99
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:04 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts

commit 0aa0be2eae80e781754bc7fe0468d8cda1113c99 (from 411c802cc87647bcfe85bd526b7b19c88da496bc)
Merge: 411c802cc87647bcfe85bd526b7b19c88da496bc 75c71d38e8f58111627c8d8bd07c0787778619d6
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:57:35 2026 +0630

    Merge pull request #656 from ThomasHeinThura/codex/workflow-historical-edge-owner-20261011
    
    docs: record historical workflow held-edge boundary

:100644 100644 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a d3c0ba360c1846e633226a530502589808da5081 M	docs/07-planning/decision-log.md

commit 75c71d38e8f58111627c8d8bd07c0787778619d6 (from ac11e494d6234d89cff9ae01044e5a3b365deec7)
Merge: ac11e494d6234d89cff9ae01044e5a3b365deec7 411c802cc87647bcfe85bd526b7b19c88da496bc
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:47:53 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/workflow-historical-edge-owner-20261011

:100644 100644 2d04f99a223eb7dfe32d8db33b58e274ecf13964 bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:100644 100644 226d91d1bb4303c6cfb3fdb6d767e9170440de7d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md

commit 75c71d38e8f58111627c8d8bd07c0787778619d6 (from 411c802cc87647bcfe85bd526b7b19c88da496bc)
Merge: ac11e494d6234d89cff9ae01044e5a3b365deec7 411c802cc87647bcfe85bd526b7b19c88da496bc
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:47:53 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/workflow-historical-edge-owner-20261011

:100644 100644 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a d3c0ba360c1846e633226a530502589808da5081 M	docs/07-planning/decision-log.md

commit 36bcc16ffb53eb16730499a2b70bb07792e8ad0b
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:47:00 2026 +0630

    refactor(api): own startup role seed reads

:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts

commit 411c802cc87647bcfe85bd526b7b19c88da496bc (from 0978d77e73c66c0ab56b45806ad51f8e2aef6271)
Merge: 0978d77e73c66c0ab56b45806ad51f8e2aef6271 bf0b16a1421ea9c8c8ccf66d58b6b08cfd336de4
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:46:06 2026 +0630

    Merge pull request #654 from ThomasHeinThura/codex/delivery-checkpoint-20261011-6
    
    docs: checkpoint S7 verification and canonical fixture blockers

:100644 100644 2d04f99a223eb7dfe32d8db33b58e274ecf13964 bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:100644 100644 226d91d1bb4303c6cfb3fdb6d767e9170440de7d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md

commit ac11e494d6234d89cff9ae01044e5a3b365deec7
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:42:50 2026 +0630

    docs: record historical workflow held-edge boundary

:100644 100644 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a d3c0ba360c1846e633226a530502589808da5081 M	docs/07-planning/decision-log.md

commit 5036913ad20c8c8ed8ba1b66f7788017290859a0 (from cca6ed58e27bef8c70369cbd092f2f12a2ca1e61)
Merge: cca6ed58e27bef8c70369cbd092f2f12a2ca1e61 0978d77e73c66c0ab56b45806ad51f8e2aef6271
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:21 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

:100644 100644 cdb508255a5c62b8350d568c1fa1ce27fccc3a04 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a M	docs/07-planning/decision-log.md

commit 5036913ad20c8c8ed8ba1b66f7788017290859a0 (from 0978d77e73c66c0ab56b45806ad51f8e2aef6271)
Merge: cca6ed58e27bef8c70369cbd092f2f12a2ca1e61 0978d77e73c66c0ab56b45806ad51f8e2aef6271
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:21 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts

commit bf0b16a1421ea9c8c8ccf66d58b6b08cfd336de4 (from 02fc46ec2452ef76a5abea059f09bb9fc4b125e3)
Merge: 02fc46ec2452ef76a5abea059f09bb9fc4b125e3 0978d77e73c66c0ab56b45806ad51f8e2aef6271
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:12 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/delivery-checkpoint-20261011-6

:100644 100644 cdb508255a5c62b8350d568c1fa1ce27fccc3a04 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a M	docs/07-planning/decision-log.md

commit bf0b16a1421ea9c8c8ccf66d58b6b08cfd336de4 (from 0978d77e73c66c0ab56b45806ad51f8e2aef6271)
Merge: 02fc46ec2452ef76a5abea059f09bb9fc4b125e3 0978d77e73c66c0ab56b45806ad51f8e2aef6271
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:12 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/delivery-checkpoint-20261011-6

:100644 100644 2d04f99a223eb7dfe32d8db33b58e274ecf13964 bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:100644 100644 226d91d1bb4303c6cfb3fdb6d767e9170440de7d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md

commit 0978d77e73c66c0ab56b45806ad51f8e2aef6271 (from 12c09aaca85250c03223df1ed191275c0d3cdd74)
Merge: 12c09aaca85250c03223df1ed191275c0d3cdd74 fb62c7cab475bbe6300812ee3b68f705f8889d7c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:32:48 2026 +0630

    Merge pull request #653 from ThomasHeinThura/codex/s7-set-field-owner-decision-20261011
    
    docs: record owner hold and refusal of workflow set_field

:100644 100644 cdb508255a5c62b8350d568c1fa1ce27fccc3a04 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a M	docs/07-planning/decision-log.md

commit cca6ed58e27bef8c70369cbd092f2f12a2ca1e61
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:14:52 2026 +0630

    docs: preserve independent MFA fixture reviews

:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md

commit 7513e4bbfc086a3f4240250b7383f9329cfc0a83
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:06:24 2026 +0630

    test(api): order MFA fixture lock contention

:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts

commit fb62c7cab475bbe6300812ee3b68f705f8889d7c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:06:08 2026 +0630

    docs: record owner hold on workflow set_field

:100644 100644 cdb508255a5c62b8350d568c1fa1ce27fccc3a04 80aedbfd4e886c7b0c1e3bfbc80409724d6a619a M	docs/07-planning/decision-log.md

commit 02fc46ec2452ef76a5abea059f09bb9fc4b125e3
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:03:59 2026 +0630

    docs: record current S7 verification and fixture blockers

:100644 100644 2d04f99a223eb7dfe32d8db33b58e274ecf13964 bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:100644 100644 226d91d1bb4303c6cfb3fdb6d767e9170440de7d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md

commit 12c09aaca85250c03223df1ed191275c0d3cdd74
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 20:11:42 2026 +0630

    docs: checkpoint source-bound delivery evidence (#645)
    
    * docs: checkpoint current review and runtime evidence
    
    * docs: checkpoint accepted intake owner record
    
    * docs: clarify partial hosted field evidence
    
    * docs: record accepted Users and selected integration progress
    
    * docs: record accepted Field and current D9 unit blocker
    
    * docs: record accepted notification fixture and current journeys
    
    * docs: checkpoint accepted D9 and remaining semantic blockers
    
    * docs: correct newest checkpoint UTC timestamp

:100644 100644 457b388b6ff042abc9f076f3246f8e69d0727e8c 2d04f99a223eb7dfe32d8db33b58e274ecf13964 M	docs/07-planning/integration-execution-queue.md
:100644 100644 dd97587265a4f03e8bbbeb39b846902e3390c15d 226d91d1bb4303c6cfb3fdb6d767e9170440de7d M	docs/07-planning/status.md

commit 2ecff903eb9e6a74f2d6a5eb03a54849b36afa45
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:48:17 2026 +0630

    docs: record saved-view holds and terminal key expiry (#651)

:100644 100644 100db9461be2c740acf6d0050e9aabbb7334f97e cdb508255a5c62b8350d568c1fa1ce27fccc3a04 M	docs/07-planning/decision-log.md

commit 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec (from 998fdc5579a762654b75a9133c4e2714d563973f)
Merge: 998fdc5579a762654b75a9133c4e2714d563973f 9e79f7e8d51627ea51b18f7525b6f32baaa7f559
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:34:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 091eb6da9535f7517955198b75007733f72d6bea 100db9461be2c740acf6d0050e9aabbb7334f97e M	docs/07-planning/decision-log.md

commit 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec (from 9e79f7e8d51627ea51b18f7525b6f32baaa7f559)
Merge: 998fdc5579a762654b75a9133c4e2714d563973f 9e79f7e8d51627ea51b18f7525b6f32baaa7f559
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:34:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 ea825a8470251ceb508c4fb4617af9e603588d0c 69214d64522f74abdec2dd54343fb9f5863511e8 M	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
:100644 100644 c160a7fc0a0821b3bb1a84b79e04c7300a8cf46b ee477f942bfc572715805442fde3e772f78d4f76 M	apps/web/src/hooks/use-native-work-item-realtime.ts
:100644 100644 f7bc8c4c98a93531bf77aa3df4c48c40ca3ad739 15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef M	docs/01-architecture/realtime.md
:100644 100644 23a76df9ac04045a1049886805e6ac56ce822517 0c1f512076da88e3771f3d8a58729281ddb08639 M	tests/api-integration/node-server-websocket.test.ts

commit 998fdc5579a762654b75a9133c4e2714d563973f (from 0ed428834d1c84f111d36a6eb506d5334bdda99f)
Merge: 0ed428834d1c84f111d36a6eb506d5334bdda99f 521b886fc06b50fee63f203d90e761bf1330c602
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:18:03 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 7bf548294c1fa851d5a60da0af889ceabb512288 2d0dfca8319dd8b5104afaa0ef4534775d1c8453 M	tests/api/notification-preferences/delivery-ssrf.test.ts

commit 998fdc5579a762654b75a9133c4e2714d563973f (from 521b886fc06b50fee63f203d90e761bf1330c602)
Merge: 0ed428834d1c84f111d36a6eb506d5334bdda99f 521b886fc06b50fee63f203d90e761bf1330c602
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:18:03 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 ea825a8470251ceb508c4fb4617af9e603588d0c 69214d64522f74abdec2dd54343fb9f5863511e8 M	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
:100644 100644 c160a7fc0a0821b3bb1a84b79e04c7300a8cf46b ee477f942bfc572715805442fde3e772f78d4f76 M	apps/web/src/hooks/use-native-work-item-realtime.ts
:100644 100644 f7bc8c4c98a93531bf77aa3df4c48c40ca3ad739 15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef M	docs/01-architecture/realtime.md
:100644 100644 23a76df9ac04045a1049886805e6ac56ce822517 0c1f512076da88e3771f3d8a58729281ddb08639 M	tests/api-integration/node-server-websocket.test.ts

commit 0ed428834d1c84f111d36a6eb506d5334bdda99f (from 27b344f33cd1356c38b7254525e9c30b57ddbb96)
Merge: 27b344f33cd1356c38b7254525e9c30b57ddbb96 05b2a77fa9bf8560f445fcbb7047a9ace5983970
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 18:39:15 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 0bceb763f811103aad1f24961c5875faa38410ee b1cecf0a57ff2f56a8a74ee0539119e6c1217003 M	packages/ui/src/components/field.stories.tsx
:100644 100644 065b0121b1394d9525046b2f3a4b7c34c7357e5d 019de76b2958efa14e384fa022f152aeb11f163c M	packages/ui/src/components/field.tsx
:100644 100644 b7c05bde3a2860c85da1a30cf5a19cb27e51462d ceb57339f64f138785973686cdb786584fd1e27b M	packages/ui/src/components/fieldset.stories.tsx
:100644 100644 c5cf25638ce05c2470b284ad77dee437434f658c be0e78c392acb03628a3ab97d3890fc06d747d8f M	packages/ui/src/styles/pairs.json

commit 0ed428834d1c84f111d36a6eb506d5334bdda99f (from 05b2a77fa9bf8560f445fcbb7047a9ace5983970)
Merge: 27b344f33cd1356c38b7254525e9c30b57ddbb96 05b2a77fa9bf8560f445fcbb7047a9ace5983970
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 18:39:15 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

:100644 100644 ea825a8470251ceb508c4fb4617af9e603588d0c 69214d64522f74abdec2dd54343fb9f5863511e8 M	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
:100644 100644 c160a7fc0a0821b3bb1a84b79e04c7300a8cf46b ee477f942bfc572715805442fde3e772f78d4f76 M	apps/web/src/hooks/use-native-work-item-realtime.ts
:100644 100644 f7bc8c4c98a93531bf77aa3df4c48c40ca3ad739 15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef M	docs/01-architecture/realtime.md
:100644 100644 23a76df9ac04045a1049886805e6ac56ce822517 0c1f512076da88e3771f3d8a58729281ddb08639 M	tests/api-integration/node-server-websocket.test.ts

commit 27b344f33cd1356c38b7254525e9c30b57ddbb96
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 18:16:24 2026 +0630

    fix(realtime): conserve native client invalidation handling

:100644 100644 ea825a8470251ceb508c4fb4617af9e603588d0c 69214d64522f74abdec2dd54343fb9f5863511e8 M	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
:100644 100644 c160a7fc0a0821b3bb1a84b79e04c7300a8cf46b ee477f942bfc572715805442fde3e772f78d4f76 M	apps/web/src/hooks/use-native-work-item-realtime.ts
:100644 100644 f7bc8c4c98a93531bf77aa3df4c48c40ca3ad739 15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef M	docs/01-architecture/realtime.md
:100644 100644 23a76df9ac04045a1049886805e6ac56ce822517 0c1f512076da88e3771f3d8a58729281ddb08639 M	tests/api-integration/node-server-websocket.test.ts
```

### Per-parent numstat records

```text
commit 649beec202b0bd2811e34f97be9fe5d69f1c84f2 (from 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec)
Merge: 2d87ac63 13aacb2e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Mon Oct 12 00:08:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
53	0	docs/07-planning/decision-log.md
83	0	docs/07-planning/integration-execution-queue.md
42	0	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md
78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
163	0	docs/07-planning/security-reviews/657-role-query-ownership.md
139	0	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
198	0	docs/07-planning/security-reviews/659-current-role-query-composition.md
83	0	docs/07-planning/status.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts
123	18	tests/api/permissions/enforcement-config.test.ts
260	0	tests/api/utils/seed-default-workspace-roles.test.ts

commit 649beec202b0bd2811e34f97be9fe5d69f1c84f2 (from 13aacb2e87c99a280b50e5297cd296aa512dd0aa)
Merge: 2d87ac63 13aacb2e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Mon Oct 12 00:08:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

425	6	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
97	29	apps/web/src/hooks/use-native-work-item-realtime.ts
11	7	docs/01-architecture/realtime.md
48	2	tests/api-integration/node-server-websocket.test.ts

commit 13aacb2e87c99a280b50e5297cd296aa512dd0aa (from 5abe19bccf0d9c1d61482cb372ea81c40485d4e2)
Merge: 5abe19bc b8a27696
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Mon Oct 12 00:06:47 2026 +0630

    Merge pull request #655 from ThomasHeinThura/codex/mfa-cross-process-barrier
    
    test: order cross-process MFA lock acquisition deterministically

42	0	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md
78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts

commit b8a276966a895272928fec400113acbc3ba4872e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:44:48 2026 +0630

    docs(review): preserve PR 655 current composition review

42	0	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md

commit f4bf750712cad6a65f4b86d5a238e8c0da825603 (from 46b846c284d2a80ec621e3242d906bcfd673faf5)
Merge: 46b846c2 5abe19bc
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:30:23 2026 +0630

    chore(integration): compose accepted boot fixture into MFA barrier

13	0	docs/07-planning/decision-log.md
139	0	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
198	0	docs/07-planning/security-reviews/659-current-role-query-composition.md
123	18	tests/api/permissions/enforcement-config.test.ts

commit f4bf750712cad6a65f4b86d5a238e8c0da825603 (from 5abe19bccf0d9c1d61482cb372ea81c40485d4e2)
Merge: 46b846c2 5abe19bc
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:30:23 2026 +0630

    chore(integration): compose accepted boot fixture into MFA barrier

78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts

commit 5abe19bccf0d9c1d61482cb372ea81c40485d4e2 (from be320b612ce26c492a8767b667813972266a7eb5)
Merge: be320b61 eb7d7821
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:29:01 2026 +0630

    Merge pull request #659 from ThomasHeinThura/codex/boot-refusal-approved-deadline
    
    test(permissions): apply approved production-import refusal deadlines

13	0	docs/07-planning/decision-log.md
139	0	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
198	0	docs/07-planning/security-reviews/659-current-role-query-composition.md
123	18	tests/api/permissions/enforcement-config.test.ts

commit eb7d7821ba542bb488af6d1cfeeee4281a5a1b5c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:14:27 2026 +0630

    docs(review): record current boot composition reviews

198	0	docs/07-planning/security-reviews/659-current-role-query-composition.md

commit 46b846c284d2a80ec621e3242d906bcfd673faf5 (from 7e709db3f13cbc1554a5c95619441b32af36c185)
Merge: 7e709db3 be320b61
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:08:42 2026 +0630

    chore(integration): compose accepted main into MFA barrier

30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
163	0	docs/07-planning/security-reviews/657-role-query-ownership.md
260	0	tests/api/utils/seed-default-workspace-roles.test.ts

commit 46b846c284d2a80ec621e3242d906bcfd673faf5 (from be320b612ce26c492a8767b667813972266a7eb5)
Merge: 7e709db3 be320b61
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:08:42 2026 +0630

    chore(integration): compose accepted main into MFA barrier

78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts

commit 9a15893426b9de5788e4ece65979a5354d928344 (from 18232b937e3cf8fba14d6fc19d65908d163d3933)
Merge: 18232b93 be320b61
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:06:47 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/boot-refusal-approved-deadline

30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
163	0	docs/07-planning/security-reviews/657-role-query-ownership.md
260	0	tests/api/utils/seed-default-workspace-roles.test.ts

commit 9a15893426b9de5788e4ece65979a5354d928344 (from be320b612ce26c492a8767b667813972266a7eb5)
Merge: 18232b93 be320b61
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:06:47 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/boot-refusal-approved-deadline

13	0	docs/07-planning/decision-log.md
139	0	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
123	18	tests/api/permissions/enforcement-config.test.ts

commit be320b612ce26c492a8767b667813972266a7eb5 (from 0aa0be2eae80e781754bc7fe0468d8cda1113c99)
Merge: 0aa0be2e 0b8e28c5
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 23:04:58 2026 +0630

    Merge pull request #657 from ThomasHeinThura/codex/603-current-role-query-ownership
    
    refactor(api): conserve startup role query ownership

30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
163	0	docs/07-planning/security-reviews/657-role-query-ownership.md
260	0	tests/api/utils/seed-default-workspace-roles.test.ts

commit 18232b937e3cf8fba14d6fc19d65908d163d3933
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 22:40:17 2026 +0630

    docs(review): preserve approved boot deadline independent reports

139	0	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md

commit 18068c194ef163802cae855790dd31ec88f006ec
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 22:27:05 2026 +0630

    test(permissions): apply owner-approved boot refusal deadlines

13	0	docs/07-planning/decision-log.md
123	18	tests/api/permissions/enforcement-config.test.ts

commit 0b8e28c557d2bc6a1a9fbba8b57e0e3e9e0692a6
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 22:18:16 2026 +0630

    docs(review): preserve selected role-query independent reports

163	0	docs/07-planning/security-reviews/657-role-query-ownership.md

commit f39438e291b5942fb1fe801f8dee614ce19fa399 (from 36bcc16ffb53eb16730499a2b70bb07792e8ad0b)
Merge: 36bcc16f 0aa0be2e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:54 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/603-current-role-query-ownership

12	0	docs/07-planning/decision-log.md
14	0	docs/07-planning/integration-execution-queue.md
14	0	docs/07-planning/status.md

commit f39438e291b5942fb1fe801f8dee614ce19fa399 (from 0aa0be2eae80e781754bc7fe0468d8cda1113c99)
Merge: 36bcc16f 0aa0be2e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:54 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/603-current-role-query-ownership

30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
260	0	tests/api/utils/seed-default-workspace-roles.test.ts

commit 7e709db3f13cbc1554a5c95619441b32af36c185 (from 5036913ad20c8c8ed8ba1b66f7788017290859a0)
Merge: 5036913a 0aa0be2e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:04 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

12	0	docs/07-planning/decision-log.md
14	0	docs/07-planning/integration-execution-queue.md
14	0	docs/07-planning/status.md

commit 7e709db3f13cbc1554a5c95619441b32af36c185 (from 0aa0be2eae80e781754bc7fe0468d8cda1113c99)
Merge: 5036913a 0aa0be2e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:58:04 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts

commit 0aa0be2eae80e781754bc7fe0468d8cda1113c99 (from 411c802cc87647bcfe85bd526b7b19c88da496bc)
Merge: 411c802c 75c71d38
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:57:35 2026 +0630

    Merge pull request #656 from ThomasHeinThura/codex/workflow-historical-edge-owner-20261011
    
    docs: record historical workflow held-edge boundary

12	0	docs/07-planning/decision-log.md

commit 75c71d38e8f58111627c8d8bd07c0787778619d6 (from ac11e494d6234d89cff9ae01044e5a3b365deec7)
Merge: ac11e494 411c802c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:47:53 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/workflow-historical-edge-owner-20261011

14	0	docs/07-planning/integration-execution-queue.md
14	0	docs/07-planning/status.md

commit 75c71d38e8f58111627c8d8bd07c0787778619d6 (from 411c802cc87647bcfe85bd526b7b19c88da496bc)
Merge: ac11e494 411c802c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:47:53 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/workflow-historical-edge-owner-20261011

12	0	docs/07-planning/decision-log.md

commit 36bcc16ffb53eb16730499a2b70bb07792e8ad0b
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:47:00 2026 +0630

    refactor(api): own startup role seed reads

30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
260	0	tests/api/utils/seed-default-workspace-roles.test.ts

commit 411c802cc87647bcfe85bd526b7b19c88da496bc (from 0978d77e73c66c0ab56b45806ad51f8e2aef6271)
Merge: 0978d77e bf0b16a1
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:46:06 2026 +0630

    Merge pull request #654 from ThomasHeinThura/codex/delivery-checkpoint-20261011-6
    
    docs: checkpoint S7 verification and canonical fixture blockers

14	0	docs/07-planning/integration-execution-queue.md
14	0	docs/07-planning/status.md

commit ac11e494d6234d89cff9ae01044e5a3b365deec7
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:42:50 2026 +0630

    docs: record historical workflow held-edge boundary

12	0	docs/07-planning/decision-log.md

commit 5036913ad20c8c8ed8ba1b66f7788017290859a0 (from cca6ed58e27bef8c70369cbd092f2f12a2ca1e61)
Merge: cca6ed58 0978d77e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:21 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

11	0	docs/07-planning/decision-log.md

commit 5036913ad20c8c8ed8ba1b66f7788017290859a0 (from 0978d77e73c66c0ab56b45806ad51f8e2aef6271)
Merge: cca6ed58 0978d77e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:21 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/mfa-cross-process-barrier

78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts

commit bf0b16a1421ea9c8c8ccf66d58b6b08cfd336de4 (from 02fc46ec2452ef76a5abea059f09bb9fc4b125e3)
Merge: 02fc46ec 0978d77e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:12 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/delivery-checkpoint-20261011-6

11	0	docs/07-planning/decision-log.md

commit bf0b16a1421ea9c8c8ccf66d58b6b08cfd336de4 (from 0978d77e73c66c0ab56b45806ad51f8e2aef6271)
Merge: 02fc46ec 0978d77e
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:33:12 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/delivery-checkpoint-20261011-6

14	0	docs/07-planning/integration-execution-queue.md
14	0	docs/07-planning/status.md

commit 0978d77e73c66c0ab56b45806ad51f8e2aef6271 (from 12c09aaca85250c03223df1ed191275c0d3cdd74)
Merge: 12c09aac fb62c7ca
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:32:48 2026 +0630

    Merge pull request #653 from ThomasHeinThura/codex/s7-set-field-owner-decision-20261011
    
    docs: record owner hold and refusal of workflow set_field

11	0	docs/07-planning/decision-log.md

commit cca6ed58e27bef8c70369cbd092f2f12a2ca1e61
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:14:52 2026 +0630

    docs: preserve independent MFA fixture reviews

78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md

commit 7513e4bbfc086a3f4240250b7383f9329cfc0a83
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:06:24 2026 +0630

    test(api): order MFA fixture lock contention

59	20	tests/api/mfa-csrf-app-fixture.test.ts

commit fb62c7cab475bbe6300812ee3b68f705f8889d7c
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:06:08 2026 +0630

    docs: record owner hold on workflow set_field

11	0	docs/07-planning/decision-log.md

commit 02fc46ec2452ef76a5abea059f09bb9fc4b125e3
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 21:03:59 2026 +0630

    docs: record current S7 verification and fixture blockers

14	0	docs/07-planning/integration-execution-queue.md
14	0	docs/07-planning/status.md

commit 12c09aaca85250c03223df1ed191275c0d3cdd74
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 20:11:42 2026 +0630

    docs: checkpoint source-bound delivery evidence (#645)
    
    * docs: checkpoint current review and runtime evidence
    
    * docs: checkpoint accepted intake owner record
    
    * docs: clarify partial hosted field evidence
    
    * docs: record accepted Users and selected integration progress
    
    * docs: record accepted Field and current D9 unit blocker
    
    * docs: record accepted notification fixture and current journeys
    
    * docs: checkpoint accepted D9 and remaining semantic blockers
    
    * docs: correct newest checkpoint UTC timestamp

69	0	docs/07-planning/integration-execution-queue.md
69	0	docs/07-planning/status.md

commit 2ecff903eb9e6a74f2d6a5eb03a54849b36afa45
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:48:17 2026 +0630

    docs: record saved-view holds and terminal key expiry (#651)

17	0	docs/07-planning/decision-log.md

commit 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec (from 998fdc5579a762654b75a9133c4e2714d563973f)
Merge: 998fdc55 9e79f7e8
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:34:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

23	0	docs/07-planning/decision-log.md

commit 2d87ac63a42e09e8899bcf262e5cb9aedeee0fec (from 9e79f7e8d51627ea51b18f7525b6f32baaa7f559)
Merge: 998fdc55 9e79f7e8
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:34:36 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

425	6	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
97	29	apps/web/src/hooks/use-native-work-item-realtime.ts
11	7	docs/01-architecture/realtime.md
48	2	tests/api-integration/node-server-websocket.test.ts

commit 998fdc5579a762654b75a9133c4e2714d563973f (from 0ed428834d1c84f111d36a6eb506d5334bdda99f)
Merge: 0ed42883 521b886f
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:18:03 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

1	7	tests/api/notification-preferences/delivery-ssrf.test.ts

commit 998fdc5579a762654b75a9133c4e2714d563973f (from 521b886fc06b50fee63f203d90e761bf1330c602)
Merge: 0ed42883 521b886f
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 19:18:03 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

425	6	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
97	29	apps/web/src/hooks/use-native-work-item-realtime.ts
11	7	docs/01-architecture/realtime.md
48	2	tests/api-integration/node-server-websocket.test.ts

commit 0ed428834d1c84f111d36a6eb506d5334bdda99f (from 27b344f33cd1356c38b7254525e9c30b57ddbb96)
Merge: 27b344f3 05b2a77f
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 18:39:15 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

3	3	packages/ui/src/components/field.stories.tsx
1	1	packages/ui/src/components/field.tsx
3	3	packages/ui/src/components/fieldset.stories.tsx
122	170	packages/ui/src/styles/pairs.json

commit 0ed428834d1c84f111d36a6eb506d5334bdda99f (from 05b2a77fa9bf8560f445fcbb7047a9ace5983970)
Merge: 27b344f3 05b2a77f
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 18:39:15 2026 +0630

    Merge remote-tracking branch 'origin/main' into codex/605-native-client-selected

425	6	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
97	29	apps/web/src/hooks/use-native-work-item-realtime.ts
11	7	docs/01-architecture/realtime.md
48	2	tests/api-integration/node-server-websocket.test.ts

commit 27b344f33cd1356c38b7254525e9c30b57ddbb96
Author: Thomas Hein Thura <thomas.h.thura@gmail.com>
Date:   Sun Oct 11 18:16:24 2026 +0630

    fix(realtime): conserve native client invalidation handling

425	6	apps/web/src/hooks/use-native-work-item-realtime.test.tsx
97	29	apps/web/src/hooks/use-native-work-item-realtime.ts
11	7	docs/01-architecture/realtime.md
48	2	tests/api-integration/node-server-websocket.test.ts
```

### Exact final merge tree delta (raw)

```text
:000000 100644 0000000000000000000000000000000000000000 b4120c6d6d54054adbd3fb81708bfb2ff00f6e56 A	apps/api/src/utils/repository.ts
:100644 100644 eb83303aa7ac9b11f7b9316f962128442b4736eb 475800aa9653dddeada3e3985552270735b456cd M	apps/api/src/utils/seed-default-workspace-roles.ts
:100644 100644 100db9461be2c740acf6d0050e9aabbb7334f97e b270ed783d48a147696b29e2a10b231efd02b194 M	docs/07-planning/decision-log.md
:100644 100644 457b388b6ff042abc9f076f3246f8e69d0727e8c bf4631207ab3e91a1f3209a9d3cc076a028d9b95 M	docs/07-planning/integration-execution-queue.md
:000000 100644 0000000000000000000000000000000000000000 ea067be5e89717a3a7c2f19596e2e7adf068604d A	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md
:000000 100644 0000000000000000000000000000000000000000 55f94ebef515bfee5f59f281088de25578147e1b A	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
:000000 100644 0000000000000000000000000000000000000000 ed998a4ca806dd0db771a3ca88f6bb39f67fd355 A	docs/07-planning/security-reviews/657-role-query-ownership.md
:000000 100644 0000000000000000000000000000000000000000 2b8aa64ffae1cdc561bbd243c9b078b45c6d719e A	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
:000000 100644 0000000000000000000000000000000000000000 3edbcd1534547226ea7de29c085764da1d928c4b A	docs/07-planning/security-reviews/659-current-role-query-composition.md
:100644 100644 dd97587265a4f03e8bbbeb39b846902e3390c15d 3c1446607adc1bf3b910bdc8516fb618a9056192 M	docs/07-planning/status.md
:100644 100644 ca294be7a529b40afb3cb55070e974cfa7f37fb4 5efa5d5aa35355d5987f9061dc65e8f704efd9c6 M	tests/api/mfa-csrf-app-fixture.test.ts
:100644 100644 f85806ed0b176179ca816a2b59fa42841941eb42 ee9094fd34f2d66dbec911b0eceecf3dfbfc7149 M	tests/api/permissions/enforcement-config.test.ts
:000000 100644 0000000000000000000000000000000000000000 4a0f521c40e5f9e0776c139f08e43228d2521bac A	tests/api/utils/seed-default-workspace-roles.test.ts
```

### Exact final merge tree delta (numstat)

```text
30	0	apps/api/src/utils/repository.ts
7	18	apps/api/src/utils/seed-default-workspace-roles.ts
53	0	docs/07-planning/decision-log.md
83	0	docs/07-planning/integration-execution-queue.md
42	0	docs/07-planning/security-reviews/655-current-accepted-boot-composition.md
78	0	docs/07-planning/security-reviews/655-mfa-cross-process-barrier.md
163	0	docs/07-planning/security-reviews/657-role-query-ownership.md
139	0	docs/07-planning/security-reviews/659-approved-boot-refusal-deadlines.md
198	0	docs/07-planning/security-reviews/659-current-role-query-composition.md
83	0	docs/07-planning/status.md
59	20	tests/api/mfa-csrf-app-fixture.test.ts
123	18	tests/api/permissions/enforcement-config.test.ts
260	0	tests/api/utils/seed-default-workspace-roles.test.ts
```

## Checks run at `649beec202b0bd2811e34f97be9fe5d69f1c84f2`

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/use-native-work-item-realtime.test.tsx` — 1 file, 8 tests passed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/permissions/enforcement-config.test.ts tests/api/mfa-csrf-app-fixture.test.ts` — 2 files, 18 tests passed; includes the canonical approved boot-refusal deadline and parent-first cross-process MFA contention fixtures.
- No API integration/Postgres, browser, image or runtime test run; shared host resources remain under orchestrator control.

## Historical failures retained

- Earlier G11 calibration failure remains unresolved/source-bound to its original `998fdc...` head: batch spread `0.681` exceeded unchanged `0.55`; its 22 budget cases did not establish a pass. No rerun or calibration/budget change was made here.
- The actual 5-second canonical boot fixture failure remains preserved as a real failure at the prior `2d87ac...` head. Current exact-head focused canonical boot/MFA tests pass 18/18; that does not erase or attribute cause to the old failure.

## Dependencies and limits

Frozen dependency inputs were already installed in the worktree; no install needed. No S7 unaccepted imports, backend/user/UI source edits, image/browser/database work, merge to protected main, or review claim. Prior source reviews remain source-bound; fresh current-head review and full checks are pending.

## Next action

Orchestrator reviews the full accepted-main composition at the required current-source tier, runs the applicable complete checks and required native/browser/image evidence, and advances draft #650 only when its gates are met.
