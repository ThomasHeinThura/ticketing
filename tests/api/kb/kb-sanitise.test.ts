import { describe, expect, it } from "vitest";
import {
  headingsOf,
  KbBodyError,
  type KbNode,
  MAX_BODY_BYTES,
  safeUrl,
  sanitiseKbBody,
  toCustomerBody,
} from "../../../apps/api/src/kb/sanitise";

const doc = (...content: unknown[]) => ({ type: "doc", content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

describe("KB-5 body sanitiser", () => {
  it("keeps the nodes and marks the editor emits", () => {
    const input = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Reset")] },
      paragraph(text("Hello ", [{ type: "bold" }]), text("world")),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(text("one"))] }],
      },
    );
    const { doc: out, text: plain } = sanitiseKbBody(input);
    expect(out).toEqual(input);
    expect(plain).toBe("Reset Hello world one");
  });

  it("refuses anything that is not a document", () => {
    expect(() => sanitiseKbBody("<p>hi</p>")).toThrow(KbBodyError);
    expect(() => sanitiseKbBody({ type: "paragraph" })).toThrow(KbBodyError);
    expect(() => sanitiseKbBody(null)).toThrow(KbBodyError);
  });

  it("drops script-bearing link and image URLs", () => {
    const { doc: out } = sanitiseKbBody(
      doc(
        paragraph(
          text("bad", [
            { type: "link", attrs: { href: "javascript:alert(1)" } },
          ]),
          text("data", [
            { type: "link", attrs: { href: "data:text/html,<script>" } },
          ]),
          text("good", [
            { type: "link", attrs: { href: "https://example.com/a" } },
          ]),
        ),
        {
          type: "image",
          attrs: { src: "javascript:alert(1)", alt: "x" },
        },
        { type: "image", attrs: { src: "http://insecure.example/x.png" } },
        {
          type: "image",
          attrs: { src: "https://cdn.example/x.png", alt: "ok" },
        },
      ),
    );
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain("javascript");
    expect(serialised).not.toContain("data:text");
    expect(serialised).not.toContain("insecure");
    expect(serialised).toContain("https://example.com/a");
    expect(serialised).toContain("https://cdn.example/x.png");
    expect(serialised).toContain("noopener");
  });

  it("unwraps unknown wrappers and drops unknown leaves, never keeping raw attributes", () => {
    const { doc: out } = sanitiseKbBody(
      doc(
        {
          type: "iframe",
          attrs: { src: "https://evil.example" },
          content: [paragraph(text("kept"))],
        },
        { type: "script", attrs: { html: "<script>" } },
        {
          type: "paragraph",
          attrs: { onclick: "x()", style: "color:red" },
          content: [text("p")],
        },
      ),
    );
    expect(JSON.stringify(out)).not.toContain("evil");
    expect(JSON.stringify(out)).not.toContain("onclick");
    expect(JSON.stringify(out)).toContain("kept");
    expect(out.content?.some((n) => n.type === "script")).toBe(false);
  });

  it("rejects NUL bytes, oversize, deep and huge documents", () => {
    expect(() => sanitiseKbBody(doc(paragraph(text("a\u0000b"))))).toThrow(
      KbBodyError,
    );
    expect(() =>
      sanitiseKbBody(doc(paragraph(text("x".repeat(MAX_BODY_BYTES + 1))))),
    ).toThrow(KbBodyError);
    let nested: unknown = paragraph(text("deep"));
    for (let i = 0; i < 40; i++)
      nested = { type: "blockquote", content: [nested] };
    expect(() => sanitiseKbBody(doc(nested))).toThrow(KbBodyError);
  });

  it("does not mistake an escaped backslash sequence for a NUL", () => {
    expect(() =>
      sanitiseKbBody(doc(paragraph(text("write \\u0000 literally")))),
    ).not.toThrow();
  });

  it("normalises an empty body to one paragraph", () => {
    expect(sanitiseKbBody(doc()).doc.content).toEqual([{ type: "paragraph" }]);
  });

  it("safeUrl accepts http(s), mailto, tel and paths only", () => {
    expect(safeUrl("https://a.example", ["https:"])).toBe("https://a.example");
    expect(safeUrl("//evil.example", ["/", "https:"])).toBeNull();
    expect(safeUrl("/docs/a", ["/"])).toBe("/docs/a");
    expect(safeUrl("JaVaScRiPt:1", ["https:"])).toBeNull();
    expect(safeUrl("https://a.example/ b", ["https:"])).toBeNull();
    expect(safeUrl(5, ["https:"])).toBeNull();
  });
});

describe("customer view of a body", () => {
  it("removes internal callouts and work item references, keeps public callouts", () => {
    const { doc: stored } = sanitiseKbBody(
      doc(
        paragraph(
          text("See "),
          {
            type: "taskdeskIssueLink",
            attrs: { issueKey: "OPS-12", taskId: "abc", url: "/agent/x" },
          },
          text(" now"),
        ),
        {
          type: "callout",
          attrs: { variant: "internal" },
          content: [paragraph(text("secret runbook note"))],
        },
        {
          type: "callout",
          attrs: { variant: "warning" },
          content: [paragraph(text("Public warning"))],
        },
      ),
    );
    expect(JSON.stringify(stored)).toContain("OPS-12");
    const customer = JSON.stringify(toCustomerBody(stored));
    expect(customer).not.toContain("OPS-12");
    expect(customer).not.toContain("secret runbook");
    expect(customer).toContain("Public warning");
    expect(customer).toContain("See ");
  });

  it("never returns an empty document", () => {
    const stored: KbNode = {
      type: "doc",
      content: [
        { type: "callout", attrs: { variant: "internal" }, content: [] },
      ],
    };
    expect(toCustomerBody(stored).content).toEqual([{ type: "paragraph" }]);
  });

  it("lists headings for the table of contents", () => {
    const { doc: stored } = sanitiseKbBody(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [text("A")] },
        { type: "heading", attrs: { level: 3 }, content: [text("B")] },
      ),
    );
    expect(headingsOf(stored)).toEqual([
      { level: 1, text: "A" },
      { level: 3, text: "B" },
    ]);
  });
});
