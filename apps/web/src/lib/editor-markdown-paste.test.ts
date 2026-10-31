import { describe, expect, it } from "vitest";
import { looksLikeMarkdown, withSafeLinks } from "./editor-markdown-paste";

describe("looksLikeMarkdown", () => {
  it.each([
    ["an ATX heading", "# Release notes"],
    ["a level-three heading after prose", "Intro line\n### Details"],
    ["a bullet list", "- first\n- second"],
    ["a star list", "* one\n* two"],
    ["a loose list", "- one\n\n- two"],
    ["a list with a tag inside code", "- fix the `<Input>` component\n- ship"],
    ["a task list item", "- [ ] follow up"],
    ["an ordered list", "1. first\n2. second"],
    ["a parenthesised ordered list", "1) first\n2) second"],
    ["a block quote", "> quoted\n> reply"],
    ["a code fence", "```ts\nconst a = 1;\n```"],
    ["a tilde fence", "~~~\ncode\n~~~"],
    ["a table", "| Name | Role |\n| --- | :---: |\n| Ada | Admin |"],
    ["a table without outer pipes", "Name | Role\n--- | ---"],
    ["an inline link", "See [the guide](https://example.com/guide) first."],
    ["a relative link", "[Pages](/projects/abc/pages)"],
    ["CRLF line endings", "Intro\r\n## Heading"],
  ])("accepts %s", (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    ["empty text", ""],
    ["whitespace", "  \n\t"],
    ["plain prose", "Please review the attached proposal by Friday."],
    ["a hashtag", "#release is trending"],
    ["a heading marker without text", "#"],
    ["seven hashes", "####### not a heading"],
    ["a dash inside a sentence", "Costs - including tax - went up."],
    ["an em-dash signature", "-- Ada"],
    ["an email separator", "-----Original Message-----"],
    ["a year followed by a full stop", "2024. A good year"],
    ["emphasis only", "This is *really* **important**"],
    ["a comparison", "Price > 5 and < 10"],
    ["a bare URL", "https://example.com/path"],
    ["brackets without a link target", "[draft] (see below)"],
    ["a single pipe row", "a | b | c"],
    ["two dashes", "--"],
    ["an indented code-looking line", "    const a = 1;"],
    ["a single bullet", "* only item"],
    ["a single ordered line", "1) Call the customer"],
    ["a comparison quote", "> 5 users affected"],
    ["a single quoted line", "> quoted reply"],
    ["a thematic break", "Above\n---\nBelow"],
    ["a spaced thematic break", "* * *"],
    ["an unclosed code fence", "```\nconst a = 1;"],
    [
      "a terminal transcript",
      "Run this:\n> npm install\n    at foo (bar.js:1)\nsee __init__ and my_var_name_x",
    ],
    ["a diff without a header", "  context\n- old line\n+ new line"],
    [
      "a git diff",
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n- a\n- b\n+ c",
    ],
    [
      "a list naming HTML-like tags",
      "- Fix the <Input> component\n- check <span> rendering",
    ],
    ["a heading with a tag", "# Title <div>"],
  ])("rejects %s", (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe("withSafeLinks", () => {
  const linked = (href: string) => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "x",
            marks: [{ type: "link", attrs: { href } }],
          },
        ],
      },
    ],
  });
  const marksOf = (doc: ReturnType<typeof linked>) =>
    withSafeLinks(doc).content?.[0]?.content?.[0]?.marks;

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "",
  ])("drops a link to %j and keeps its text", (href) => {
    const doc = withSafeLinks(linked(href));
    expect(doc.content?.[0]?.content?.[0]).toMatchObject({ text: "x" });
    expect(marksOf(linked(href))).toEqual([]);
  });

  it.each([
    "https://example.com",
    "http://example.com/a",
    "mailto:ada@example.com",
    "tel:+4912345",
    "/projects/abc/pages",
    "#section",
  ])("keeps a link to %j", (href) => {
    expect(marksOf(linked(href))).toEqual([{ type: "link", attrs: { href } }]);
  });

  it("drops images with an unsafe source and keeps other marks", () => {
    const doc = withSafeLinks({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "javascript:alert(1)" } },
            { type: "image", attrs: { src: "https://example.com/a.png" } },
            { type: "text", text: "b", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    expect(doc.content?.[0]?.content).toEqual([
      { type: "image", attrs: { src: "https://example.com/a.png" } },
      { type: "text", text: "b", marks: [{ type: "bold" }] },
    ]);
  });
});
