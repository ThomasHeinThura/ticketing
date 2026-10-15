import {
  findPersonSide,
  findWorkspaceMemberRole,
} from "./customer-principal.repository";

/**
 * A caller whose workspace role is `customer`, or whose person is customer-side. Customers
 * are portal-only (`rbac.md` § "The customer role is special"); the permission matrix
 * declares `403 forbidden` for them on every item-scoped agent route even inside reach.
 */
export async function isCustomerPrincipal(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const membership = await findWorkspaceMemberRole(userId, workspaceId);
  if (membership?.role === "customer") return true;
  const person = await findPersonSide(userId);
  return person?.side === "customer";
}

/** Whether the caller's person is customer-side (portal identities), independent of workspace. */
export async function isCustomerSidePerson(userId: string): Promise<boolean> {
  const person = await findPersonSide(userId);
  return person?.side === "customer";
}
