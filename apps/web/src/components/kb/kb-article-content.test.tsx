import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  customerView,
  documentHeadings,
  hasInternalContent,
  KbArticleContent,
  KbTableOfContents,
} from "./kb-article-content";

afterEach(cleanup);

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const doc = (...content: unknown[]) => ({ type: "doc", content });

describe("KbArticleContent", () => {
  it("renders the editor's nodes as semantic elements", () => {
    const { container } = render(
      <KbArticleContent
        body={doc(
          { type: "heading", attrs: { level: 2 }, content: [text("Reset")] },
          {
            type: "paragraph",
            content: [text("Use "), text("the portal", [{ type: "bold" }])],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [{ type: "paragraph", content: [text("one")] }],
              },
            ],
          },
        )}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Reset");
    expect(container.querySelector("strong")?.textContent).toBe("the portal");
    expect(container.querySelector("ul li")?.textContent).toBe("one");
  });

  it("never renders a script-bearing link or image, and never injects markup", () => {
    const { container } = render(
      <KbArticleContent
        body={doc(
          {
            type: "paragraph",
            content: [
              text("click", [
                { type: "link", attrs: { href: "javascript:alert(1)" } },
              ]),
              text("<img src=x onerror=alert(1)>"),
            ],
          },
          { type: "image", attrs: { src: "javascript:alert(1)" } },
          { type: "image", attrs: { src: "http://insecure.example/x.png" } },
          {
            type: "image",
            attrs: { src: "https://cdn.example/ok.png", alt: "ok" },
          },
        )}
      />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example/ok.png",
    );
    // The angle-bracket text is shown as text, not parsed.
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("opens safe links in a new tab without a referrer", () => {
    const { container } = render(
      <KbArticleContent
        body={doc({
          type: "paragraph",
          content: [
            text("docs", [
              { type: "link", attrs: { href: "https://example.com/a" } },
            ]),
          ],
        })}
      />,
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("renders a work item reference only through the staff renderer", () => {
    const body = doc({
      type: "paragraph",
      content: [{ type: "taskdeskIssueLink", attrs: { issueKey: "OPS-1" } }],
    });
    const { container, rerender } = render(<KbArticleContent body={body} />);
    expect(container.textContent).not.toContain("OPS-1");
    rerender(
      <KbArticleContent
        body={body}
        renderers={{ issueLink: ({ issueKey }) => <b>{issueKey}</b> }}
      />,
    );
    expect(container.textContent).toContain("OPS-1");
  });

  it("tolerates a missing or malformed body", () => {
    expect(() => render(<KbArticleContent body={null} />)).not.toThrow();
    expect(() => render(<KbArticleContent body="x" />)).not.toThrow();
  });
});

describe("customer view and table of contents", () => {
  const body = doc(
    { type: "heading", attrs: { level: 1 }, content: [text("Overview")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Overview")] },
    { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
    {
      type: "callout",
      attrs: { variant: "internal" },
      content: [{ type: "paragraph", content: [text("secret")] }],
    },
    {
      type: "paragraph",
      content: [{ type: "taskdeskIssueLink", attrs: { issueKey: "OPS-1" } }],
    },
  );

  it("removes internal callouts and work item references from the preview", () => {
    expect(JSON.stringify(customerView(body))).not.toContain("secret");
    expect(JSON.stringify(customerView(body))).not.toContain("OPS-1");
    expect(hasInternalContent(body)).toBe(true);
    expect(
      hasInternalContent(doc({ type: "paragraph", content: [text("a")] })),
    ).toBe(false);
  });

  it("gives repeated headings unique anchors and shows the contents from three headings", () => {
    expect(documentHeadings(body).map((h) => h.id)).toEqual([
      "overview",
      "overview-2",
      "steps",
    ]);
    render(<KbTableOfContents body={body} label="On this page" />);
    expect(screen.getAllByRole("link")).toHaveLength(3);
    cleanup();
    const { container } = render(
      <KbTableOfContents body={doc()} label="On this page" />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("what the server removed on save", () => {
  it("names the node types that did not come back", async () => {
    const { removedNodeTypes } = await import("./kb-article-content");
    const sent = doc(
      { type: "paragraph", content: [text("a")] },
      { type: "mermaidBlock", attrs: { code: "graph TD" } },
      { type: "shikiCodeBlock", content: [text("x")] },
    );
    const saved = doc(
      { type: "paragraph", content: [text("a")] },
      { type: "codeBlock", content: [text("x")] },
    );
    expect(removedNodeTypes(sent, saved)).toEqual(["mermaidBlock"]);
    expect(removedNodeTypes(saved, saved)).toEqual([]);
  });
});
