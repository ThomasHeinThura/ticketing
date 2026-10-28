# Third-party notices

TaskDesk is licensed under **AGPL-3.0** ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). It
also contains, or will contain, software written by other people under their own licences.
This file is the record of every such component: what it is, whose it is, under which
licence, and — where code was copied rather than merely depended on — the exact commit it
came from.

**This file exists before any third-party code is in the repository, deliberately.** The
provenance boundary is that TaskDesk's own licence is committed first and the inherited
code second, so that at no point does upstream code sit in this repository without its
notice ([licensing-and-attribution.md](docs/00-overview/licensing-and-attribution.md)).

## 1. kaneo — the foundation

`apps/api`, `apps/web`, `packages/*` and the build tooling of this repository descend from
**kaneo**, taken **once** as a source snapshot and maintained from then on as TaskDesk's own
code. There is no upstream relationship, no merges from upstream, and no expectation of
receiving upstream fixes ([ADR 0001](docs/01-architecture/adr/0001-kaneo-as-foundation.md)).

| | |
| --- | --- |
| Project | kaneo — <https://github.com/usekaneo/kaneo> |
| Licence | MIT (reproduced verbatim below) |
| Copyright holder | Andrej Acevski |
| **Commit taken** | `42bb801114aa1ae499228a53180f0cdbc5607964` |
| What that commit is | upstream `main` — **a commit, not a release tag** |
| Date of that commit | 2026-09-05 |
| Upstream CI on that commit | GitHub Actions run `33957941564`, green (lint, i18n, typecheck, unit, build, integration, docker build) |
| Why this commit and not `v2.22.0` | the latest release tag predates upstream authorization fixes — `6de9ea05` "close five workspace-scoping gaps", `6bfe74de` "read the raw body in task permission middleware", `a581bdd2` "restore the entitlement check on project creation". Because kaneo is taken once and never merged again, a commit chosen for tidiness would carry known-fixed authorization bugs into TaskDesk permanently |
| Confirmed by | Thomas Hein Thura, 2026-09-06 |
| Verification run | **done, 2026-09-06** — kaneo's own suite green on the snapshot (130 unit files / 692 tests; 33 integration files / 227 tests on both Postgres 16 and 18; 0 failed, 0 skipped), `pnpm audit` 0 critical / 8 high (none reachable in a shipped TaskDesk), Trivy 0 critical. Full record in [inherited-features.md](docs/01-architecture/inherited-features.md) |
| Import status | **pending** — the snapshot is imported in its own pull request, after this one merges |

The verification run against that commit — kaneo's own test suite, `pnpm audit` and a Trivy
scan — is recorded with its results in
[inherited-features.md](docs/01-architecture/inherited-features.md), which is the single
place where every fact that depends on the snapshot commit is stated.

Files taken from kaneo verbatim keep their original copyright headers. A file rewritten so
completely that nothing of kaneo's remains may lose its header, and the rewrite is recorded
in the [decision log](docs/07-planning/decision-log.md).

### kaneo licence, verbatim

```
MIT License

Copyright (c) 2024 Andrej Acevski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. Projects we studied but did not copy

Recorded so the distinction is on the record rather than in someone's memory. No code from
any of these is present in this repository, and none may be added — Plane and OpenProject
are copyleft licences whose code we have chosen not to take even where it would be legal,
and the ITSM systems below were read for their product decisions only.

| Project | Licence | Taken |
| --- | --- | --- |
| Plane | AGPL-3.0 | Ideas only |
| OpenProject | GPL-3.0 | Ideas only |
| Chatwoot, FreeScout, GLPI, NocoBase, osTicket, Zammad | MIT / AGPL-3.0 / GPL-3.0 / Apache-2.0 / GPL-2.0 / AGPL-3.0 | Ideas only |
| TaskDesk v1 | Ours | Domain logic, reimplemented from its tests in TypeScript |

Detail, and the reasoning behind each: [licensing-and-attribution.md](docs/00-overview/licensing-and-attribution.md).

## 3. Runtime and build dependencies

**To be completed when dependencies are installed in P0.** The list is generated from
`pnpm-lock.yaml` rather than maintained by hand, published as an SBOM with every release
([ci-cd.md](docs/04-engineering/ci-cd.md)), and checked in CI for licences incompatible
with AGPL-3.0. Fonts, icon sets and any bundled media are listed here too, because they
carry their own terms: Geist and Geist Mono (SIL Open Font License 1.1) and lucide
(ISC) are the ones the design system already assumes.

## 4. Adding an entry

Any code, asset, font or snippet entering this repository from anywhere other than a
declared dependency needs a row here **in the same pull request that brings it in**, giving
the source, the licence, the copyright holder and the exact commit or version. A pull
request that adds third-party code without its notice is incomplete, and the reviewer's job
is to say so.

Never paste code from a blog, a forum answer, or a model's recollection of another
codebase: the provenance cannot be established afterwards, and an unprovenanced file is a
licence risk that has to be removed rather than documented.

# Direct API transport dependencies added for the Node WebSocket upgrade migration

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `ws` | 8.22.0 | MIT | WebSocket server owned directly by `apps/api` |
| `@types/ws` | 8.18.2 | MIT | Development-only TypeScript declarations for `ws` |
| `@hono/node-server` | 2.1.3 | MIT | Existing runtime dependency upgraded for the built-in upgrade helper |
| `hono` | 4.13.12 | MIT | Existing runtime dependency upgraded to the patched path handling floor |

The incompatible `@hono/node-ws` package is removed. Existing transitive `ip-address` and
`fast-uri` floors are also raised for production advisory fixes; their verified licenses
are MIT and BSD-3-Clause respectively (see the #557 decision in `docs/07-planning/decision-log.md`).

## P0 observability dependencies

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `pino` | 10.4.0 | MIT | Allowlisted structured server logging |
| `prom-client` | 15.1.3 | Apache-2.0 | Registered bounded Prometheus metrics |

Installed as declared dependencies, with versions and transitive licences in the release
SBOM. No implementation source is copied from either project. Thomas explicitly approved
these additions on 2026-10-03.

## P5 holiday preset dataset (CAL-10, CAL-11)

`packages/domain/src/service-management/holiday-presets.ts` generates country holiday presets
for the service calendar. **Source:** the public statutory rules themselves (fixed dates,
Easter-relative days computed with the Meeus/Jones/Butcher Gregorian algorithm, nth-weekday
rules and the usual weekend substitutions), written down by the TaskDesk authors as rules, not
copied from a holiday database, library or web page. No third-party code or data file is
included, so there is no third-party licence to carry; the file is AGPL like the rest of
TaskDesk. The dataset is versioned (`HOLIDAY_PRESET_DATASET_VERSION`), refreshed each release,
and never fetched at request time. Presets are a starting point the administrator confirms
(`CAL-11`); each states what it leaves out (regional, lunar, religious and one-off proclaimed
holidays). Approved by Thomas on 23 October 2026 (decision log: holiday dataset, CAL-10/11).

## P1 virtualization dependency

`@tanstack/react-virtual` 3.14.22 and its `@tanstack/virtual-core` dependency are MIT-licensed TanStack Virtual packages (Copyright 2021-present Tanner Linsley), sourced from <https://github.com/TanStack/virtual>. Installed as dependencies; no implementation source is copied. Thomas approved the v3 dependency on 25 October 2026 for scrolling calculations while preserving Kaneo components. Exact resolved versions remain in `pnpm-lock.yaml`.

## Mermaid rendering security update

Mermaid 11.16.1 now resolves its existing KaTeX dependency to **0.18.2** (MIT; <https://github.com/KaTeX/KaTeX>) through a scoped package override for GHSA-238p-pmpm-9mq7. No library source or interface is copied. Mermaid strict mode and the existing SVG sanitizer remain enabled.

## PDF rendering dependency

`pdfjs-dist` 6.4.299 is Mozilla’s PDF.js, distributed under Apache-2.0 (<https://github.com/mozilla/pdf.js>). Thomas approved this exact version on 25 October 2026 for lazy sandboxed rendering inside the existing Kaneo attachment dialog. No third-party viewer interface is copied. The dependency’s license is reproduced below and ships with this notice. Exact resolved dependencies remain in `pnpm-lock.yaml`.

### PDF.js Apache-2.0 license

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```


## Local dependency repair: react-i18next 17.0.11

The existing MIT-licensed dependency is patched in
[`patches/react-i18next@17.0.11.patch`](patches/react-i18next@17.0.11.patch).
Its translation snapshot now includes the i18next instance, namespace list and
namespace mode in its cache identity, preventing stale translations when a
provider changes while preserving component state. Source, ESM and CommonJS
entries are patched consistently; the package version is unchanged. The upstream
[copyright and MIT licence](patches/react-i18next.LICENSE) are retained.
