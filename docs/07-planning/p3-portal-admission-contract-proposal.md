# P3 portal admission adapter contract proposal

**Status:** Proposal only; not an accepted product contract. The P3 implementation must
keep customer identity creation and invitation acceptance closed until this is decided and
specified in the owning feature contracts.

## Gap

`customer-portal.md` CP-11/CP-12 require invitation into a customer organisation and
acceptance through a customer-scoped provider. The existing Better Auth invitation path is
workspace-scoped and cannot safely express the organisation, customer role, person-side
identity, portal scope, or organisation-bound identity connection required by CP-11/CP-17.
The canonical organisation invitation fields exist in the model, but the API adapter and
acceptance transaction are not defined. Reusing the legacy endpoint would guess at authority
and could grant the wrong membership.

The documented `instance_plugin_config` table, `portal_scope` values, host-specific local
provider selection, and paired auth-instance reload/poll are implemented in the P3 branch.
Customer sign-in remains closed when there is no enabled customer-scoped row; local auth
does not permit public account creation. What remains absent is the documented God Mode
write/test adapter for these rows and its transaction/audit contract. CP-18/IP-29 define
what typed-domain discovery may disclose, but do not define a dedicated email-first
discovery route and response schema. The customer sign-in page therefore remains a closed
notice until a reviewed discovery/admission flow can use the stored provider configuration.

## Proposed contract decisions for the owning spec

1. Staff creates an invitation only for an active customer organisation and an email address;
   the server fixes the role to the built-in organisation `customer` role. The caller cannot
   submit a role, side, scope, organisation, or provider choice in the acceptance request.
2. Store only a hash of a high-entropy, single-use token. Bind it to the normalized recipient
   email, organisation, inviter, expiry, and pending state. The raw token is returned only in
   the invitation delivery link. Do not disclose whether an email already has a customer
   identity in public responses.
3. Acceptance validates the token, recipient email verification, organisation state and
   portal access, then atomically creates or binds the customer person, organisation
   membership, role, and accepted invitation state. Enforce one organisation per customer
   person. Never convert an agent person, attach an agent account, or grant admin.
4. A local password/OTP/magic-link provider may complete acceptance only when that provider
   is enabled for customer scope. An organisation-bound OIDC connection may complete it only
   when its persisted organisation and customer portal bindings match. No provider inventory
   endpoint is added; typed-domain SSO disclosure follows CP-18/IP-29.
5. Expiry, cancellation, duplicate acceptance, identity conflict, and concurrent acceptance
   return constant-shape failure responses. Invitation creation, cancellation, delivery
   outcome, and acceptance use the existing documented audit/event vocabulary; the owning
   docs must name the precise event keys and audit actions before implementation.
6. Define narrowly scoped route-policy entries for create/list/cancel and public
   validate/accept operations, plus rate limits, CSRF rules, resend behavior, and transaction
   boundaries. SCIM provisioning remains its separately specified IP-22/IP-27 path and is
   not an invitation bypass.
7. Specify the write/test DTOs, permission policy, secret handling, transaction and audit
   behavior for the documented `/api/instance/plugins` route family before implementing a
   God Mode adapter. The per-portal storage and runtime reader are implemented in the P3
   branch; no writer route or inferred request fields are added. Separately define the
   email-first domain-discovery request, response, rate limit, and non-enumerating failure
   behavior that implements CP-18/IP-29 without returning a provider inventory.

## Required resolution

The product owner must either accept and incorporate these decisions into CP-11/CP-12 and the
identity/event/policy contracts, or replace them with an equally precise alternative. Until
then, invitation acceptance and public customer registration remain unavailable. An already
admitted customer can sign in only when an enabled customer-scoped provider row is stored;
an agent-only provider cannot authenticate the portal. The email-first UI remains closed
until its discovery contract is written. The per-portal config reader follows its existing
contract; a God Mode writer and usable admission/discovery flow require the owning specs to
resolve these remaining questions.
