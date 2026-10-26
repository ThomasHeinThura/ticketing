import { describe, expect, it } from "vitest";
import { buildOrganisationCatalogueEtag } from "../../../apps/api/src/instance/organisation-catalogue";

describe("organisation catalogue ETag", () => {
  it("binds the exact sorted request type set to its organisation", () => {
    expect(buildOrganisationCatalogueEtag("org-a", ["rt-b", "rt-a"])).toBe(
      buildOrganisationCatalogueEtag("org-a", ["rt-a", "rt-b"]),
    );
    expect(buildOrganisationCatalogueEtag("org-a", ["rt-a", "rt-b"])).not.toBe(
      buildOrganisationCatalogueEtag("org-b", ["rt-a", "rt-b"]),
    );
    expect(buildOrganisationCatalogueEtag("org-a", ["rt-a"])).not.toBe(
      buildOrganisationCatalogueEtag("org-a", ["rt-a", "rt-b"]),
    );
  });
});
