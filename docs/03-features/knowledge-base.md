# Knowledge base

- **Phase:** P5
- **Status:** ⬜
- **Feature flag:** `feature.knowledge_base`
- **Depends on:** request types, search

## Purpose

Answer questions before they become tickets, and stop staff re-typing the same explanation.

The measure of success is not article count. It is **deflection** — requests that were not
raised because the answer was already there.

## Concepts

| Concept | Meaning |
| --- | --- |
| **Article** | A titled document with rich text |
| **Category** | A hierarchical grouping |
| **Status** | `draft` · `in_review` · `published` · `archived` |
| **Visibility** | Staff-only, or published to customers |
| **Version** | An immutable snapshot on each publish |

## Behaviour

- `KB-1` An article belongs to a workspace and optionally to a project, which scopes who
  sees it.
- `KB-2` `customer_visible` plus `published` are both required for a customer to see it.
  Two conditions, deliberately, so an unfinished customer-facing article cannot leak.
- `KB-3` Publishing creates an immutable version. History is browsable and restorable.
- `KB-4` An optional review step: an author submits, a reviewer publishes. Configurable
  per workspace, off by default.
- `KB-5` Articles are written in Tiptap, with headings, lists, tables, code blocks, images
  and callouts.
- `KB-6` Articles may embed a work item reference, rendering key, title and state live.
- `KB-7` Articles carry an owner and a review date. Overdue reviews are reported, because
  a stale knowledge base is worse than none.

## Deflection

The whole point.

- `KB-8` As a customer types a request summary, matching published articles are offered
  inline.
- `KB-9` Matching uses the same full-text index as search, weighted to titles.
- `KB-10` Opening an article from the request form records a deflection candidate. If the
  customer then abandons the form, it counts as a deflection.
- `KB-11` Deflection is **never coercive.** No "are you sure you still need help?" step.
  It offers and gets out of the way. Nothing damages trust in a portal faster than being
  made to argue with it.
- `KB-12` Staff see the same suggestions while triaging, so an article can be linked in a
  reply rather than re-typed.

## Discovery

- `KB-13` Full-text search across title and body, scoped to what the viewer may see.
- `KB-14` Browse by category.
- `KB-15` "Related articles" from shared categories and text similarity.
- `KB-16` Most-viewed and recently-updated lists.
- `KB-17` "Was this helpful?" — a yes/no with an optional comment, feeding a report of
  articles that are read but do not help.

## Permissions

| Action | Capability |
| --- | --- |
| Read published, customer-visible | Portal session, correct scope |
| Read staff articles | `kb_article:read` |
| Create and edit drafts | `kb_article:write` |
| Publish | `kb_article:publish` |
| Archive | `kb_article:publish` |
| Manage categories | `kb_article:publish` |

## Screens

**Agent** — article list with status, owner and review date; article view with version
history; editor with a live preview of the customer's view; category management; a
deflection report.

**Portal** — search, browse by category, article view, helpfulness prompt.

The editor's customer preview matters for the same reason it does on request forms: an
author must see what a customer will see, including which internal notes are hidden.

## API

```
GET    /api/kb/articles                        kb_article:read
POST   /api/kb/articles                        kb_article:write
GET    /api/kb/articles/{id}                   kb_article:read
PATCH  /api/kb/articles/{id}                   kb_article:write
POST   /api/kb/articles/{id}/publish           kb_article:publish
GET    /api/kb/articles/{id}/versions          kb_article:read
GET    /api/kb/search?q=…                      (scoped)
GET    /api/kb/categories                      kb_article:read
GET    /api/portal/kb                          (portal session)
GET    /api/portal/kb/{id}                     (portal session)
POST   /api/portal/kb/{id}/feedback            (portal session)
GET    /api/kb/deflection?q=…                  kb_article:read           (agent — staff see the same suggestions, KB-12)
GET    /api/portal/kb/deflection?q=…           { portal: 'customer', predicate: 'own_organisation' }
       — two routes sharing one domain function, never one route serving "either session" (ADR 0004)
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Article unpublished while a customer has it open | Next load returns 404. No mid-read removal |
| Article scoped to a project the customer loses access to | Disappears from their list; the URL returns 404 |
| Image in an article, attachment deleted | Placeholder rendered; the article is flagged for review |
| Two authors editing concurrently | Optimistic concurrency, 409, with a diff |
| Category deleted with articles | Refused. Articles must be moved first |
| Very long article | Auto-generated table of contents from headings |
| Article referencing a deleted work item | Reference renders as "(removed)" |

## Out of scope

- Multi-language articles — Phase 6 candidate
- AI-generated articles from resolved tickets — Phase 6 candidate, and it needs care
- Public, unauthenticated knowledge base

## Testing

Integration: an unpublished or non-customer-visible article is absent from every portal
response, including search and deflection; project scoping holds.

E2E: write, review, publish; see it appear as a deflection suggestion while raising a
request; abandon the form and confirm the deflection is recorded.

## Related

- [Request types](request-types-and-catalogue.md) · [Customer portal](customer-portal.md)
- [Search](search-and-saved-views.md)
