import { describe, expect, it } from "vitest";
import {
  normaliseRouteKey,
  normaliseRoutePath,
  type Policy,
  type PolicyMap,
} from "./policy";
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

  it("separates on any whitespace, not only a space", () => {
    expect(normaliseRouteKey("GET\t/api/task/:id")).toBe("GET /api/task/{id}");
    expect(normaliseRouteKey("GET\n\t /api/task/:id")).toBe(
      "GET /api/task/{id}",
    );
    expect(() => normaliseRouteKey("GET")).toThrow(/METHOD path/);
  });
});

/**
 * normaliseRoutePath was a regex until CodeQL flagged it `js/polynomial-redos`
 * (HIGH). These tests exist so the hand-written parser that replaced it is held
 * to the old behaviour rather than to my reading of the old behaviour, and so
 * the quadratic cannot come back unnoticed.
 */
describe("normaliseRoutePath — the parser that replaced the regex", () => {
  /** The exact expression that was removed. Kept here as the oracle. */
  const withRemovedRegex = (path: string): string =>
    path.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?(\?)?/g, "{$1}");

  it("converts the syntaxes Hono actually emits", () => {
    expect(normaliseRoutePath("/api/task/:id")).toBe("/api/task/{id}");
    expect(normaliseRoutePath("/api/task/:id?")).toBe("/api/task/{id}");
    expect(normaliseRoutePath("/api/task/:id{[0-9]+}")).toBe("/api/task/{id}");
    expect(normaliseRoutePath("/api/task/:id{[0-9]+}?")).toBe("/api/task/{id}");
    expect(normaliseRoutePath("/api/p/:pId/t/:tId")).toBe(
      "/api/p/{pId}/t/{tId}",
    );
    expect(normaliseRoutePath("/api/task/{id}")).toBe("/api/task/{id}");
  });

  it("leaves alone what is not a parameter", () => {
    expect(normaliseRoutePath("/api/health")).toBe("/api/health");
    expect(normaliseRoutePath("/api/a:b")).toBe("/api/a{b}");
    expect(normaliseRoutePath("/api/:")).toBe("/api/:");
    expect(normaliseRoutePath("/api/:/x")).toBe("/api/:/x");
    expect(normaliseRoutePath("")).toBe("");
    expect(normaliseRoutePath("/")).toBe("/");
  });

  it("preserves a trailing slash, which is significant to Hono", () => {
    expect(normaliseRoutePath("/api/task/:id/")).toBe("/api/task/{id}/");
    expect(normaliseRouteKey("GET /api/task/:id/")).not.toBe(
      normaliseRouteKey("GET /api/task/:id"),
    );
  });

  it("keeps the old quirks rather than quietly improving them", () => {
    // `[^}]*` stopped at the FIRST "}", so a nested-brace constraint left one
    // behind. Changing that here would desynchronise this normaliser from the
    // route scanner, which normalises through the same function.
    expect(normaliseRoutePath("/api/task/:id{[0-9]{3}}")).toBe(
      "/api/task/{id}}",
    );
    // An unterminated "{" makes the optional group match empty; the brace stays.
    expect(normaliseRoutePath("/api/task/:id{[0-9]+")).toBe(
      "/api/task/{id}{[0-9]+",
    );
  });

  it("agrees with the removed regex on every generated input", () => {
    const alphabet = [":", "{", "}", "?", "a", "0", "_", "/", "-", "."];
    const cases: string[] = [];

    // Every string of length <= 3 over an alphabet chosen to be all edge.
    for (const a of alphabet) {
      cases.push(a);
      for (const b of alphabet) {
        cases.push(a + b);
        for (const c of alphabet) cases.push(a + b + c);
      }
    }

    // Plus realistic and adversarial shapes.
    cases.push(
      "/api/workspace/:workspaceId/project/:projectId/task/:taskId",
      "/api/task/:id{[0-9]+}?/comment/:commentId?",
      "/api/:a{}/:b{}",
      "/api/:a{:b}/:c",
      "/api/:_/:0/:A",
      ":0{{".repeat(64),
      `${"{".repeat(64)}:id`,
      `:id${"}".repeat(64)}`,
      "::::id",
      "/api/:id?????",
    );

    const disagreements = cases.filter(
      (input) => normaliseRoutePath(input) !== withRemovedRegex(input),
    );
    expect(disagreements).toEqual([]);
    expect(cases.length).toBeGreaterThan(1000);
  });

  it("is linear, not polynomial, on the input CodeQL named", () => {
    // The removed regex measured 0.9/3.3/13.5/50.8/202.5 ms at 2k/4k/8k/16k/32k
    // characters — four times the work for twice the input. 320k characters
    // would have been about twenty seconds of blocked event loop.
    const pathological = ":0{{".repeat(80_000); // 320k characters

    const startedAt = performance.now();
    const result = normaliseRoutePath(pathological);
    const elapsedMs = performance.now() - startedAt;

    expect(result.startsWith("{0}{{")).toBe(true);
    // Generous by two orders of magnitude against the quadratic, so this fails
    // on a reintroduced blowup and not on a slow CI runner.
    expect(elapsedMs).toBeLessThan(1_000);
  });
});

describe("createPolicyRegistry", () => {
  it("merges feature maps and finds an entry however the key was written", () => {
    const registry = createPolicyRegistry([
      source("a/policy.ts", {
        "GET  /api/project/{id}": {
          capability: "project:read",
          scope: "project",
          scopeSource: "row",
          reach: "required",
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
      "a missing scopeSource",
      {
        capability: "project:read",
        scope: "project",
        reach: "required",
      },
      /scopeSource/,
    ],
    [
      "an invented scopeSource",
      {
        capability: "project:read",
        scope: "project",
        scopeSource: "header",
        reach: "required",
      },
      /scopeSource/,
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
      {
        capability: "project:read",
        scope: "project",
        scopeSource: "row",
        reach: "required",
      },
      { authenticated: true, self: true, personParam: "personId" },
      { portal: "customer", predicate: "own_request" },
      { public: true, reason: "rendered on the login page" },
      { delegated: "websocket", reason: "the upgrade handler authenticates" },
    ];
    for (const policy of policies) {
      expect(validatePolicy("GET /api/{personId}/x", policy)).toEqual([]);
    }
  });

  it("accepts the reach and personParam exemptions", () => {
    const policies: Policy[] = [
      {
        capability: "work_item:create",
        scope: "project",
        scopeSource: "request",
        reach: {
          exempt: "no_single_resource",
          reason: "a create addresses no row yet",
        },
      },
      {
        authenticated: true,
        self: true,
        personParam: {
          exempt: "no_person_parameter",
          reason: "/api/me/settings addresses the session's own person",
        },
      },
    ];
    for (const policy of policies) {
      expect(validatePolicy("GET /api/x", policy)).toEqual([]);
    }
  });

  it("rejects a capability policy that does not say whether reach applies", () => {
    const problems = validatePolicy("GET /api/x", {
      capability: "project:read",
      scope: "project",
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(/reach must be/);
  });

  it("rejects a reach exemption with no written reason", () => {
    const problems = validatePolicy("GET /api/x", {
      capability: "project:read",
      scope: "project",
      reach: { exempt: "no_single_resource", reason: "" },
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(/deliberate, reviewable act/);
  });

  it("rejects a reach exemption on a route that loads a row via orOwner", () => {
    const problems = validatePolicy("GET /api/x", {
      capability: "comment:update_any",
      scope: "work_item",
      reach: { exempt: "no_single_resource", reason: "x" },
      orOwner: {
        predicate: "row.person_id === identity.personId",
        capability: "comment:update_own",
      },
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(
      /cannot claim the no_single_resource exemption/,
    );
  });

  it("rejects a self policy that does not say what names a person", () => {
    const problems = validatePolicy("GET /api/x", {
      authenticated: true,
      self: true,
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(/personParam must name/);
  });

  it("rejects a personParam that is not actually a parameter of the route", () => {
    const problems = validatePolicy("GET /api/me", {
      authenticated: true,
      self: true,
      personParam: "personId",
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(/is not a parameter of this route/);
  });

  it("rejects a public route declaring sessionOnly", () => {
    const problems = validatePolicy("GET /api/x", {
      public: true,
      reason: "liveness probe",
      sessionOnly: true,
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(/a public route cannot be sessionOnly/);
  });

  it("rejects a public route declaring elevated: true", () => {
    const problems = validatePolicy("GET /api/x", {
      public: true,
      reason: "first-run bootstrap",
      elevated: true,
    } as unknown as Policy);
    expect(problems.join("\n")).toMatch(/a public route cannot be elevated/);
  });

  it("fails at boot on a public route that declares elevated: true", () => {
    expect(() =>
      createPolicyRegistry([
        source("plugin/policy.ts", {
          "GET /api/instance/status": {
            public: true,
            reason: "first-run bootstrap",
            elevated: true,
          } as unknown as Policy,
        }),
      ]),
    ).toThrow(/a public route cannot be elevated/);
  });

  it("validatePolicy returns [] for the shipped public + elevated: false + waiver shape", () => {
    expect(
      validatePolicy("GET /api/instance/status", {
        public: true,
        reason: "first-run bootstrap",
        elevated: false,
        elevationExemptionReason:
          "reads one boolean about setup state; it grants nothing",
      }),
    ).toEqual([]);
  });

  it("validatePolicy returns [] for a delegated mount declaring both flags", () => {
    expect(
      validatePolicy("POST /api/scim/v2/Users", {
        delegated: "scim",
        reason: "SCIM provisioning surface",
        elevated: true,
        sessionOnly: true,
      }),
    ).toEqual([]);
  });
});

describe("capabilitiesReferencedBy", () => {
  it("counts the primary capability and both branch capabilities", () => {
    const registry = createPolicyRegistry([
      source("a/policy.ts", {
        "PATCH /api/comments/{id}": {
          capability: "comment:update_any",
          scope: "work_item",
          scopeSource: "row",
          reach: "required",
          orOwner: {
            predicate: "row.person_id === identity.personId",
            capability: "comment:update_own",
            withinMinutes: 15,
          },
        },
        "POST /api/work-items/{key}/assign": {
          capability: "work_item:assign",
          scope: "work_item",
          scopeSource: "row",
          reach: "required",
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
