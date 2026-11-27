import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(__dirname, "../task/editor-styles.css"),
  "utf8",
);

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}
const zIndex = (selector: string) =>
  Number(/z-index:\s*(\d+)/u.exec(ruleBody(selector))?.[1]);

describe("comment editor stacking and focus indicator", () => {
  it("stacks the @mention picker above the focused editor shell", () => {
    // The picker is appended to <body>; the focused shell is an isolated stacking
    // context, so a lower picker z-index renders it underneath the editor.
    expect(zIndex(".taskdesk-mention-popup")).toBeGreaterThan(
      zIndex(".taskdesk-comment-editor-shell:focus-within"),
    );
  });

  it("draws a token-based focus underline when the editor has keyboard focus", () => {
    // Borderless (Notion-like) surfaces keep a visible keyboard cue: a 1px --ring underline.
    const body = ruleBody(
      ".taskdesk-comment-editor-shell:has(.ProseMirror:focus-visible)::after",
    );
    expect(body).toContain("var(--ring)");
    expect(body).toContain("height: 1px");
  });

  it("tints the whole editing area on keyboard focus, motion-safe, except in the composer", () => {
    const tint = ruleBody(
      ".taskdesk-comment-editor-shell:has(.ProseMirror:focus-visible)",
    );
    expect(tint).toContain("var(--accent)");
    expect(tint).toContain("transparent");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*transition: background-color/u,
    );
    const composer = ruleBody(
      ".taskdesk-comment-composer\n    .taskdesk-comment-editor-shell:has(.ProseMirror:focus-visible)",
    );
    expect(composer).toContain("background: transparent");
  });
});
