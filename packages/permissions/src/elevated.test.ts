import { describe, expect, it } from "vitest";
import { isCapability } from "./capabilities";
import {
  AUTHORITY_GRANTING,
  elevatedActions,
  elevatedWithoutSessionOnly,
  elevationViolations,
  isInstanceRoute,
  renderElevatedActionsMarkdown,
  sessionOnlyRoutes,
} from "./elevated";
import type { PolicyMap } from "./policy";
import { createPolicyRegistry } from "./registry";

const registryOf = (policies: PolicyMap) =>
  createPolicyRegistry([{ name: "test", policies }]);

describe("AUTHORITY_GRANTING", () => {
  it("names only capabilities that exist", () => {
    for (const capability of AUTHORITY_GRANTING) {
      expect(isCapability(capability), capability).toBe(true);
    }
  });
});

describe("the elevated-action list is generated, never hand-maintained", () => {
  const registry = registryOf({
    "DELETE /api/webhooks/{id}": {
      capability: "webhook:manage",
      scope: "workspace",
      scopeSource: "request",
      reach: {
        exempt: "no_single_resource",
        reason: "a workspace-scoped management action, not a single resource",
      },
      elevated: true,
      sessionOnly: true,
    },
    "GET /api/project/{id}": {
      capability: "project:read",
      scope: "project",
      scopeSource: "row",
      reach: "required",
    },
  });

  it("lists exactly the entries that declare elevated: true", () => {
    expect(elevatedActions(registry)).toEqual([
      {
        routeKey: "DELETE /api/webhooks/{id}",
        capability: "webhook:manage",
        sessionOnly: true,
        source: "test",
      },
    ]);
  });

  it("enumerates session-only routes from the sessionOnly field, not a second list", () => {
    expect(sessionOnlyRoutes(registry)).toEqual(["DELETE /api/webhooks/{id}"]);
  });

  it("renders a table the document can be diffed against", () => {
    expect(renderElevatedActionsMarkdown(registry)).toContain(
      "| `DELETE /api/webhooks/{id}` | `webhook:manage` | yes |",
    );
  });
});

describe("the elevation coverage rule", () => {
  it("catches an /api/instance/* route that declares nothing", () => {
    const violations = elevationViolations(
      registryOf({
        "POST /api/instance/purge": {
          capability: "instance:admin",
          scope: "instance",
          scopeSource: "instance",
          reach: {
            exempt: "no_single_resource",
            reason: "an instance-wide action, not a single resource",
          },
        },
      }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].routeKey).toBe("POST /api/instance/purge");
  });

  it("catches an authority-granting capability outside the instance surface", () => {
    const violations = elevationViolations(
      registryOf({
        "POST /api/workspaces/{id}/api-keys": {
          capability: "api_key:manage",
          scope: "workspace",
          scopeSource: "request",
          reach: {
            exempt: "no_single_resource",
            reason:
              "creates a new key; there is no existing row to reach-check",
          },
        },
      }),
    );
    expect(
      violations.map((violation) => violation.reason.split(" ")[0]),
    ).toEqual(["api_key:manage"]);
  });

  it("M2: catches a route whose orOwner branch grants an AUTHORITY_GRANTING capability", () => {
    // The primary capability is ordinary read — not authority-granting on its own — so the
    // route generates no violation on that basis alone. But its orOwner branch grants
    // project:manage_members, which controls the two reach-affecting fields (parent_id,
    // owner_team_id) and is itself in AUTHORITY_GRANTING. `capabilitiesReferencedBy` in
    // registry.ts already walks both branches for the unreferenced-capability rule; the
    // elevation rule must not be blind to what that function already sees.
    const violations = elevationViolations(
      registryOf({
        "PATCH /api/projects/{id}": {
          capability: "project:read",
          scope: "project",
          scopeSource: "row",
          reach: "required",
          orOwner: {
            predicate: "row.created_by === identity.personId",
            capability: "project:manage_members",
          },
        },
      }),
    );
    expect(violations).toHaveLength(1);
  });

  it("M2: catches a route whose orSelfTarget branch grants an AUTHORITY_GRANTING capability", () => {
    const violations = elevationViolations(
      registryOf({
        "PATCH /api/work-items/{key}/assignee": {
          capability: "work_item:read",
          scope: "work_item",
          scopeSource: "row",
          reach: "required",
          orSelfTarget: {
            predicate: "body.assigneeId === identity.personId",
            // webhook:manage is in AUTHORITY_GRANTING; a self-target branch granting it is
            // exactly as authority-granting as an orOwner branch granting it.
            capability: "webhook:manage",
          },
        },
      }),
    );
    expect(violations).toHaveLength(1);
  });

  it("accepts an explicit, reasoned opt-out", () => {
    expect(
      elevationViolations(
        registryOf({
          "GET /api/instance/status": {
            public: true,
            reason: "first-run bootstrap",
            elevated: false,
            elevationExemptionReason: "reads one boolean; grants nothing",
          },
        }),
      ),
    ).toEqual([]);
  });

  it("leaves ordinary routes alone", () => {
    expect(
      elevationViolations(
        registryOf({
          "GET /api/project/{id}": {
            capability: "project:read",
            scope: "project",
            scopeSource: "row",
            reach: "required",
          },
        }),
      ),
    ).toEqual([]);
  });

  it("does not mistake a lookalike path for the instance surface", () => {
    expect(isInstanceRoute("GET /api/instances/{id}")).toBe(false);
    expect(isInstanceRoute("GET /api/instance/status")).toBe(true);
  });
});

describe("an elevated route is always session-only", () => {
  it("names an elevated route that forgot sessionOnly", () => {
    expect(
      elevatedWithoutSessionOnly(
        registryOf({
          "POST /api/instance/users/{id}/impersonate": {
            capability: "instance:admin",
            scope: "instance",
            scopeSource: "instance",
            reach: {
              exempt: "no_single_resource",
              reason:
                "the impersonation target is named by a path parameter, not reach-checked",
            },
            elevated: true,
          },
        }),
      ),
    ).toEqual(["POST /api/instance/users/{id}/impersonate"]);
  });
});
