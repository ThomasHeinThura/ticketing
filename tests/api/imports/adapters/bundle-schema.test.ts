import { describe, expect, it } from "vitest";
import {
  BUNDLE_CAPS,
  MAX_BUNDLE_BYTES,
  parseBundleText,
} from "../../../../apps/api/src/imports/adapters/bundle/schema";

const header = {
  t: "header",
  bundleVersion: 1,
  source: { system: "plane", instance: "plane.lan", workspace: "acme" },
};
const base = [
  header,
  { t: "person", id: "u1", email: "a@example.com", name: "A" },
  { t: "person", id: "u2", name: "No Email" },
  { t: "project", id: "p1", key: "WEB", name: "Web" },
  { t: "state", project: "p1", id: "s1", name: "Todo", group: "unstarted" },
  { t: "label", project: "p1", id: "l1", name: "bug" },
];
const item = (extra: Record<string, unknown> = {}) => ({
  t: "item",
  project: "p1",
  id: "i1",
  title: "First",
  state: "s1",
  ...extra,
});
const ndjson = (lines: unknown[]) =>
  lines.map((l) => JSON.stringify(l)).join("\n");
const parse = (lines: unknown[]) => parseBundleText(ndjson(lines));

describe("parseBundleText", () => {
  it("accepts a valid bundle and keeps item order", () => {
    const result = parse([
      ...base,
      item({
        labels: ["l1"],
        assignee: "u1",
        createdBy: "u2",
        comments: [{ id: "c1", author: "u1", body: "hi" }],
      }),
      item({
        id: "i2",
        parent: "i1",
        relations: [{ type: "blocks", target: "i1" }],
      }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(result.projects.get("p1")?.key).toBe("WEB");
  });

  it("tolerates blank lines and CRLF", () => {
    const text = `${ndjson([...base, item()]).replaceAll("\n", "\r\n\r\n")}\r\n`;
    expect(parseBundleText(text).errors).toEqual([]);
  });

  it("addresses invalid lines by number without echoing content", () => {
    const secret = "do-not-echo-me";
    const text = `${ndjson(base)}\nnot json ${secret}\n${JSON.stringify(item({ title: "", extra: secret }))}\n${JSON.stringify({ t: "wat" })}`;
    const result = parseBundleText(text);
    expect(result.errors.map((e) => [e.line, e.code])).toEqual([
      [7, "invalid_json"],
      [8, "invalid_line"],
      [9, "unknown_line_type"],
    ]);
    expect(JSON.stringify(result.errors)).not.toContain(secret);
  });

  it("requires the header first, once, with bundleVersion 1", () => {
    expect(parse([item(), header]).errors.map((e) => e.code)).toContain(
      "header_not_first",
    );
    expect(parse([...base, header]).errors.map((e) => e.code)).toContain(
      "duplicate_header",
    );
    expect(parse([{ ...header, bundleVersion: 2 }]).errors[0]?.code).toBe(
      "invalid_line",
    );
    expect(parse([]).errors.map((e) => e.code)).toContain("header_missing");
  });

  it("rejects duplicate ids and keys", () => {
    const result = parse([
      ...base,
      { t: "person", id: "u1" },
      { t: "project", id: "p2", key: "web", name: "Dup key" },
      item(),
      item(),
    ]);
    expect(result.errors.filter((e) => e.code === "duplicate_id")).toHaveLength(
      3,
    );
  });

  it("rejects dangling people, states, labels and projects", () => {
    const result = parse([
      ...base,
      item({
        state: "nope",
        labels: ["nope"],
        assignee: "nope",
        comments: [{ id: "c", author: "nope", body: "x" }],
      }),
      item({ id: "i2", project: "nope" }),
      { t: "membership", project: "p1", person: "nope", role: "member" },
    ]);
    expect(result.errors.map((e) => `${e.code}:${e.path}`).sort()).toEqual(
      [
        "dangling_reference:assignee",
        "dangling_reference:comments.author",
        "dangling_reference:labels",
        "dangling_reference:person",
        "dangling_reference:project",
        "dangling_reference:state",
        "dangling_reference:state",
      ].sort(),
    );
  });

  it("rejects a state or label of another project", () => {
    const result = parse([
      ...base,
      { t: "project", id: "p2", key: "OPS", name: "Ops" },
      item({ project: "p2" }),
    ]);
    expect(result.errors.map((e) => e.path)).toContain("state");
  });

  it("warns, but does not fail, on an item reference outside the file", () => {
    const result = parse([
      ...base,
      item({
        parent: "elsewhere",
        relations: [{ type: "relates", target: "x" }],
      }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "unresolved_item_reference",
      "unresolved_item_reference",
    ]);
  });

  it("rejects self references", () => {
    const result = parse([
      ...base,
      item({ parent: "i1", relations: [{ type: "blocks", target: "i1" }] }),
    ]);
    expect(result.errors.map((e) => e.code)).toEqual([
      "self_reference",
      "self_reference",
    ]);
  });

  it("enforces the record v2 caps", () => {
    const comments = Array.from(
      { length: BUNDLE_CAPS.comments + 1 },
      (_, n) => ({
        id: `c${n}`,
        body: "x",
      }),
    );
    expect(parse([...base, item({ comments })]).errors[0]?.code).toBe(
      "invalid_line",
    );
    const long = "x".repeat(BUNDLE_CAPS.commentChars + 1);
    expect(
      parse([...base, item({ comments: [{ id: "c", body: long }] })]).errors,
    ).toHaveLength(1);
    const relations = Array.from(
      { length: BUNDLE_CAPS.relations + 1 },
      (_, n) => ({
        type: "relates",
        target: `t${n}`,
      }),
    );
    expect(parse([...base, item({ relations })]).errors).toHaveLength(1);
  });

  it("refuses unsafe URLs and non-ISO dates", () => {
    for (const bad of [
      item({ url: "http://plane.lan/x" }),
      item({ url: "https://u:p@plane.lan/x" }),
      item({ url: "https://plane.lan/x?api_key=abc" }),
      item({ createdAt: "yesterday" }),
      item({
        attachments: [{ id: "a", url: "https://x.test/a", filename: "a/b" }],
      }),
    ])
      expect(parse([...base, bad]).errorCount, JSON.stringify(bad)).toBe(1);
  });

  it("accepts a person without an email and warns on duplicate emails", () => {
    const result = parse([
      ...base,
      { t: "person", id: "u3", email: "A@example.com" },
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]?.code).toBe("duplicate_person_email");
  });

  it("is deterministic and caps the reported issues", () => {
    const lines = [header, ...Array.from({ length: 80 }, () => ({ t: "wat" }))];
    const a = parseBundleText(ndjson(lines));
    const b = parseBundleText(ndjson(lines));
    expect(a).toEqual(b);
    expect(a.errors).toHaveLength(50);
    expect(a.errorCount).toBe(80);
  });

  it("refuses an oversize file before parsing", () => {
    const result = parseBundleText(" ".repeat(MAX_BUNDLE_BYTES + 1));
    expect(result.errors).toEqual([{ line: 0, code: "bundle_too_large" }]);
  });
});
