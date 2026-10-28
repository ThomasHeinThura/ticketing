import { afterEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({ apiFetch }));

import {
  inheritProjectStateSet,
  patchProjectSettingsInheritance,
  patchWorkspaceProjectSettings,
  patchWorkspaceStateTemplate,
} from "./project-settings-inheritance";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => apiFetch.mockReset());

describe("project and workspace settings fetchers", () => {
  it("keeps explicit null distinct from an omitted default update", async () => {
    apiFetch.mockResolvedValue(response({ version: 3 }));
    await patchWorkspaceProjectSettings("ws/a", {
      expectedVersion: 2,
      defaultSlaPolicyId: null,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("workspace/ws%2Fa/project-settings"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ expectedVersion: 2, defaultSlaPolicyId: null }),
        credentials: "include",
        cache: "no-store",
      }),
    );
  });

  it("sends both CAS versions and preserves explicit override-none", async () => {
    apiFetch.mockResolvedValue(response({}));
    await patchProjectSettingsInheritance("project-1", {
      expectedProjectVersion: 4,
      expectedWorkspaceVersion: 7,
      serviceCalendar: { mode: "override", id: null },
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("projects/project-1/settings/inheritance"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          expectedProjectVersion: 4,
          expectedWorkspaceVersion: 7,
          serviceCalendar: { mode: "override", id: null },
        }),
      }),
    );
  });

  it("syncs state membership through the versioned inherit endpoint", async () => {
    apiFetch.mockResolvedValue(response({}));
    await inheritProjectStateSet({
      projectId: "project-1",
      expectedProjectVersion: 5,
      expectedWorkspaceVersion: 8,
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("projects/project-1/state-set"),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          expectedProjectVersion: 5,
          expectedWorkspaceVersion: 8,
          mode: "inherit",
        }),
      }),
    );
  });

  it("returns read-safe affected items on a state-template disable conflict", async () => {
    apiFetch.mockResolvedValue(
      response(
        {
          code: "state_in_use",
          message: "State template is in use",
          hasHiddenAffectedItems: true,
          affectedItems: [
            {
              id: "item-1",
              key: "OPS-4",
              title: "Prepare launch",
              projectId: "project-2",
              projectName: "Operations",
            },
          ],
        },
        409,
      ),
    );
    await expect(
      patchWorkspaceStateTemplate("ws-1", "template-1", {
        expectedVersion: 10,
        enabled: false,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "state_in_use",
      hasHiddenAffectedItems: true,
      affectedItems: [{ id: "item-1", key: "OPS-4" }],
    });
  });
});
