import { BUILT_IN_ROLES } from "@taskdesk/permissions";

export type CustomerOrganisationMembershipFact = {
  scope: string;
  scopeId: string;
  seesAll: boolean;
  roleId: string;
  roleKey: string;
  roleScope: string;
  roleWorkspaceId: string | null;
  roleIsSystem: boolean;
  scopeExists: boolean;
  rank: number;
  capabilities: unknown;
};

/**
 * The persisted row proves customer admission; the compiled built-in remains the grant.
 * Customer-side people have exactly one organisation membership, for their own
 * organisation, backed by the genuine built-in customer role. Other membership scopes
 * are deliberately ignored by customer identity construction.
 */
export function hasCanonicalCustomerMembership(
  organisationId: string,
  rows: readonly CustomerOrganisationMembershipFact[],
): boolean {
  const organisationRows = rows.filter((row) => row.scope === "organisation");
  if (organisationRows.length !== 1) return false;
  const [row] = organisationRows;
  return (
    row !== undefined &&
    row.scopeId === organisationId &&
    row.scopeExists &&
    !row.seesAll &&
    row.roleId.length > 0 &&
    row.roleKey === BUILT_IN_ROLES.customer.key &&
    row.roleScope === BUILT_IN_ROLES.customer.scope &&
    row.roleWorkspaceId === null &&
    row.roleIsSystem &&
    row.rank === BUILT_IN_ROLES.customer.rank &&
    Array.isArray(row.capabilities) &&
    row.capabilities.length === BUILT_IN_ROLES.customer.capabilities.length &&
    row.capabilities.every(
      (capability, index) =>
        typeof capability === "string" &&
        capability === BUILT_IN_ROLES.customer.capabilities[index],
    )
  );
}
