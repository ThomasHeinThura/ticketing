/** Explicit per-person access for the clean-install demo. */
export const UAT_SECOND_CONTOSO_PROJECT_ID = "uat-proj-contoso-managed";
export const UAT_SECOND_CONTOSO_ORGANISATION = "contoso";

export function customerProjectSeedPlan(input: {
  accounts: readonly {
    key: string;
    personId: string;
    side: string;
    org: string;
  }[];
  supportProjectId: string;
  secondContosoProjectId: string;
  fabrikamProjectId: string;
}) {
  const definitions = [
    {
      account: "contoso1",
      organisation: "contoso",
      projectId: input.supportProjectId,
    },
    {
      account: "contoso3",
      organisation: "contoso",
      projectId: input.supportProjectId,
    },
    {
      account: "contoso2",
      organisation: "contoso",
      projectId: input.secondContosoProjectId,
    },
    {
      account: "contoso3",
      organisation: "contoso",
      projectId: input.secondContosoProjectId,
    },
    {
      account: "fabrikam1",
      organisation: "fabrikam",
      projectId: input.fabrikamProjectId,
    },
  ] as const;
  return definitions.map(({ account, organisation, projectId }) => {
    const person = input.accounts.find((row) => row.key === account);
    if (person?.side !== "customer" || person.org !== organisation)
      throw new Error(`Invalid UAT customer ${account}`);
    return { personId: person.personId, projectId };
  });
}
