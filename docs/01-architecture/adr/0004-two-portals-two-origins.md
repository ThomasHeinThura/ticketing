# 0004 — Two portals, two origins, one codebase

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

v1's ADR 0004 was described as its "load-bearing decision": two hostnames, two identity
providers, two independently built bundles, with **no shared chunks**, so that no staff
code ever reached a customer browser.

The intent was sound. The execution had a hidden cost and a hidden false confidence.

**The cost:** two entry points into one source tree with no shared component library
meant the agent UI and the portal UI drifted. The portal was eventually described in v1's
own documentation as "a shell, not a working product" showing fixture data, and had to be
rebuilt from scratch.

**The false confidence:** all eleven authorization holes v1 discovered were **server-side
handler bugs**. Bundle separation prevented none of them. Worse, it encouraged reasoning
of the form "that's fine, that screen isn't in the customer bundle" — which is not a
security argument, because a browser bundle is not a security boundary. The server is.

So the question for v2 was: keep the split, drop it, or keep part of it.

## Decision

**Keep two origins and two sessions. Keep two bundles. Share one source tree and one
design system.**

- `ticket.<domain>` serves the agent bundle. `portal.<domain>` serves the customer bundle.
- Separate cookies scoped to each host, so an agent session and a customer session can
  never be confused. **The mechanism is two better-auth instances, one per portal origin.**
  better-auth derives cookie names, `baseURL` and `trustedOrigins` from *construction-time*
  configuration, never from the incoming request, so one instance cannot issue a differently
  named cookie per host. The auth holder therefore constructs a **pair** on every reload —
  each instance with its own `baseURL` (that portal's origin), its own cookie name
  (`__Host-tdk_agent_session` on `ticket.<domain>`, `__Host-tdk_portal_session` on
  `portal.<domain>`), its own `trustedOrigins` holding **that origin only**, and its own
  provider set (the connections scoped to that portal). **The request host selects the
  instance**; the two are built, validated and swapped together. kaneo's `COOKIE_DOMAIN`
  variable and its cross-subdomain `SameSite=None; Partitioned` cookie branch are **removed
  at the fork** — both are incompatible with a `__Host-` name prefix, and each portal's API
  is served on that portal's own origin, which `/api/portal/*` below already implies
  ([auth-and-identity.md § Sessions](../auth-and-identity.md#sessions),
  [auth-runtime-reconfiguration.md](../auth-runtime-reconfiguration.md)).
- The portal boundary is enforced **at the identity-provider callback** (a customer
  completing a login on the agent origin gets no session and an audit row) **and on every
  request** (session portal must match request host).
- One `apps/web` source tree with two Vite entries, `entry.agent.tsx` and
  `entry.portal.tsx`, mounting `routes/agent/*` and `routes/portal/*` respectively.
- **Both import the same `packages/ui`.** Primitives are shared; screens are not.
- A build-time check asserts that no module under `routes/agent/` or
  `components/god-mode/` appears in the portal bundle's module graph.
- The API exposes a deliberately narrow, separately reviewed `/api/portal/*` router rather
  than reusing agent handlers with a role check.

And, stated explicitly in the codebase and in review:

> **The bundle split is an information-disclosure control, not a security boundary.
> The security boundary is server-side policy.**

## Consequences

### Positive

- Internal route names, admin labels, staff-only feature names and God Mode strings never
  ship to a customer browser. That is a real, if modest, reduction in disclosure.
- Customers download a much smaller application.
- Separate origins give separate cookie scopes, separate CSP, and separate identity
  provider bindings — the last of which is a genuine enterprise requirement.
- Sharing `packages/ui` means the portal cannot drift into a second-class interface, which
  is exactly what happened in v1.
- The narrow `/api/portal/*` router is small enough to review in one sitting.

### Negative

- **Two builds, two deployment paths, two TLS certificates, two DNS records.** More
  operational surface than a single origin.
- **Local development needs two hostnames**, which means `/etc/hosts` entries or a
  wildcard DNS trick. Mitigated by shipping a `deploy/local` Traefik configuration and a
  documented one-line setup.
- **Cross-portal links are awkward.** A staff member following a link to a customer view
  crosses an origin and needs a separate session. Accepted — it is rare and it is
  arguably correct.
- Some duplication remains in layout shells and navigation, since the two applications
  genuinely have different information architectures.

### Neutral

- If we ever wanted to collapse to one origin, the shared `packages/ui` and shared source
  tree make it a routing change rather than a rewrite. The decision is reversible in a way
  v1's was not.

## Alternatives considered

**One origin, role-based routing, portal as a route group** — kaneo's shape. Rejected.
It gives up per-portal identity provider binding, ships the entire agent application to
every customer, and makes an accidental leak of an internal string much more likely. The
cost of two origins is real but bounded; the benefit is permanent.

**Two origins and two entirely separate applications** — v1's shape. Rejected. This is
precisely what produced v1's abandoned portal. Two codebases means one of them is always
the neglected one.

**Same origin, path prefix (`/portal`).** Rejected. Cookies cannot be separated by path in
any way that is a security control, so the two sessions would share a scope. It gets the
operational simplicity without the property that motivated the split.

**Single origin with a server-rendered portal.** Rejected. It introduces SSR, a second
rendering model, for no benefit we need.

## Notes for reviewers

If you find yourself writing "this is safe because it isn't in the customer bundle" in a
review comment, that reasoning is invalid. Ask instead: what does the server do when a
customer session calls this route directly? If the answer is not "the policy middleware
denies it", the code is wrong.

## Amendments

**2026-09-06 — the cookie mechanism is named.** As first accepted this ADR said "separate
cookies scoped to each host" without saying how one auth library produces two differently
named cookies; the earlier architecture review had already flagged that this is not a
configuration setting. The decision bullet above now names it: two better-auth instances,
one per portal origin, selected by request host, with per-instance `baseURL`, cookie name,
`trustedOrigins` and provider set, and `COOKIE_DOMAIN` removed at the fork. The alternative
— a single instance behind a request-scoped wrapper that rewrites `Set-Cookie` and `Cookie`
names — is recorded in [decision-log.md](../../07-planning/decision-log.md) as the one-line
reversal. Nothing else in this ADR changes.

## Related

- [Security model](../security-model.md) · [Auth and identity](../auth-and-identity.md)
- [Customer portal](../../03-features/customer-portal.md)
