import { createHash } from "node:crypto";

export type LegacyMembershipRow = {
  readonly id: string;
  readonly personId: string;
  readonly scope: string;
  readonly scopeId: string;
  readonly roleId: string;
  readonly seesAll: boolean;
  readonly derivedFrom: string | null;
};

export type ScimMembershipEvidence = {
  readonly memberId: string;
  readonly membershipId: string | null;
  readonly grantId: string;
  readonly externalIdentityId: string;
  readonly personId: string;
  readonly connectionId: string;
  readonly mappingId: string;
  readonly scope: string;
  readonly scopeId: string;
  readonly roleId: string;
  readonly active: boolean;
};

export type MembershipPreflightRow = {
  readonly membershipId: string;
  readonly personId: string;
  readonly scope: string;
  readonly scopeId: string;
  readonly roleId: string;
  readonly seesAll: boolean;
  readonly rowDigest: string;
  readonly classification:
    | {
        readonly sourceKind: "scim_group";
        readonly externalIdentityId: string;
        readonly identityConnectionId: string;
        readonly scimGroupMappingId: string;
        readonly membershipGrantId: string;
      }
    | { readonly sourceKind: "unresolved"; readonly reason: string };
};

export type OwnerApprovedGrantRecord = {
  readonly sourceKind: "direct" | "jit_default" | "oidc_group" | "scim_group";
  readonly roleId: string;
  readonly scope: string;
  readonly scopeId: string;
  readonly seesAll: boolean;
  readonly directOrigin?: "admin";
  readonly grantedByPersonId?: string;
  readonly externalIdentityId?: string;
  readonly identityConnectionId?: string;
  readonly oidcGroupMappingId?: string;
  readonly scimGroupMappingId?: string;
};

export type OwnerApprovedMembershipDecision = {
  readonly membershipId: string;
  readonly rowDigest: string;
  readonly evidenceReferences: readonly string[];
  readonly rationale: string;
  readonly grants: readonly OwnerApprovedGrantRecord[];
};

export type OwnerApprovedReconciliation = {
  readonly format: "taskdesk-membership-provenance-reconciliation/v1";
  readonly approval: {
    readonly approverPersonId: string;
    readonly approvalReference: string;
  };
  readonly decisions: readonly OwnerApprovedMembershipDecision[];
};

export type ValidatedGrantRecord = OwnerApprovedGrantRecord & {
  readonly membershipId: string;
  readonly rowDigest: string;
};

export type ReconciliationValidation =
  | { readonly ok: true; readonly grants: readonly ValidatedGrantRecord[] }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_manifest"
        | "missing_decision"
        | "duplicate_decision"
        | "stale_digest"
        | "invalid_grant_shape";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const allow = new Set(allowed);
  return Object.keys(value).every((key) => allow.has(key));
}

function stableRowDigest(row: LegacyMembershipRow): string {
  const canonical = JSON.stringify([
    row.id,
    row.personId,
    row.scope,
    row.scopeId,
    row.roleId,
    row.seesAll,
    row.derivedFrom,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * A read-only legacy source classifier. Only an exact, internally consistent
 * `derived_from -> scim_group_member` chain is self-proving. Every other row
 * remains unresolved for owner-approved per-row reconciliation; in particular,
 * a null `derived_from` never implies a direct grant.
 */
export function classifyLegacyMemberships(
  memberships: readonly LegacyMembershipRow[],
  scimEvidence: readonly ScimMembershipEvidence[],
): MembershipPreflightRow[] {
  const evidenceByMemberId = new Map<string, ScimMembershipEvidence[]>();
  for (const evidence of scimEvidence) {
    const matches = evidenceByMemberId.get(evidence.memberId) ?? [];
    matches.push(evidence);
    evidenceByMemberId.set(evidence.memberId, matches);
  }

  return [...memberships]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((membership) => {
      const rowDigest = stableRowDigest(membership);
      if (membership.derivedFrom === null) {
        return {
          membershipId: membership.id,
          personId: membership.personId,
          scope: membership.scope,
          scopeId: membership.scopeId,
          roleId: membership.roleId,
          seesAll: membership.seesAll,
          rowDigest,
          classification: {
            sourceKind: "unresolved",
            reason: "missing_durable_source_link",
          },
        };
      }
      const candidates = evidenceByMemberId.get(membership.derivedFrom) ?? [];
      if (candidates.length !== 1) {
        return {
          membershipId: membership.id,
          personId: membership.personId,
          scope: membership.scope,
          scopeId: membership.scopeId,
          roleId: membership.roleId,
          seesAll: membership.seesAll,
          rowDigest,
          classification: {
            sourceKind: "unresolved",
            reason:
              candidates.length === 0
                ? "source_link_not_found"
                : "source_link_ambiguous",
          },
        };
      }
      const source = candidates[0];
      if (!source) {
        throw new Error(
          "Membership source candidate disappeared during classification",
        );
      }
      if (
        source.membershipId !== membership.id ||
        source.personId !== membership.personId ||
        source.scope !== membership.scope ||
        source.scopeId !== membership.scopeId ||
        source.roleId !== membership.roleId ||
        source.active !== true ||
        membership.seesAll
      ) {
        return {
          membershipId: membership.id,
          personId: membership.personId,
          scope: membership.scope,
          scopeId: membership.scopeId,
          roleId: membership.roleId,
          seesAll: membership.seesAll,
          rowDigest,
          classification: {
            sourceKind: "unresolved",
            reason: "source_chain_mismatch_or_ineligible",
          },
        };
      }
      return {
        membershipId: membership.id,
        personId: membership.personId,
        scope: membership.scope,
        scopeId: membership.scopeId,
        roleId: membership.roleId,
        seesAll: membership.seesAll,
        rowDigest,
        classification: {
          sourceKind: "scim_group",
          externalIdentityId: source.externalIdentityId,
          identityConnectionId: source.connectionId,
          scimGroupMappingId: source.mappingId,
          membershipGrantId: source.grantId,
        },
      };
    });
}

export function canCutOverMemberships(rows: readonly MembershipPreflightRow[]) {
  return rows.every((row) => row.classification.sourceKind !== "unresolved");
}

/**
 * Validates the owner-supplied per-row decisions against the fresh inventory. This
 * validates completeness, exact row digests and the database discriminator shape; the
 * migration runner must separately verify the approver is a current instance admin and
 * validate every referenced source record under the cut-over locks.
 */
export function validateOwnerApprovedReconciliation(
  inventory: readonly MembershipPreflightRow[],
  input: unknown,
): ReconciliationValidation {
  if (
    !isRecord(input) ||
    !hasOnlyKeys(input, ["format", "approval", "decisions"]) ||
    !isRecord(input.approval) ||
    !hasOnlyKeys(input.approval, ["approverPersonId", "approvalReference"]) ||
    !Array.isArray(input.decisions) ||
    input.decisions.some(
      (decision) =>
        !isRecord(decision) ||
        !hasOnlyKeys(decision, [
          "membershipId",
          "rowDigest",
          "evidenceReferences",
          "rationale",
          "grants",
        ]) ||
        typeof decision.membershipId !== "string" ||
        typeof decision.rowDigest !== "string" ||
        typeof decision.rationale !== "string" ||
        !decision.rationale.trim() ||
        !Array.isArray(decision.evidenceReferences) ||
        decision.evidenceReferences.length === 0 ||
        decision.evidenceReferences.some(
          (reference) => typeof reference !== "string" || !reference.trim(),
        ) ||
        !Array.isArray(decision.grants) ||
        decision.grants.some(
          (grant) =>
            !isRecord(grant) ||
            !hasOnlyKeys(grant, [
              "sourceKind",
              "roleId",
              "scope",
              "scopeId",
              "seesAll",
              "directOrigin",
              "grantedByPersonId",
              "externalIdentityId",
              "identityConnectionId",
              "oidcGroupMappingId",
              "scimGroupMappingId",
            ]) ||
            typeof grant.sourceKind !== "string" ||
            typeof grant.roleId !== "string" ||
            typeof grant.scope !== "string" ||
            typeof grant.scopeId !== "string" ||
            typeof grant.seesAll !== "boolean",
        ),
    )
  ) {
    return { ok: false, reason: "invalid_manifest" };
  }
  const reconciliation = input as unknown as OwnerApprovedReconciliation;
  if (
    reconciliation.format !==
      "taskdesk-membership-provenance-reconciliation/v1" ||
    !reconciliation.approval.approverPersonId.trim() ||
    !reconciliation.approval.approvalReference.trim()
  ) {
    return { ok: false, reason: "invalid_manifest" };
  }

  const unresolved = inventory.filter(
    (row) => row.classification.sourceKind === "unresolved",
  );
  const expected = new Map(unresolved.map((row) => [row.membershipId, row]));
  const seen = new Set<string>();
  const grants: ValidatedGrantRecord[] = [];
  for (const decision of reconciliation.decisions) {
    if (seen.has(decision.membershipId))
      return { ok: false, reason: "duplicate_decision" };
    seen.add(decision.membershipId);
    const row = expected.get(decision.membershipId);
    if (!row) return { ok: false, reason: "invalid_manifest" };
    if (decision.rowDigest !== row.rowDigest)
      return { ok: false, reason: "stale_digest" };
    if (decision.grants.length === 0)
      return { ok: false, reason: "invalid_grant_shape" };
    const uniqueSources = new Set<string>();
    for (const grant of decision.grants) {
      if (
        grant.scope.trim().length === 0 ||
        grant.scopeId.trim().length === 0 ||
        grant.scope !== row.scope ||
        grant.scopeId !== row.scopeId ||
        grant.roleId.trim().length === 0 ||
        typeof grant.seesAll !== "boolean"
      ) {
        return { ok: false, reason: "invalid_grant_shape" };
      }
      const sourceKey = [
        grant.sourceKind,
        grant.externalIdentityId ?? "",
        grant.identityConnectionId ?? "",
        grant.oidcGroupMappingId ?? "",
        grant.scimGroupMappingId ?? "",
        grant.scope,
        grant.scopeId,
      ].join("\u0000");
      if (uniqueSources.has(sourceKey))
        return { ok: false, reason: "invalid_grant_shape" };
      uniqueSources.add(sourceKey);
      const directShape =
        grant.sourceKind === "direct" &&
        grant.directOrigin === "admin" &&
        typeof grant.grantedByPersonId === "string" &&
        grant.grantedByPersonId.length > 0 &&
        grant.externalIdentityId === undefined &&
        grant.identityConnectionId === undefined &&
        grant.oidcGroupMappingId === undefined &&
        grant.scimGroupMappingId === undefined;
      const jitShape =
        grant.sourceKind === "jit_default" &&
        grant.directOrigin === undefined &&
        grant.grantedByPersonId === undefined &&
        typeof grant.externalIdentityId === "string" &&
        grant.externalIdentityId.length > 0 &&
        typeof grant.identityConnectionId === "string" &&
        grant.identityConnectionId.length > 0 &&
        grant.oidcGroupMappingId === undefined &&
        grant.scimGroupMappingId === undefined &&
        !grant.seesAll;
      const oidcShape =
        grant.sourceKind === "oidc_group" &&
        grant.directOrigin === undefined &&
        grant.grantedByPersonId === undefined &&
        typeof grant.externalIdentityId === "string" &&
        grant.externalIdentityId.length > 0 &&
        typeof grant.identityConnectionId === "string" &&
        grant.identityConnectionId.length > 0 &&
        typeof grant.oidcGroupMappingId === "string" &&
        grant.oidcGroupMappingId.length > 0 &&
        grant.scimGroupMappingId === undefined &&
        !grant.seesAll;
      const scimShape =
        grant.sourceKind === "scim_group" &&
        grant.directOrigin === undefined &&
        grant.grantedByPersonId === undefined &&
        typeof grant.externalIdentityId === "string" &&
        grant.externalIdentityId.length > 0 &&
        typeof grant.identityConnectionId === "string" &&
        grant.identityConnectionId.length > 0 &&
        grant.oidcGroupMappingId === undefined &&
        typeof grant.scimGroupMappingId === "string" &&
        grant.scimGroupMappingId.length > 0 &&
        !grant.seesAll;
      if (!(directShape || jitShape || oidcShape || scimShape))
        return { ok: false, reason: "invalid_grant_shape" };
      grants.push({
        ...grant,
        membershipId: decision.membershipId,
        rowDigest: decision.rowDigest,
      });
    }
  }
  if (seen.size !== expected.size)
    return { ok: false, reason: "missing_decision" };
  return { ok: true, grants };
}
