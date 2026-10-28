import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({ apiFetch: mocks.apiFetch }));

import {
  getOrganisations,
  replaceOrganisationCatalogue,
  requestOrganisationDeletion,
  requestOrganisationHardPurge,
  restoreOrganisation,
} from "./organisations";

beforeEach(() => mocks.apiFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("God Mode organisation catalogue fetchers", () => {
  it("loads the persisted directory without caching", async () => {
    const body = { data: [], options: [] };
    mocks.apiFetch.mockResolvedValue(Response.json(body));

    await expect(getOrganisations()).resolves.toEqual(body);
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("instance/organisations"),
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("sends an ETag-bound PUT and validates the returned organisation", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json({
        data: {
          catalogue: {
            organisationId: "org/1",
            requestTypeIds: ["rt-1"],
            etag: '"new"',
          },
          assignedRequestTypes: [],
        },
      }),
    );
    await expect(
      replaceOrganisationCatalogue({
        organisationId: "org/1",
        requestTypeIds: ["rt-1"],
        expectedCatalogueEtag: '"old"',
      }),
    ).resolves.toMatchObject({
      catalogue: { organisationId: "org/1", requestTypeIds: ["rt-1"] },
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("org%2F1/catalogue"),
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({
          requestTypeIds: ["rt-1"],
          expectedCatalogueEtag: '"old"',
        }),
      }),
    );
  });

  it("surfaces stale catalogue responses as 409 errors", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json({ message: "catalogue_conflict" }, { status: 409 }),
    );
    await expect(
      replaceOrganisationCatalogue({
        organisationId: "org-1",
        requestTypeIds: [],
        expectedCatalogueEtag: '"old"',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("requests deletion through the pending-action endpoint without claiming deletion", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json(
        { pendingActionId: "pending-1", confirmation: "typed_name_step_up" },
        { status: 202 },
      ),
    );
    await expect(requestOrganisationDeletion("org/1")).resolves.toEqual({
      pendingActionId: "pending-1",
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("instance/organisations/org%2F1"),
      expect.objectContaining({ method: "DELETE", body: "{}" }),
    );
  });

  it("requests a hard purge only through the existing PA-13 route", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json(
        {
          pendingActionId: "pending-purge-1",
          action: "purge",
          confirmation: "typed_name_step_up",
        },
        { status: 202 },
      ),
    );
    await expect(requestOrganisationHardPurge("org/1")).resolves.toEqual({
      pendingActionId: "pending-purge-1",
    });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("instance/purge"),
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ targetType: "organisation", targetId: "org/1" }),
      }),
    );
  });

  it("preserves an ineligible hold response as a 409 without manufacturing an action", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json(
        { message: "hard_purge_refused: legal_hold" },
        { status: 409 },
      ),
    );
    await expect(requestOrganisationHardPurge("org-1")).rejects.toMatchObject({
      status: 409,
    });
  });

  it("binds restore to the exact operation and one-use step-up token", async () => {
    mocks.apiFetch.mockResolvedValue(
      Response.json({
        data: {
          id: "org-1",
          profileEtag: '"profile-2"',
          emailDomains: [],
          projectDefaults: [],
        },
      }),
    );
    await expect(
      restoreOrganisation({
        organisationId: "org-1",
        expectedOperationId: "delete-1",
        expectedGeneration: 3,
        stepUpToken: "a".repeat(43),
      }),
    ).resolves.toMatchObject({ id: "org-1" });
    expect(mocks.apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("instance/organisations/org-1/restore"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-TaskDesk-Step-Up-Token": "a".repeat(43),
        }),
        body: JSON.stringify({
          expectedOperationId: "delete-1",
          expectedGeneration: 3,
        }),
      }),
    );
  });
});
