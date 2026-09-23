import type {
  AllowedRole,
  ConnectionValidationResult,
  IdentityClaimResult,
  IdentityConnectionDraft,
  IdentityPortalScope,
  IdentityRoleMapping,
  ProvisioningDecision,
  ProvisioningEvent,
  ProvisioningState,
  ScimConflictClass,
  ScimConflictResponse,
  ScimPatchOperation,
  ScimPersonAttributes,
  ScimResult,
  VerifiedEntraClaims,
} from "./types.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const address = value.trim().toLowerCase();
  return EMAIL_PATTERN.test(address) ? address : undefined;
}

function isGroupOverage(claims: VerifiedEntraClaims): boolean {
  return (
    isRecord(claims._claim_names) &&
    typeof claims._claim_names.groups === "string"
  );
}

function hasInvalidGroupOverageMarker(claims: VerifiedEntraClaims): boolean {
  return (
    isRecord(claims._claim_names) &&
    claims._claim_names.groups !== undefined &&
    typeof claims._claim_names.groups !== "string"
  );
}

export function normaliseEntraClaims(
  claims: VerifiedEntraClaims,
  connection: Pick<IdentityConnectionDraft, "tenantId" | "issuer">,
): IdentityClaimResult {
  if (claims.tid !== connection.tenantId)
    return { ok: false, reason: "tenant_mismatch" };
  if (claims.iss !== connection.issuer)
    return { ok: false, reason: "issuer_mismatch" };
  if (typeof claims.oid !== "string" || claims.oid.length === 0) {
    return { ok: false, reason: "invalid_subject" };
  }

  const addressCandidates = [
    ["email", claims.email],
    ["preferred_username", claims.preferred_username],
    ["upn", claims.upn],
  ] as const;
  let address: string | undefined;
  let addressUsed: "email" | "preferred_username" | "upn" | undefined;
  for (const [claimName, value] of addressCandidates) {
    address = normaliseEmail(value);
    if (address !== undefined) {
      addressUsed = claimName;
      break;
    }
  }
  if (address === undefined || addressUsed === undefined) {
    return { ok: false, reason: "no_usable_address" };
  }
  if (claims.email_verified !== undefined && claims.email_verified !== true) {
    return { ok: false, reason: "unverified_address" };
  }

  let groupObjectIds: readonly string[] | "overage" = [];
  if (hasInvalidGroupOverageMarker(claims)) {
    return { ok: false, reason: "invalid_groups" };
  }
  if (isGroupOverage(claims)) {
    groupObjectIds = "overage";
  } else if (
    Array.isArray(claims.groups) &&
    claims.groups.every((group) => typeof group === "string")
  ) {
    groupObjectIds = [...new Set(claims.groups)];
  } else if (claims.groups !== undefined) {
    return { ok: false, reason: "invalid_groups" };
  }

  return {
    ok: true,
    identity: {
      subject: { oid: claims.oid, tid: claims.tid },
      address,
      addressUsed,
      groupObjectIds,
    },
  };
}

export function validateIdentityConnection(
  draft: IdentityConnectionDraft,
): ConnectionValidationResult {
  const errors = [] as Array<
    | "customer_requires_organisation"
    | "agent_cannot_have_organisation"
    | "invalid_tenant_id"
    | "invalid_role_rank"
    | "tenant_issuer_required"
    | "multi_tenant_issuer_forbidden"
    | "default_role_exceeds_maximum"
    | "customer_role_required"
    | "staff_role_required"
  >;
  if (draft.portalScope === "customer" && !draft.organisationId)
    errors.push("customer_requires_organisation");
  if (draft.portalScope === "agent" && draft.organisationId !== null)
    errors.push("agent_cannot_have_organisation");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      draft.tenantId,
    )
  )
    errors.push("invalid_tenant_id");
  if (
    (draft.portalScope === "agent" &&
      (!Number.isSafeInteger(draft.maxRoleRank) ||
        (draft.maxRoleRank ?? -1) < 0)) ||
    (draft.portalScope === "customer" && draft.maxRoleRank !== null) ||
    !Number.isSafeInteger(draft.defaultRoleRank) ||
    draft.defaultRoleRank < 0
  )
    errors.push("invalid_role_rank");
  const expectedIssuer = `https://login.microsoftonline.com/${draft.tenantId}/v2.0`;
  if (!draft.issuer) errors.push("tenant_issuer_required");
  if (
    draft.issuer.includes("{tenantid}") ||
    /\/(common|organizations)(\/|$)/iu.test(draft.issuer)
  ) {
    errors.push("multi_tenant_issuer_forbidden");
  } else if (draft.issuer !== expectedIssuer) {
    errors.push("tenant_issuer_required");
  }
  if (
    draft.portalScope === "agent" &&
    draft.maxRoleRank !== null &&
    draft.defaultRoleRank > draft.maxRoleRank
  )
    errors.push("default_role_exceeds_maximum");
  if (draft.portalScope === "customer" && !draft.defaultRoleIsCustomer)
    errors.push("customer_role_required");
  if (draft.portalScope === "agent" && draft.defaultRoleIsCustomer)
    errors.push("staff_role_required");
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, connection: draft };
}

const FORBIDDEN_SCIM_KEYS = new Set([
  "organisation",
  "organisationid",
  "organization",
  "organizationid",
  "workspace",
  "workspaceid",
  "portal",
  "portalscope",
  "role",
  "roleid",
  "capability",
  "capabilities",
  "reach",
  "seesall",
  "isadmin",
  "isstaff",
  "iscustomer",
]);

function isForbiddenScimKey(key: string): boolean {
  const compactKey = key.replace(/[_.-]/gu, "").toLowerCase();
  return FORBIDDEN_SCIM_KEYS.has(compactKey);
}

function hasForbiddenScimAttribute(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenScimAttribute);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      isForbiddenScimKey(key) || hasForbiddenScimAttribute(nested),
  );
}

function readActive(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "True") return true;
  if (value === "False") return false;
  return undefined;
}

export function parseScimUser(
  input: unknown,
): ScimResult<ScimPersonAttributes> {
  if (!isRecord(input) || hasForbiddenScimAttribute(input))
    return { ok: false, reason: "forbidden_attribute" };
  const allowed = new Set([
    "schemas",
    "externalId",
    "userName",
    "name",
    "active",
    "title",
    "preferredLanguage",
    "emails",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    return { ok: false, reason: "invalid_resource" };
  if (
    input.schemas !== undefined &&
    (!Array.isArray(input.schemas) ||
      input.schemas.some(
        (schema) =>
          schema !== "urn:ietf:params:scim:schemas:core:2.0:User" &&
          schema !==
            "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
      ))
  )
    return { ok: false, reason: "invalid_resource" };
  const result: ScimPersonAttributes = {};
  if (input.externalId !== undefined) {
    if (typeof input.externalId !== "string")
      return { ok: false, reason: "invalid_resource" };
    result.externalId = input.externalId;
  }
  if (input.userName !== undefined) {
    if (typeof input.userName !== "string")
      return { ok: false, reason: "invalid_resource" };
    result.userName = input.userName;
  }
  if (input.active !== undefined) {
    const active = readActive(input.active);
    if (active === undefined) return { ok: false, reason: "invalid_resource" };
    result.active = active;
  }
  if (input.title !== undefined) {
    if (typeof input.title !== "string")
      return { ok: false, reason: "invalid_resource" };
    result.title = input.title;
  }
  if (input.preferredLanguage !== undefined) {
    if (typeof input.preferredLanguage !== "string")
      return { ok: false, reason: "invalid_resource" };
    result.preferredLanguage = input.preferredLanguage;
  }
  if (input.name !== undefined) {
    if (!isRecord(input.name)) return { ok: false, reason: "invalid_resource" };
    if (
      Object.keys(input.name).some(
        (key) => !["givenName", "familyName", "formatted"].includes(key),
      )
    )
      return { ok: false, reason: "invalid_resource" };
    const name: NonNullable<ScimPersonAttributes["name"]> = {};
    for (const key of ["givenName", "familyName", "formatted"] as const) {
      const value = input.name[key];
      if (value !== undefined && typeof value !== "string")
        return { ok: false, reason: "invalid_resource" };
      if (typeof value === "string") name[key] = value;
    }
    result.name = name;
  }
  if (input.emails !== undefined) {
    if (!Array.isArray(input.emails))
      return { ok: false, reason: "invalid_resource" };
    if (
      input.emails.some(
        (email) =>
          !isRecord(email) ||
          Object.keys(email).some(
            (key) => !["value", "type", "primary", "display"].includes(key),
          ) ||
          (email.primary !== undefined && typeof email.primary !== "boolean") ||
          (email.value !== undefined && typeof email.value !== "string"),
      )
    )
      return { ok: false, reason: "invalid_resource" };
    const primaryEmail = input.emails.find(
      (email) => isRecord(email) && email.primary === true,
    );
    const selectedEmail = primaryEmail ?? input.emails[0];
    if (selectedEmail !== undefined) {
      if (!isRecord(selectedEmail) || typeof selectedEmail.value !== "string")
        return { ok: false, reason: "invalid_resource" };
      result.email = selectedEmail.value;
    }
  }
  return { ok: true, value: result };
}

export function scimConflictResponse(
  _conflictClass: ScimConflictClass,
): ScimConflictResponse {
  return {
    status: 409,
    scimType: "uniqueness",
    detail: "A matching identity already exists.",
  };
}

function normalisePatchOp(
  value: unknown,
): "add" | "replace" | "remove" | undefined {
  if (typeof value !== "string") return undefined;
  const op = value.toLowerCase();
  return op === "add" || op === "replace" || op === "remove" ? op : undefined;
}

export function applyScimPatchOps(
  current: ScimPersonAttributes,
  operations: readonly ScimPatchOperation[],
): ScimResult<ScimPersonAttributes> {
  const next: ScimPersonAttributes = {
    ...current,
    name: current.name ? { ...current.name } : undefined,
  };
  for (const operation of operations) {
    const op = normalisePatchOp(operation.op);
    if (op === undefined) return { ok: false, reason: "invalid_patch" };
    const path = operation.path?.replace(/^\s*|\s*$/gu, "").toLowerCase();
    if (path === undefined || path === "active") {
      if (
        path === undefined &&
        isRecord(operation.value) &&
        hasForbiddenScimAttribute(operation.value)
      ) {
        return { ok: false, reason: "forbidden_attribute" };
      }
      if (path === undefined && isRecord(operation.value)) {
        for (const key of Object.keys(operation.value)) {
          if (isForbiddenScimKey(key))
            return { ok: false, reason: "forbidden_attribute" };
        }
        const parsed = parseScimUser(operation.value);
        if (!parsed.ok) return parsed;
        Object.assign(next, parsed.value);
        continue;
      }
      const active = op === "remove" ? undefined : readActive(operation.value);
      if (op !== "remove" && active === undefined)
        return { ok: false, reason: "invalid_patch" };
      if (active === undefined) delete next.active;
      else next.active = active;
      continue;
    }
    if (isForbiddenScimKey(path))
      return { ok: false, reason: "forbidden_attribute" };
    const allowed = [
      "username",
      "title",
      "preferredlanguage",
      "name.givenname",
      "name.familyname",
      "name.formatted",
    ];
    if (!allowed.includes(path)) return { ok: false, reason: "invalid_patch" };
    if (op === "remove") {
      if (path === "username") delete next.userName;
      else if (path === "title") delete next.title;
      else if (path === "preferredlanguage") delete next.preferredLanguage;
      else if (next.name)
        delete next.name[
          path.slice("name.".length) as "givenName" | "familyName" | "formatted"
        ];
      continue;
    }
    if (typeof operation.value !== "string")
      return { ok: false, reason: "invalid_patch" };
    if (path === "username") next.userName = operation.value;
    else if (path === "title") next.title = operation.value;
    else if (path === "preferredlanguage")
      next.preferredLanguage = operation.value;
    else {
      next.name ??= {};
      next.name[
        path.slice("name.".length) as "givenName" | "familyName" | "formatted"
      ] = operation.value;
    }
  }
  return { ok: true, value: next };
}

export function mapExternalGroupsToRoles(
  externalGroupIds: readonly string[],
  mappings: readonly IdentityRoleMapping[],
  connection: { portalScope: IdentityPortalScope; maxRoleRank: number | null },
): readonly AllowedRole[] {
  const mappingByGroup = new Map(
    mappings.map((mapping) => [mapping.externalGroupId, mapping]),
  );
  const roles = new Map<string, AllowedRole>();
  for (const groupId of new Set(externalGroupIds)) {
    const mapping = mappingByGroup.get(groupId);
    if (
      mapping === undefined ||
      mapping.roleScope !== connection.portalScope ||
      (connection.portalScope === "agent" &&
        (connection.maxRoleRank === null ||
          mapping.roleRank > connection.maxRoleRank)) ||
      mapping.roleIsCustomer !== (connection.portalScope === "customer") ||
      mapping.grantsInstanceAdmin ||
      mapping.grantsSeesAll
    )
      continue;
    roles.set(mapping.roleId, {
      roleId: mapping.roleId,
      roleRank: mapping.roleRank,
      roleScope: mapping.roleScope,
      roleIsCustomer: mapping.roleIsCustomer,
      grantsInstanceAdmin: false,
      grantsSeesAll: false,
    });
  }
  return [...roles.values()];
}

export function decideProvisioningTransition(
  event: ProvisioningEvent,
  current: ProvisioningState,
  membershipPolicy: "end_memberships" | "keep_memberships" = "end_memberships",
): ProvisioningDecision {
  if (event === "deactivate") {
    return current === "active"
      ? {
          kind: "deactivate",
          revokeSessions: true,
          revokeApiKeys: true,
          revokeMcpKeys: true,
          membershipPolicy,
        }
      : { kind: "refuse", reason: "already_deactivated" };
  }
  if (event === "reactivate") {
    return current === "deactivated"
      ? { kind: "reactivate", restoreRoles: false }
      : { kind: "refuse", reason: "not_deactivated" };
  }
  if (event === "claim_local_verified") {
    return current === "placeholder"
      ? { kind: "claim_placeholder", audit: true }
      : { kind: "refuse", reason: "placeholder_required" };
  }
  return current === "placeholder"
    ? { kind: "refuse", reason: "local_verification_required" }
    : { kind: "refuse", reason: "placeholder_required" };
}
