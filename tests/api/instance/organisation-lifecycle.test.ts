import { describe, expect, it } from "vitest";
import { buildOrganisationProfileEtag } from "../../../apps/api/src/instance/organisation-lifecycle";

const profile = {
  id: "org-a",
  name: "Customer A",
  key: "customer-a",
  emailDomains: ["example.test", "support.example.test"],
  active: true,
  portalAccess: true,
  defaultCustomerVisibility: "organisation" as const,
  quota: {
    maxProjects: 200,
    maxWorkItems: 500_000,
    maxStorageBytes: 21_474_836_480,
    maxPortalUsers: 500,
    maxApiRequestsPerMinute: 600,
    maxWebhooks: 10,
  },
  projectDefaults: [
    {
      workspaceId: "workspace-b",
      serviceCalendarId: "calendar-b",
      slaPolicyId: null,
    },
    {
      workspaceId: "workspace-a",
      serviceCalendarId: null,
      slaPolicyId: "policy-a",
    },
  ],
};

describe("organisation profile ETag", () => {
  it("uses sorted domain and workspace default sets", () => {
    const reordered = {
      ...profile,
      emailDomains: [...profile.emailDomains].reverse(),
      projectDefaults: [...profile.projectDefaults].reverse(),
    };
    expect(buildOrganisationProfileEtag(reordered)).toBe(
      buildOrganisationProfileEtag(profile),
    );
  });

  it("binds the complete profile to its organisation", () => {
    const initial = buildOrganisationProfileEtag(profile);
    expect(buildOrganisationProfileEtag({ ...profile, id: "org-b" })).not.toBe(
      initial,
    );
    expect(
      buildOrganisationProfileEtag({ ...profile, active: false }),
    ).not.toBe(initial);
    expect(
      buildOrganisationProfileEtag({ ...profile, portalAccess: false }),
    ).not.toBe(initial);
    expect(
      buildOrganisationProfileEtag({
        ...profile,
        quota: { ...profile.quota, maxProjects: profile.quota.maxProjects + 1 },
      }),
    ).not.toBe(initial);
    expect(
      buildOrganisationProfileEtag({
        ...profile,
        projectDefaults: profile.projectDefaults.map((item, index) =>
          index === 0 ? { ...item, serviceCalendarId: "calendar-c" } : item,
        ),
      }),
    ).not.toBe(initial);
  });
});
