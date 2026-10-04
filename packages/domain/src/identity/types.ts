export type IdentityPortalScope = "agent" | "customer";

export type IdentityConnectionDraft = {
  portalScope: IdentityPortalScope;
  organisationId: string | null;
  tenantId: string;
  issuer: string;
  maxRoleRank: number | null;
  defaultRoleRank: number;
  defaultRoleIsCustomer: boolean;
};

export type VerifiedEntraClaims = {
  iss: string;
  tid: string;
  oid: string;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  upn?: unknown;
  groups?: unknown;
  _claim_names?: unknown;
  _claim_sources?: unknown;
  roles?: unknown;
  acct?: unknown;
};

export type IdentityDomainOwner = {
  domain: string;
  identityConnectionId: string;
};

export type IdentityConnectionContext = Pick<
  IdentityConnectionDraft,
  "tenantId" | "issuer"
> & {
  identityConnectionId: string;
};

export type NormalisedEntraIdentity = {
  subject: { oid: string; tid: string };
  address: string;
  addressUsed: "email" | "preferred_username" | "upn";
  groupObjectIds: readonly string[] | "overage";
  displayName?: string;
};

export type IdentityRejectionReason =
  | "tenant_mismatch"
  | "issuer_mismatch"
  | "invalid_subject"
  | "invalid_groups"
  | "no_usable_address"
  | "unverified_address"
  | "domain_bound_elsewhere"
  | "ambiguous_domain_binding"
  | "invalid_claim_mapping"
  | "invalid_admission_policy"
  | "missing_app_role"
  | "guest_account";

export type IdentityClaimResult =
  | { ok: true; identity: NormalisedEntraIdentity }
  | { ok: false; reason: IdentityRejectionReason };

export type ConnectionValidationError =
  | "customer_requires_organisation"
  | "agent_cannot_have_organisation"
  | "invalid_tenant_id"
  | "invalid_role_rank"
  | "tenant_issuer_required"
  | "multi_tenant_issuer_forbidden"
  | "default_role_exceeds_maximum"
  | "customer_role_required"
  | "staff_role_required";

export type ConnectionValidationResult =
  | { ok: true; connection: IdentityConnectionDraft }
  | { ok: false; errors: readonly ConnectionValidationError[] };

export type ScimPatchOperation = {
  op: string;
  path?: string;
  value: unknown;
};

export type ScimPersonAttributes = {
  externalId?: string;
  userName?: string;
  email?: string;
  active?: boolean;
  displayName?: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  title?: string;
  preferredLanguage?: string;
  locale?: string;
};

export type ScimProfileAttributeMapping = {
  version: 1;
  name: "displayName" | "name.formatted";
  email: "emails.primary.value" | "userName";
  jobTitle: "title" | "unmapped";
  locale: "preferredLanguage" | "locale" | "unmapped";
};

export type ScimProfile = {
  name: string;
  email: string;
  jobTitle?: string;
  locale?: string;
};

export type ScimResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "invalid_resource" | "forbidden_attribute" | "invalid_patch";
    };

export type ScimConflictClass = "same_connection" | "another_connection";

export type ScimConflictResponse = {
  status: 409;
  scimType: "uniqueness";
  detail: "A matching identity already exists.";
};

export type IdentityRoleMapping = {
  externalGroupId: string;
  roleId: string;
  roleRank: number;
  roleScope: IdentityPortalScope;
  roleIsCustomer: boolean;
  grantsInstanceAdmin: boolean;
  grantsSeesAll: boolean;
};

export type AllowedRole = Pick<
  IdentityRoleMapping,
  | "roleId"
  | "roleRank"
  | "roleScope"
  | "roleIsCustomer"
  | "grantsInstanceAdmin"
  | "grantsSeesAll"
>;

export type ProvisioningState = "active" | "deactivated" | "placeholder";
export type ProvisioningEvent =
  | "deactivate"
  | "reactivate"
  | "claim_local_verified"
  | "claim_sso";

export type ProvisioningDecision =
  | {
      kind: "deactivate";
      revokeSessions: true;
      revokeApiKeys: true;
      revokeMcpKeys: true;
      membershipPolicy: "end_memberships" | "keep_memberships";
    }
  | { kind: "reactivate"; restoreRoles: false }
  | { kind: "claim_placeholder"; audit: true }
  | {
      kind: "refuse";
      reason:
        | "already_deactivated"
        | "not_deactivated"
        | "placeholder_required"
        | "local_verification_required";
    };
