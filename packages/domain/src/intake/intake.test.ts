/**
 * Intake domain tests — the submission state machine, the reference format, and the
 * three unit areas `request-types-and-catalogue.md`'s Testing section names: form
 * schema validation, conditional visibility evaluation, mapsTo translation — plus
 * `intake-queue.md`'s own unit demands (field mapping, and every IQ guard).
 *
 * All instants are explicit dates; no test reads a clock.
 */

import { describe, expect, it } from "vitest";
import {
  duplicateSuggestions,
  renderUnmappedIntoDescription,
  similarityScore,
} from "./duplicate.js";
import {
  catalogueFor,
  isFieldVisible,
  isRequestTypeVisible,
  translateMapsTo,
  validateFormSchema,
  validateSubmissionData,
  visibleFields,
} from "./request-type.js";
import {
  formatSubmissionReference,
  isClarificationOverdue,
  parseSubmissionReference,
  transitionSubmission as transition,
  triageHasStarted,
} from "./submission.js";
import type {
  FormSchema,
  RequestTypeCatalogueEntry,
  SubmissionRecord,
} from "./types.js";

// --- fixtures -----------------------------------------------------------------

const NOW = new Date("2026-09-23T12:00:00Z");

function record(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    number: 7,
    state: "new",
    claimedBy: null,
    claimedAt: null,
    clarifyingSince: null,
    staffMessageCount: 0,
    ...overrides,
  };
}

const IMPACT_SCHEMA: FormSchema = {
  fields: [
    { key: "summary", type: "text", label: "What's wrong?", required: true },
    {
      key: "impact",
      type: "select",
      label: "Who is affected?",
      options: ["Just me", "My team", "Everyone"],
      required: true,
      mapsTo: {
        field: "priority",
        map: { "Just me": "low", "My team": "medium", Everyone: "high" },
      },
    },
    { key: "asset", type: "text", label: "Asset tag", help: "On the sticker" },
    {
      key: "asset_location",
      type: "text",
      label: "Where is the asset?",
      showIf: { field: "asset", equals: "printer-3" },
    },
  ],
};

// --- state machine -------------------------------------------------------------

describe("transitionSubmission — staff actions", () => {
  it("clarify: triager only, new→clarifying, stamps clarifyingSince (IQ-6)", () => {
    const r = transition(record(), {
      action: "clarify",
      actor: "triager",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.to).toBe("clarifying");
    expect(r.record.clarifyingSince).toEqual(NOW);
  });

  it("a customer cannot run any staff action", () => {
    for (const action of [
      "clarify",
      "accept",
      "decline",
      "duplicate",
    ] as const) {
      const r = transition(record(), { action, actor: "customer", now: NOW });
      expect(r).toEqual({ ok: false, refusal: "not_your_action" });
    }
  });

  it("accept: requires the work item the caller created (IQ-7), new→accepted", () => {
    const missing = transition(record(), {
      action: "accept",
      actor: "triager",
      now: NOW,
    });
    expect(missing).toEqual({ ok: false, refusal: "missing_work_item" });
    const ok = transition(record(), {
      action: "accept",
      actor: "triager",
      now: NOW,
      workItemId: "wi_1",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.to).toBe("accepted");
  });

  it("decline: reason is mandatory and non-blank — no silent decline (IQ-16)", () => {
    for (const reason of [undefined, "", "   "]) {
      const r = transition(record(), {
        action: "decline",
        actor: "triager",
        now: NOW,
        reason,
      });
      expect(r).toEqual({ ok: false, refusal: "missing_reason" });
    }
    const ok = transition(record(), {
      action: "decline",
      actor: "triager",
      now: NOW,
      reason: "Out of scope — contact facilities.",
    });
    expect(ok.ok).toBe(true);
  });

  it("duplicate: requires the target work item (IQ-17)", () => {
    const missing = transition(record(), {
      action: "duplicate",
      actor: "triager",
      now: NOW,
    });
    expect(missing).toEqual({ ok: false, refusal: "missing_target" });
    const ok = transition(record(), {
      action: "duplicate",
      actor: "triager",
      now: NOW,
      targetWorkItemId: "wi_9",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.to).toBe("duplicate");
  });

  it("auto_decline: only from clarifying and only once overdue (IQ-15)", () => {
    const fresh = record({
      state: "clarifying",
      clarifyingSince: new Date("2026-09-22T12:00:00Z"), // one day ago
    });
    const early = transition(fresh, {
      action: "auto_decline",
      actor: "triager",
      now: NOW,
      reason: "No response.",
    });
    expect(early.ok).toBe(false);
    const stale = record({
      state: "clarifying",
      clarifyingSince: new Date("2026-09-01T12:00:00Z"), // 22 days ago
    });
    const late = transition(stale, {
      action: "auto_decline",
      actor: "triager",
      now: NOW,
      reason: "No response within 14 days.",
    });
    expect(late.ok).toBe(true);
    const notClarity = transition(record({ state: "new" }), {
      action: "auto_decline",
      actor: "triager",
      now: NOW,
      reason: "x",
    });
    expect(notClarity.ok).toBe(false);
  });
});

describe("transitionSubmission — customer actions", () => {
  it("reply: customer only, clarifying→new, clears the clock (IQ-13)", () => {
    const r = transition(
      record({
        state: "clarifying",
        clarifyingSince: new Date("2026-09-20T12:00:00Z"),
      }),
      { action: "reply", actor: "customer", now: NOW },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.to).toBe("new");
    expect(r.record.clarifyingSince).toBeNull();
    // a triager cannot send the customer-side reply
    expect(
      transition(record({ state: "clarifying" }), {
        action: "reply",
        actor: "triager",
        now: NOW,
      }),
    ).toEqual({ ok: false, refusal: "not_your_action" });
  });

  it("withdraw: allowed while untouched, refused the moment triage starts (IQ-16a)", () => {
    // Untouched new → withdraws.
    const ok = transition(record(), {
      action: "withdraw",
      actor: "customer",
      now: NOW,
    });
    expect(ok.ok).toBe(true);
    // A queue claim alone is enough to refuse.
    const claimed = transition(
      record({ state: "clarifying", claimedBy: "agent_1", claimedAt: NOW }),
      { action: "withdraw", actor: "customer", now: NOW },
    );
    expect(claimed).toEqual({ ok: false, refusal: "triage_started" });
    // A staff message alone is enough too.
    const messaged = transition(record({ staffMessageCount: 1 }), {
      action: "withdraw",
      actor: "customer",
      now: NOW,
    });
    expect(messaged).toEqual({ ok: false, refusal: "triage_started" });
    // And never out of a terminal state.
    const accepted = transition(record({ state: "accepted" }), {
      action: "withdraw",
      actor: "customer",
      now: NOW,
    });
    expect(accepted).toEqual({ ok: false, refusal: "illegal_state" });
  });

  it("reopen: customer only, declined→new (IQ-15 recovery)", () => {
    const r = transition(record({ state: "declined" }), {
      action: "reopen",
      actor: "customer",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("new");
    expect(
      transition(record({ state: "declined" }), {
        action: "reopen",
        actor: "triager",
        now: NOW,
      }),
    ).toEqual({ ok: false, refusal: "not_your_action" });
  });

  it("terminal states accept no actions", () => {
    for (const state of ["accepted", "duplicate", "withdrawn"] as const) {
      for (const actor of ["customer", "triager"] as const) {
        const r = transition(record({ state }), {
          action: actor === "triager" ? "decline" : "withdraw",
          actor,
          now: NOW,
          reason: "x",
        });
        expect(r).toEqual({ ok: false, refusal: "illegal_state" });
      }
    }
  });

  it("triageHasStarted/isClarificationOverdue expose the two clocks", () => {
    expect(triageHasStarted(record())).toBe(false);
    expect(triageHasStarted(record({ staffMessageCount: 2 }))).toBe(true);
    const clarifying = record({
      state: "clarifying",
      clarifyingSince: new Date("2026-09-08T12:00:00Z"), // 15 days
    });
    expect(isClarificationOverdue(clarifying, NOW)).toBe(true);
    expect(isClarificationOverdue(clarifying, NOW, 30)).toBe(false);
    expect(isClarificationOverdue(record(), NOW)).toBe(false);
  });
});

// --- reference -----------------------------------------------------------------

describe("SUB-n reference (IQ-2)", () => {
  it("formats and parses round-trips", () => {
    expect(formatSubmissionReference(1)).toBe("SUB-1");
    expect(parseSubmissionReference("SUB-42")).toBe(42);
    expect(parseSubmissionReference("SUB-42")).toBe(42);
  });

  it("rejects malformed references and numbers", () => {
    expect(parseSubmissionReference("sub-1")).toBeNull();
    expect(parseSubmissionReference("SUB-0")).toBeNull();
    expect(parseSubmissionReference("SUB-x")).toBeNull();
    expect(parseSubmissionReference("SUB-1-2")).toBeNull();
    expect(() => formatSubmissionReference(0)).toThrow(RangeError);
    expect(() => formatSubmissionReference(1.5)).toThrow(RangeError);
  });
});

// --- form schema validation ----------------------------------------------------

describe("validateFormSchema (publish time)", () => {
  it("accepts the spec's own example schema", () => {
    expect(validateFormSchema(IMPACT_SCHEMA, new Set(["priority"]))).toEqual(
      [],
    );
  });

  it("rejects a conditional field whose controlling field was removed (spec edge case)", () => {
    const broken: FormSchema = {
      fields: [
        {
          key: "asset_location",
          type: "text",
          label: "Where?",
          showIf: { field: "asset", equals: "x" },
        },
      ],
    };
    expect(validateFormSchema(broken)).toEqual([
      { key: "asset_location", problem: "show_if_missing_field" },
    ]);
  });

  it("rejects duplicate keys, empty labels, optionless selects, self-referencing showIf, unknown mapsTo", () => {
    const broken: FormSchema = {
      fields: [
        { key: "a", type: "text", label: "A" },
        { key: "a", type: "text", label: "A" },
        { key: "b", type: "text", label: "   " },
        { key: "c", type: "select", label: "C" },
        {
          key: "d",
          type: "text",
          label: "D",
          showIf: { field: "d", equals: "x" },
        },
        { key: "e", type: "text", label: "E", mapsTo: { field: "nope" } },
      ],
    };
    const problems = validateFormSchema(broken, new Set(["priority"])).map(
      (d) => d.problem,
    );
    expect(problems).toContain("duplicate_key");
    expect(problems).toContain("empty_label");
    expect(problems).toContain("select_without_options");
    expect(problems).toContain("show_if_self_reference");
    expect(problems).toContain("maps_to_missing_native_field");
  });
});

// --- conditional visibility (RT-5) ----------------------------------------------

describe("conditional visibility evaluation", () => {
  it("shows when the controlling value matches, hides otherwise", () => {
    const field = IMPACT_SCHEMA.fields[3]; // asset_location, showIf asset=printer-3
    expect(isFieldVisible(field, { asset: "printer-3" })).toBe(true);
    expect(isFieldVisible(field, { asset: "laptop-1" })).toBe(false);
    expect(isFieldVisible(field, {})).toBe(false);
    const unconditional = IMPACT_SCHEMA.fields[0];
    expect(isFieldVisible(unconditional, {})).toBe(true);
  });

  it("visibleFields filters the schema accordingly", () => {
    const shown = visibleFields(IMPACT_SCHEMA, { asset: "printer-3" });
    expect(shown.map((f) => f.key)).toEqual([
      "summary",
      "impact",
      "asset",
      "asset_location",
    ]);
    const hidden = visibleFields(IMPACT_SCHEMA, {});
    expect(hidden.map((f) => f.key)).toEqual(["summary", "impact", "asset"]);
  });
});

// --- submit-time validation ------------------------------------------------------

describe("validateSubmissionData", () => {
  it("a required field that is HIDDEN does not block (the showIf point)", () => {
    const schema: FormSchema = {
      fields: [
        { key: "base", type: "text", label: "Base", required: true },
        {
          key: "extra",
          type: "text",
          label: "Extra",
          required: true,
          showIf: { field: "base", equals: "show-extra" },
        },
      ],
    };
    // extra is required but hidden (base doesn't match) → no error.
    expect(validateSubmissionData(schema, { base: "anything" })).toEqual([]);
    // base matches → extra becomes visible → required now applies.
    expect(validateSubmissionData(schema, { base: "show-extra" })).toEqual([
      { key: "extra", problem: "required_missing" },
    ]);
  });

  it("missing required visible fields and out-of-option select values are reported", () => {
    const errors = validateSubmissionData(IMPACT_SCHEMA, { summary: "" });
    const problems = errors.map((e) => `${e.key}:${e.problem}`);
    expect(problems).toContain("summary:required_missing");
    expect(problems).toContain("impact:required_missing");
    const badOption = validateSubmissionData(IMPACT_SCHEMA, {
      summary: "x",
      impact: "Everything",
    });
    expect(badOption).toEqual([{ key: "impact", problem: "not_an_option" }]);
  });

  it("unknown keys are tolerated — they live in form_data (RT-3)", () => {
    expect(
      validateSubmissionData(IMPACT_SCHEMA, {
        summary: "x",
        impact: "Just me",
        mystery_field: "kept anyway",
      }),
    ).toEqual([]);
  });
});

// --- mapsTo translation (RT-4) ---------------------------------------------------

describe("translateMapsTo — the spec's impact→priority example verbatim", () => {
  it("translates customer wording into native values", () => {
    expect(
      translateMapsTo(IMPACT_SCHEMA, { summary: "x", impact: "Everyone" }),
    ).toEqual({
      priority: "high",
    });
    expect(
      translateMapsTo(IMPACT_SCHEMA, { summary: "x", impact: "Just me" }),
    ).toEqual({
      priority: "low",
    });
  });

  it("an unmapped option keeps the raw answer rather than dropping it", () => {
    const schema: FormSchema = {
      fields: [
        {
          key: "impact",
          type: "select",
          label: "Impact",
          options: ["Just me"],
          mapsTo: { field: "priority", map: { "Just me": "low" } },
        },
      ],
    };
    // A value outside the map (schema drift since publish) survives as-is.
    expect(translateMapsTo(schema, { impact: "Everything" })).toEqual({
      priority: "Everything",
    });
  });

  it("does not map hidden fields", () => {
    const schema: FormSchema = {
      fields: [
        { key: "gate", type: "text", label: "Gate" },
        {
          key: "impact",
          type: "select",
          label: "Impact",
          options: ["Everyone"],
          mapsTo: { field: "priority" },
          showIf: { field: "gate", equals: "on" },
        },
      ],
    };
    expect(
      translateMapsTo(schema, { gate: "off", impact: "Everyone" }),
    ).toEqual({});
    expect(translateMapsTo(schema, { gate: "on", impact: "Everyone" })).toEqual(
      {
        priority: "Everyone",
      },
    );
  });
});

// --- catalogue visibility (RT-7/8) ----------------------------------------------

describe("catalogue visibility — no row ⇒ not visible and not submittable", () => {
  const types: RequestTypeCatalogueEntry[] = [
    {
      key: "printer",
      name: "Report a printer fault",
      group: "Hardware",
      position: 1,
      customerVisible: true,
      autoAccept: false,
    },
    {
      key: "vpn",
      name: "VPN access",
      group: "Access",
      position: 1,
      customerVisible: true,
      autoAccept: true,
    },
    {
      key: "internal",
      name: "Staff only",
      group: "New work",
      position: 1,
      customerVisible: false,
      autoAccept: false,
    },
  ];

  it("a crafted name with no organisation row fails the rule", () => {
    expect(isRequestTypeVisible(types[0], "org_a", [])).toBe(false);
    expect(
      isRequestTypeVisible(types[0], "org_a", [
        { organisationId: "org_b", requestTypeKey: "printer" },
      ]),
    ).toBe(false);
    expect(
      isRequestTypeVisible(types[0], "org_a", [
        { organisationId: "org_a", requestTypeKey: "printer" },
      ]),
    ).toBe(true);
  });

  it("customer_visible=false never shows, even with a row", () => {
    expect(
      isRequestTypeVisible(types[2], "org_a", [
        { organisationId: "org_a", requestTypeKey: "internal" },
      ]),
    ).toBe(false);
  });

  it("catalogueFor returns the organisation's subset, grouped and ordered (RT-8/RT-9)", () => {
    const rows = [
      { organisationId: "org_a", requestTypeKey: "printer" },
      { organisationId: "org_a", requestTypeKey: "vpn" },
      { organisationId: "org_a", requestTypeKey: "internal" },
    ];
    const result = catalogueFor("org_a", types, rows);
    expect(result.map((t) => t.key)).toEqual(["vpn", "printer"]); // Access < Hardware, then position
    // Another org sees only what its own rows grant.
    expect(catalogueFor("org_z", types, rows)).toEqual([]);
  });
});

// --- IQ-8 description rendering --------------------------------------------------

describe("renderUnmappedIntoDescription (IQ-8)", () => {
  it("renders unmapped, answered fields under the heading; skips mapped, file, and empty", () => {
    const schema: FormSchema = {
      fields: [
        { key: "summary", type: "text", label: "Summary" }, // unmapped → renders
        {
          key: "impact",
          type: "select",
          label: "Impact",
          options: ["Everyone"],
          mapsTo: { field: "priority" }, // mapped → skipped
        },
        { key: "photos", type: "file", label: "Photos" }, // file → IQ-9 handles it
        { key: "notes", type: "textarea", label: "Notes" }, // unanswered → skipped
        { key: "urgent", type: "checkbox", label: "Urgent" }, // boolean renders Yes/No
      ],
    };
    const fragment = renderUnmappedIntoDescription(schema, {
      summary: "Printer jammed in Ward 3",
      impact: "Everyone",
      urgent: true,
    });
    expect(fragment).toContain("## Additional details");
    expect(fragment).toContain("- **Summary:** Printer jammed in Ward 3");
    expect(fragment).toContain("- **Urgent:** Yes");
    expect(fragment).not.toContain("Impact"); // mapsTo → lives in priority column
    expect(fragment).not.toContain("Photos"); // attachments are IQ-9's path
    expect(fragment).not.toContain("Notes"); // unanswered
  });

  it("returns an empty string when nothing is unmapped (no empty heading)", () => {
    const schema: FormSchema = {
      fields: [
        {
          key: "impact",
          type: "select",
          label: "Impact",
          options: ["x"],
          mapsTo: { field: "priority" },
        },
      ],
    };
    expect(renderUnmappedIntoDescription(schema, { impact: "x" })).toBe("");
  });

  it("renders arrays as comma-joined lists", () => {
    const schema: FormSchema = {
      fields: [{ key: "areas", type: "select", label: "Areas" }],
    };
    const fragment = renderUnmappedIntoDescription(schema, {
      areas: ["Ward 3", "Reception"],
    });
    expect(fragment).toContain("- **Areas:** Ward 3, Reception");
  });
});

// --- IQ-18 duplicate similarity ----------------------------------------------------

describe("duplicate similarity scoring (IQ-18)", () => {
  it("an identical text scores 1; disjoint texts score far below any threshold", () => {
    expect(
      similarityScore("printer jammed ward 3", "Printer Jammed — Ward 3!"),
    ).toBe(1);
    // Not exactly 0: unrelated English strings still share incidental bigrams
    // (space+letter pairs) — the point is it lands nowhere near a suggestion threshold.
    expect(
      similarityScore("vpn password reset", "billing invoice address"),
    ).toBeLessThan(0.2);
    expect(similarityScore("", "anything")).toBe(0);
  });

  it("is word-order-insensitive and typo-tolerant (bigram Dice)", () => {
    const base = similarityScore("reset vpn password", "reset vpn password");
    const typo = similarityScore(
      "reset vpn password",
      "reset vpn passwrod", // transposition
    );
    expect(typo).toBeGreaterThan(0.5);
    expect(typo).toBeLessThan(base);
  });

  it("ranks a near-duplicate above an unrelated candidate and honours the threshold", () => {
    const suggestions = duplicateSuggestions(
      "VPN password reset for new laptop",
      [
        {
          id: "wi_1",
          title: "VPN password reset for new laptop",
          description: "cannot connect",
        },
        { id: "wi_2", title: "VPN password reset", description: "" },
        {
          id: "wi_3",
          title: "Invoice address change",
          description: "Q4 billing",
        },
      ],
      0.3,
    );
    const ids = suggestions.map((s) => s.id);
    expect(ids).toContain("wi_1");
    expect(ids).toContain("wi_2");
    expect(ids).not.toContain("wi_3"); // below threshold → not suggested
    expect(suggestions[0].id).toBe("wi_1"); // best first
    expect(suggestions[0].score).toBeGreaterThanOrEqual(
      suggestions[1]?.score ?? 0,
    );
  });

  it("ties keep input order (deterministic)", () => {
    const suggestions = duplicateSuggestions(
      "same text here",
      [
        { id: "a", title: "same text here" },
        { id: "b", title: "same text here" },
      ],
      0.5,
    );
    expect(suggestions.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
