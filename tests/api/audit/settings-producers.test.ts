import { describe, expect, it } from "vitest";
import { AUDIT_ONLY_ACTIONS } from "../../../apps/api/src/audit/actions";
import { changedProjectGeneralFields } from "../../../apps/api/src/project/controllers/update-project";
import { changedWorkspaceFields } from "../../../apps/api/src/workspace/controllers/update-workspace";

describe("persisted settings audit inputs", () => {
  it("registers only the two owner-approved audit actions", () => {
    expect(AUDIT_ONLY_ACTIONS.has("workspace.settings_updated")).toBe(true);
    expect(AUDIT_ONLY_ACTIONS.has("user_preference.updated")).toBe(true);
  });

  it("registers the twelve subsequently approved settings actions", () => {
    for (const action of [
      "project.general_settings_updated",
      "project.states_updated",
      "workflow.created",
      "workflow.version_created",
      "workflow.version_published",
      "label.catalogue_created",
      "label.catalogue_updated",
      "label.catalogue_deleted",
      "canned_response.created",
      "canned_response.updated",
      "canned_response.deleted",
      "user.profile_updated",
    ])
      expect(AUDIT_ONLY_ACTIONS.has(action)).toBe(true);
    expect(AUDIT_ONLY_ACTIONS.has("notification.settings_updated")).toBe(true);
  });

  it("reports only changed names from the ordinary workspace field set", () => {
    expect(
      changedWorkspaceFields(
        { name: "Alpha", slug: "alpha", logo: null, description: null },
        {
          name: "Alpha",
          slug: "beta",
          logo: null,
          description: "private text",
        },
      ),
    ).toEqual(["slug", "description"]);
  });

  it("maps a changed project calendar mode to the approved calendar field marker", () => {
    expect(
      changedProjectGeneralFields(
        {
          name: "A",
          serviceCalendarId: "c1",
          serviceCalendarMode: "inherit",
          secret: "old",
        },
        {
          name: "A",
          serviceCalendarId: "c1",
          serviceCalendarMode: "override",
          secret: "new",
        },
      ),
    ).toEqual(["serviceCalendarId"]);
  });
});
