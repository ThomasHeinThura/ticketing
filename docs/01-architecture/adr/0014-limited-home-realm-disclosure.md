# 0014 — Customer home-realm routing accepts limited domain-specific disclosure

- **Status:** Accepted
- **Date:** 2026-10-01
- **Deciders:** Thomas, under the 2026-09-23 standing delegation to take the clearly recommended option; recorded by the orchestrating session on 2026-10-01

## Context

The customer portal starts OIDC login from a visitor-submitted email domain. A configured
customer SSO binding routes the visitor to its selected identity provider; an unbound domain
continues through available non-SSO methods. The complete unauthenticated flows therefore
cannot be indistinguishable: the redirect destination and subsequent navigation can reveal
whether the submitted domain has an SSO binding and can expose the IdP's public destination,
including a public tenant path.

The earlier full-flow non-enumeration claim was contested because matching the first
response's body, status, or timing does not hide this later routing. Preserving home-realm
routing while claiming that an anonymous observer learns nothing about the binding would be
misleading. A different privacy boundary is needed for the specified first-release journey.

The standing delegation recorded in
[decision-log.md](../../07-planning/decision-log.md#2026-09-23--standing-delegation-take-the-recommended-option-ask-only-on-a-real-trade-off)
states: “when there is one clearly recommended option, the orchestrating session takes it
without stopping to ask.” The orchestrator adopts the recommended limited-disclosure policy
under that delegation. This records the design decision; it is not review clearance or
evidence that runtime behavior or planned tests exist.

## Decision

The customer portal accepts a limited, domain-specific disclosure during unauthenticated
home-realm routing. A visitor who submits a domain may infer whether it has a customer SSO
binding and may see the selected IdP's public redirect destination. The portal does not
publish an organisation or connection list, a general discovery/configuration inventory, or
organisation names, connection identifiers, secrets, claim mappings, or TaskDesk account
existence through this flow. The anonymous rate limit reduces bulk probing; it does not hide
the binding or restore non-enumeration. Equal initial response body, status, or timing is not
a privacy guarantee for the complete flow. The feature authority for this boundary is
[identity provisioning, IP-29](../../03-features/identity-provisioning.md#ip-29-the-portal-login-page-has-a-limited-domain-specific-sso-disclosure).

This disclosure does not grant identity or TaskDesk authority. The typed domain selects only
which unauthenticated OIDC flow starts. Server-side single-use state pins the selected
connection, customer portal, and persisted `organisation_id`; the callback cannot reselect
the connection or change scope. JIT admission still requires the selected connection's exact
`iss`/`tid`/`aud`, immutable `oid`, its configured signed app-role value, and signed `acct=0`.
Guests and missing proof fail closed. Domains and address-like claims do not admit, link, or
scope accounts; a validated cross-connection domain collision can only deny. These existing
identity and admission rules remain defined by `IP-9` and `IP-27`.

A genuinely private preflight that verifies the visitor's right to learn the SSO route is a
separate future journey design. It must specify uniform pre-proof behavior, email delivery,
recovery, abuse controls, and full-flow acceptance evidence before replacing this decision.

## Consequences

### Positive

- Home-realm routing remains available without publishing a provider or customer inventory.
- The privacy boundary names what the public flow reveals and what it continues to protect.
- Domain routing remains separate from connection-pinned identity admission and organisation
  authority.

### Negative

- Anonymous visitors can probe submitted domains to infer customer SSO bindings and observe
  the selected IdP's public destination. Rate limiting limits volume but cannot remove this
  disclosure.
- Deployments that require hiding domain-to-SSO associations cannot use this journey without
  adopting a separately specified private preflight.
- The full bound and unbound login flows are observably different, which must remain explicit
  in privacy claims and acceptance evidence.

### Neutral

- This decision adds no route, table, configuration field, provider, or identity capability.
- Planned whole-flow browser coverage records the permitted binding/IdP disclosure and
  prohibited inventory, configuration, secret, and account-existence disclosure. This ADR
  does not claim those tests have been implemented or run.
- The 25 named P3 acceptance tests, real-Entra completion gate, open historical owner rows
  81–82, independent reviews, and required security review remain separate gates.

## Alternatives considered

**Require complete non-enumeration while keeping domain-driven IdP routing.** Rejected because
the selected IdP redirect and later navigation make the binding observable; parity of the
initial response cannot satisfy that claim.

**Verify an email address before looking up or routing by its domain.** Deferred as a separate
journey design. It could protect the route lookup behind address proof, but changes the login
flow for SSO users and requires explicit behavior for delivery, recovery, abuse controls, and
uniform pre-proof responses. Those requirements and acceptance cases are not specified here.

**Publish a provider picker or customer/connection inventory.** Rejected because it exposes
more information than the domain-specific routing decision requires and violates the portal's
no-list boundary.

## Related

- [Identity provisioning, IP-9, IP-27 and IP-29](../../03-features/identity-provisioning.md)
- [Customer portal](../../03-features/customer-portal.md)
- [Security model](../security-model.md)
- [ADR 0003 — better-auth primary](0003-better-auth-primary.md)
- [ADR 0004 — two portals, two origins](0004-two-portals-two-origins.md)
