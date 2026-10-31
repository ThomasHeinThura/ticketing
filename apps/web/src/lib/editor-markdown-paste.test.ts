import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./editor-markdown-paste";

describe("looksLikeMarkdown", () => {
  it.each([
    ["an ATX heading", "# Release notes"],
    ["a level-three heading after prose", "Intro line\n### Details"],
    ["a bullet list", "- first\n- second"],
    ["a star bullet", "* only item"],
    ["a task list item", "- [ ] follow up"],
    ["an ordered list", "1. first\n2. second"],
    ["a parenthesised ordered item", "3) third"],
    ["a block quote", "> quoted reply"],
    ["a code fence", "```ts\nconst a = 1;\n```"],
    ["a tilde fence", "~~~\ncode\n~~~"],
    ["a thematic break", "Above\n---\nBelow"],
    ["a spaced thematic break", "* * *"],
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
  ])("rejects %s", (_name, text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});
