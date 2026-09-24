export type CustomerPortalPerson = {
  personId: string;
  organisationId: string;
};

export type CustomerPortalResource = {
  organisationId: string;
  customerVisibility: "private" | "organisation";
  requesterPersonId: string;
  participantPersonIds: readonly string[];
};

export function canReachCustomerPortalResource(
  person: CustomerPortalPerson,
  resource: CustomerPortalResource,
): boolean {
  if (person.organisationId !== resource.organisationId) return false;
  if (resource.customerVisibility === "organisation") return true;
  return (
    person.personId === resource.requesterPersonId ||
    resource.participantPersonIds.includes(person.personId)
  );
}
