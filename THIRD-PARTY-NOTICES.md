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
