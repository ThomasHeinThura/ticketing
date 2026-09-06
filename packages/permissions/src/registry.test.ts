import { describe, expect, it } from "vitest";
import { normaliseRouteKey, type Policy, type PolicyMap } from "./policy";
import {
  capabilitiesReferencedBy,
  createPolicyRegistry,
  validatePolicy,
} from "./registry";

const source = (name: string, policies: PolicyMap) => ({ name, policies });

describe("route keys", () => {
  it("canonicalises padding, case and both parameter syntaxes", () => {
    expect(
      normaliseRouteKey("POST  /api/projects/{projectId}/work-items"),
    ).toBe("POST /api/projects/{projectId}/work-items");
    expect(normaliseRouteKey("post /api/projects/:projectId/work-items")).toBe(
      "POST /api/projects/{projectId}/work-items",
    );
    expect(normaliseRouteKey("GET /api/task/:id?")).toBe("GET /api/task/{id}");
  });

  it("refuses a key that is not METHOD path", () => {
    expect(() => normaliseRouteKey("/api/projects")).toThrow(/METHOD path/);
    expect(() => normaliseRouteKey("FETCH /api/projects")).toThrow(
      /Unknown HTTP method/,
    );
  });
});

describe("createPolicyRegistry", () => {
  it("merges feature maps and finds an entry however the key was written", () => {
    const registry = createPolicyRegistry([
      source("a/policy.ts", {
        "GET  /api/project/{id}": {
          capability: "project:read",
          scope: "project",
        },
      }),
      source("b/policy.ts", {
        "GET /api/health": { public: true, reason: "liveness probe" },
      }),
    ]);
    expect(registry.entries).toHaveLength(2);
    expect(registry.get("get /api/project/:id")?.kind).toBe("capability");
    expect(registry.has("GET /api/health")).toBe(true);
  });

  it("refuses the same route declared twice — one route, one policy", () => {
    expect(() =>
      createPolicyRegistry([
        source("a/policy.ts", {
          "GET /api/project/{id}": {
            capability: "project:read",
            scope: "project",
          },
        }),
        source("b/policy.ts", {
          "GET /api/project/:id": {
            capability: "project:update",
            scope: "project",
          },
        }),
      ]),
    ).toThrow(/declared twice/);
  });

  it("reports every problem at once rather than the first", () => {
    let message = "";
    try {
      createPolicyRegistry([
        source("bad/policy.ts", {
          "GET /api/a": {
            capability: "not:real",
            scope: "project",
          } as unknown as Policy,
          "GET /api/b": { public: true, reason: "  " },
        }),
      ]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/unknown capability/);
    expect(message).toMatch(/must state a reason/);
  });
});

describe("validatePolicy — there is no sixth kind", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    [
      "a shape matching no kind",
      { scope: "project" },
      /none of the five kinds/,
    ],
    [
      "a mixture of two kinds",
      {
        capability: "project:read",
        scope: "project",
        public: true,
        reason: "x",
      },
      /mixes 2 of the five kinds/,
    ],
    [
      "an unknown capability",
      { capability: "mcp:admin", scope: "project" },
      /unknown capability/,
    ],
    [
      "an unknown scope",
      { capability: "project:read", scope: "team" },
      /unknown scope/,
    ],
    [
      "an invented owner predicate",
      {
        capability: "comment:update_any",
        scope: "work_item",
        orOwner: {
          predicate: "row.author === identity.personId",
          capability: "comment:update_own",
        },
      },
      /unknown owner predicate/,
    ],
    [
      "an invented portal predicate",
      { portal: "customer", predicate: "everything" },
      /unknown portal predicate/,
    ],
    [
      "a delegated surface outside the closed union",
      { delegated: "graphql", reason: "why not" },
      /closed delegated union/,
    ],
    [
      "a public route with no reason",
      { public: true, reason: "" },
      /must state a reason/,
    ],
    [
      "a delegated mount with no reason",
      { delegated: "metrics", reason: "" },
      /must say what it delegates to and why/,
    ],
    [
      "elevated: false with no written reason",
      { capability: "project:read", scope: "project", elevated: false },
      /needs elevationExemptionReason/,
    ],
  ];

  for (const [name, policy, expected] of cases) {
    it(`rejects ${name}`, () => {
      const problems = validatePolicy("GET /api/x", policy as Policy);
      expect(problems.join("\n")).toMatch(expected);
    });
  }

  it("accepts each of the five kinds", () => {
    const policies: Policy[] = [
      { capability: "project:read", scope: "project" },
      { authenticated: true, self: true },
      { portal: "customer", predicate: "own_request" },
      { public: true, reason: "rendered on the login page" },
      { delegated: "websocket", reason: "the upgrade handler authenticates" },
    ];
    for (const policy of policies) {
      expect(validatePolicy("GET /api/x", policy)).toEqual([]);
    }
  });
});

describe("capabilitiesReferencedBy", () => {
  it("counts the primary capability and both branch capabilities", () => {
    const registry = createPolicyRegistry([
      source("a/policy.ts", {
        "PATCH /api/comments/{id}": {
          capability: "comment:update_any",
          scope: "work_item",
          orOwner: {
            predicate: "row.person_id === identity.personId",
            capability: "comment:update_own",
            withinMinutes: 15,
          },
        },
        "POST /api/work-items/{key}/assign": {
          capability: "work_item:assign",
          scope: "work_item",
          orSelfTarget: {
            predicate: "body.assigneeId === identity.personId",
            capability: "work_item:update",
          },
        },
      }),
    ]);
    expect([...capabilitiesReferencedBy(registry)].sort()).toEqual([
      "comment:update_any",
      "comment:update_own",
      "work_item:assign",
      "work_item:update",
    ]);
  });
});
