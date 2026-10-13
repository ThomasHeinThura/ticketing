import { describe, expect, it } from "vitest";
import {
  canCutOverMemberships,
  classifyLegacyMemberships,
  type LegacyMembershipRow,
  type ScimMembershipEvidence,
  validateOwnerApprovedReconciliation,
} from "../../../apps/api/src/identity/membership-provenance-preflight";

const row: LegacyMembershipRow = {
  id: "membership-1",
  personId: "person-1",
  scope: "workspace",
  scopeId: "workspace-1",
  roleId: "role-1",
  seesAll: false,
  derivedFrom: "scim-member-1",
};

const source: ScimMembershipEvidence = {
  memberId: "scim-member-1",
  membershipId: "membership-1",
  grantId: "grant-1",
  externalIdentityId: "external-1",
  personId: "person-1",
  connectionId: "connection-1",
  mappingId: "mapping-1",
  scope: "workspace",
  scopeId: "workspace-1",
  roleId: "role-1",
  active: true,
};

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (!item) throw new Error("expected one preflight row");
  return item;
}

describe("ADR-0015 legacy membership preflight", () => {
  it("classifies only an exact active SCIM membership source chain", () => {
    const result = first(classifyLegacyMemberships([row], [source]));
    expect(result.classification).toEqual({
      sourceKind: "scim_group",
      externalIdentityId: "external-1",
      identityConnectionId: "connection-1",
      scimGroupMappingId: "mapping-1",
      membershipGrantId: "grant-1",
    });
    expect(result.rowDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(canCutOverMemberships([result])).toBe(true);
  });

  it("does not infer a direct grant from a null derived_from value", () => {
    const result = first(
      classifyLegacyMemberships([{ ...row, derivedFrom: null }], []),
    );
    expect(result.classification).toEqual({
      sourceKind: "unresolved",
      reason: "missing_durable_source_link",
    });
    expect(canCutOverMemberships([result])).toBe(false);
  });

  it.each([
    { evidence: [{ ...source, membershipId: "other-membership" }] },
    { evidence: [{ ...source, personId: "other-person" }] },
    { evidence: [{ ...source, roleId: "other-role" }] },
    { evidence: [{ ...source, active: false }] },
    { evidence: [{ ...source }, { ...source, grantId: "grant-2" }] },
  ])(
    "blocks an inconsistent or ambiguous SCIM source chain",
    ({ evidence }) => {
      const result = first(classifyLegacyMemberships([row], evidence));
      expect(result.classification.sourceKind).toBe("unresolved");
      expect(canCutOverMemberships([result])).toBe(false);
    },
  );

  it("binds the digest to every legacy membership source-relevant field", () => {
    const original = first(classifyLegacyMemberships([row], [source]));
    const changed = first(
      classifyLegacyMemberships([{ ...row, roleId: "role-2" }], [source]),
    );
    expect(changed.rowDigest).not.toBe(original.rowDigest);
  });

  it("validates a complete digest-bound owner decision with exact grant shape", () => {
    const inventory = classifyLegacyMemberships(
      [{ ...row, derivedFrom: null }],
      [],
    );
    const result = validateOwnerApprovedReconciliation(inventory, {
      format: "taskdesk-membership-provenance-reconciliation/v1",
      approval: {
        approverPersonId: "admin-person",
        approvalReference: "change-record-42",
      },
      decisions: [
        {
          membershipId: row.id,
          rowDigest: first(inventory).rowDigest,
          evidenceReferences: ["owner-record:membership-1"],
          rationale: "The recorded owner authorization granted this role.",
          grants: [
            {
              sourceKind: "direct",
              roleId: row.roleId,
              scope: row.scope,
              scopeId: row.scopeId,
              seesAll: false,
              directOrigin: "admin",
              grantedByPersonId: "grantor-person",
            },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing, duplicate and stale per-row reconciliation decisions", () => {
    const inventory = classifyLegacyMemberships(
      [{ ...row, derivedFrom: null }],
      [],
    );
    const base = {
      format: "taskdesk-membership-provenance-reconciliation/v1" as const,
      approval: {
        approverPersonId: "admin-person",
        approvalReference: "change-record-42",
      },
      decisions: [
        {
          membershipId: row.id,
          rowDigest: first(inventory).rowDigest,
          evidenceReferences: ["owner-record:membership-1"],
          rationale: "The recorded owner authorization granted this role.",
          grants: [
            {
              sourceKind: "direct" as const,
              roleId: row.roleId,
              scope: row.scope,
              scopeId: row.scopeId,
              seesAll: false,
              directOrigin: "admin" as const,
              grantedByPersonId: "grantor-person",
            },
          ],
        },
      ],
    };
    expect(
      validateOwnerApprovedReconciliation(inventory, {
        ...base,
        decisions: [],
      }),
    ).toEqual({ ok: false, reason: "missing_decision" });
    expect(
      validateOwnerApprovedReconciliation(inventory, {
        ...base,
        decisions: [first(base.decisions), first(base.decisions)],
      }),
    ).toEqual({ ok: false, reason: "duplicate_decision" });
    expect(
      validateOwnerApprovedReconciliation(inventory, {
        ...base,
        decisions: [{ ...first(base.decisions), rowDigest: "0".repeat(64) }],
      }),
    ).toEqual({ ok: false, reason: "stale_digest" });
  });

  it("rejects source-shaped guesses from owner records", () => {
    const inventory = classifyLegacyMemberships(
      [{ ...row, derivedFrom: null }],
      [],
    );
    const result = validateOwnerApprovedReconciliation(inventory, {
      format: "taskdesk-membership-provenance-reconciliation/v1",
      approval: {
        approverPersonId: "admin-person",
        approvalReference: "change-record-42",
      },
      decisions: [
        {
          membershipId: row.id,
          rowDigest: first(inventory).rowDigest,
          evidenceReferences: ["owner-record:membership-1"],
          rationale: "The recorded owner authorization granted this role.",
          grants: [
            {
              sourceKind: "jit_default",
              roleId: row.roleId,
              scope: row.scope,
              scopeId: row.scopeId,
              seesAll: false,
            },
          ],
        },
      ],
    });
    expect(result).toEqual({ ok: false, reason: "invalid_grant_shape" });
  });

  it("rejects malformed JSON and unknown fields instead of throwing or accepting them", () => {
    const inventory = classifyLegacyMemberships(
      [{ ...row, derivedFrom: null }],
      [],
    );
    expect(validateOwnerApprovedReconciliation(inventory, null)).toEqual({
      ok: false,
      reason: "invalid_manifest",
    });
    expect(
      validateOwnerApprovedReconciliation(inventory, {
        format: "taskdesk-membership-provenance-reconciliation/v1",
        approval: {
          approverPersonId: "admin-person",
          approvalReference: "change-record-42",
        },
        decisions: [],
        arbitrary: "must be rejected",
      }),
    ).toEqual({ ok: false, reason: "invalid_manifest" });
  });
});
