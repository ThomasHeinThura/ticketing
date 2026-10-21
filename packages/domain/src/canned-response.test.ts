import { describe, expect, it } from "vitest";
import { resolveCannedResponseBody } from "./canned-response.js";

const context = {
  requesterName: "A <B>",
  workItemKey: "OPS-42",
  dueDate: "2026-10-25",
};
const text = (value: string, extra = {}) => ({
  type: "text",
  text: value,
  ...extra,
});
const doc = (content: unknown[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});

describe("CA-19a canned-response interpolation", () => {
  it("resolves all tokens with optional whitespace as literal text", () => {
    expect(
      resolveCannedResponseBody(
        doc([
          text(
            "Hi {{ requester.name }}: {{work_item.key}} due {{ work_item.due_date}}.",
          ),
        ]),
        context,
      ),
    ).toEqual(doc([text("Hi A <B>: OPS-42 due 2026-10-25.")]));
  });
  it("preserves unknown expressions, attributes and link destinations", () => {
    const marks = [
      {
        type: "link",
        attrs: { href: "https://example.test/{{work_item.key}}" },
      },
    ];
    const template = doc([
      text("{{unknown}} {{work_item.key.toUpperCase()}} {{work_item.key}}", {
        marks,
      }),
    ]);
    const original = structuredClone(template);
    expect(resolveCannedResponseBody(template, context)).toEqual(
      doc([
        text("{{unknown}} {{work_item.key.toUpperCase()}} OPS-42", { marks }),
      ]),
    );
    expect(template).toEqual(original);
  });
  it("does not recursively expand requester-controlled text", () => {
    expect(
      resolveCannedResponseBody(
        doc([text("{{requester.name}} {{work_item.key}}")]),
        { ...context, requesterName: "{{work_item.key}}" },
      ),
    ).toEqual(doc([text("{{work_item.key}} OPS-42")]));
  });
  it("keeps formatting before, inside and after a token split across text nodes", () => {
    const bold = { marks: [{ type: "bold" }] };
    expect(
      resolveCannedResponseBody(
        doc([
          text("Hello {{requester.", bold),
          text("name}}! {{work_item.key}}"),
        ]),
        context,
      ),
    ).toEqual(doc([text("Hello A <B>", bold), text("! OPS-42")]));
  });
  it("handles several matches spanning multiple nodes and leaves suffix marks intact", () => {
    const italic = { marks: [{ type: "italic" }] };
    expect(
      resolveCannedResponseBody(
        doc([
          text("{{work_"),
          text("item.key}} + {{requester.name", italic),
          text("}}!"),
        ]),
        context,
      ),
    ).toEqual(doc([text("OPS-42"), text(" + A <B>", italic), text("!")]));
  });
  it("removes empty text nodes for missing optional values without deleting paragraphs", () => {
    expect(
      resolveCannedResponseBody(
        doc([text("{{requester.name}}{{work_item.due_date}}")]),
        { ...context, requesterName: null, dueDate: null },
      ),
    ).toEqual(doc([]));
  });
  it("does not join tokens over hard breaks, mentions or paragraph boundaries", () => {
    const template = doc([
      text("{{work_"),
      { type: "hardBreak" },
      text("item.key}}"),
      { type: "mention", attrs: { label: "{{requester.name}}" } },
    ]);
    expect(resolveCannedResponseBody(template, context)).toEqual(template);
    const paragraphs = {
      type: "doc",
      content: [
        { type: "paragraph", content: [text("{{work_")] },
        { type: "paragraph", content: [text("item.key}}")] },
      ],
    };
    expect(resolveCannedResponseBody(paragraphs, context)).toEqual(paragraphs);
  });
  it("walks nested lists and tolerates absent or non-document input", () => {
    expect(
      resolveCannedResponseBody(
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [doc([text("{{work_item.key}}")])] },
          ],
        },
        context,
      ),
    ).toEqual({
      type: "bulletList",
      content: [{ type: "listItem", content: [doc([text("OPS-42")])] }],
    });
    for (const value of [
      null,
      undefined,
      "literal",
      3,
      [],
      { type: "paragraph" },
    ])
      expect(resolveCannedResponseBody(value, context)).toEqual(value);
    expect(
      resolveCannedResponseBody(text("{{work_item.key}}"), context),
    ).toEqual(text("OPS-42"));
    expect(
      resolveCannedResponseBody(text("{{requester.name}}"), {
        ...context,
        requesterName: null,
      }),
    ).toBeNull();
  });
});
