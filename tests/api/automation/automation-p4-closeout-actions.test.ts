import { describe, expect, it } from "vitest";
import {
  BUILTIN_ACTION_TYPES,
  parseAction,
  requiredCapability,
  UNAVAILABLE_ACTION_TYPES,
} from "../../../apps/api/src/automation/actions";
import { evaluateCondition } from "../../../apps/api/src/automation/conditions";
import { validateRuleDefinition } from "../../../apps/api/src/automation/validation";

const available = new Set<string>(BUILTIN_ACTION_TYPES);
const parse = (raw: unknown) => parseAction(raw, 0, available);

describe("post_comment action", () => {
  it("is available, and its capability follows the visibility", () => {
    expect(BUILTIN_ACTION_TYPES).toContain("post_comment");
    expect(UNAVAILABLE_ACTION_TYPES).not.toContain("post_comment");
    const publicOne = parse({
      type: "post_comment",
      visibility: "public",
      body: "Hello {{work_item.key}}",
    });
    const internalOne = parse({
      type: "post_comment",
      visibility: "internal",
      body: "FYI {{assignee.email}}",
    });
    expect(publicOne.ok && requiredCapability(publicOne.action)).toBe(
      "comment:create",
    );
    expect(internalOne.ok && requiredCapability(internalOne.action)).toBe(
      "comment:create_internal",
    );
  });

  it("refuses a staff-only placeholder in a public comment, naming it (AM-11)", () => {
    const refused = parse({
      type: "post_comment",
      visibility: "public",
      body: "Ask {{assignee.email}} or {{requester.email}}",
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.problem.message).toContain("assignee.email");
      expect(refused.problem.message).toContain("requester.email");
    }
    // The same text is fine in an internal note, and an unknown placeholder is refused anywhere.
    expect(
      parse({
        type: "post_comment",
        visibility: "internal",
        body: "Ask {{assignee.email}}",
      }).ok,
    ).toBe(true);
    expect(
      parse({
        type: "post_comment",
        visibility: "internal",
        body: "{{cf.secret}}",
      }).ok,
    ).toBe(false);
  });

  it("refuses an empty, oversized, NUL-bearing or malformed body", () => {
    for (const body of ["", "   ", "x".repeat(5001), "a\u0000b", 5, null]) {
      expect(
        parse({ type: "post_comment", visibility: "internal", body }).ok,
      ).toBe(false);
    }
    expect(parse({ type: "post_comment", body: "hi" }).ok).toBe(false);
    expect(
      parse({
        type: "post_comment",
        visibility: "internal",
        body: "hi",
        extra: 1,
      }).ok,
    ).toBe(false);
  });
});

describe("transition action", () => {
  it("needs work_item:transition and exactly one target", () => {
    const parsed = parse({ type: "transition", toStateTemplateId: "tpl_1" });
    expect(parsed.ok && requiredCapability(parsed.action)).toBe(
      "work_item:transition",
    );
    expect(parse({ type: "transition" }).ok).toBe(false);
    expect(
      parse({ type: "transition", toStateTemplateId: "t", force: true }).ok,
    ).toBe(false);
  });

  it("keeps notify as 422 unavailable (no catalogued event to deliver it through yet)", () => {
    const result = validateRuleDefinition({
      trigger: "work_item.created",
      conditions: [],
      actions: [{ type: "notify", personId: "p" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]?.code).toBe("unavailable");
  });
});

describe("sla_state condition", () => {
  const facts = (slaState: string | null | undefined) => ({
    now: new Date(),
    workItem: {
      typeKey: "t",
      stateKey: "s",
      stateGroup: "started",
      priority: null,
      assigneeId: null,
      requesterId: null,
      labels: [],
      organisationId: null,
      projectKey: "P",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(slaState === undefined ? {} : { slaState }),
    },
  });
  it("matches the badge state, treats no SLA as empty, and never matches when not loaded", () => {
    const eq = { field: "sla_state", op: "eq", value: "breached" } as const;
    expect(evaluateCondition(eq, facts("breached"))).toBe(true);
    expect(evaluateCondition(eq, facts("ok"))).toBe(false);
    expect(evaluateCondition(eq, facts(null))).toBe(false);
    const empty = { field: "sla_state", op: "is_empty" } as const;
    expect(evaluateCondition(empty, facts(null))).toBe(true);
    expect(evaluateCondition(empty, facts("ok"))).toBe(false);
    expect(evaluateCondition(empty, facts(undefined))).toBe(false);
    expect(
      evaluateCondition(
        { field: "sla_state", op: "in", value: ["at_risk", "breached"] },
        facts("at_risk"),
      ),
    ).toBe(true);
  });
});
