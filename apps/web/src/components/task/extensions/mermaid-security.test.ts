import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
// Exercise the renderer Mermaid actually resolves, without adding a direct dependency.
const mermaidRequire = createRequire(require.resolve("mermaid"));
const katex = mermaidRequire("katex") as {
  renderToString: (
    expression: string,
    options: { output: "mathml"; throwOnError: boolean; displayMode?: boolean },
  ) => string;
};

describe("Mermaid's KaTeX security boundary", () => {
  it("keeps the public MathML rendering options compatible", () => {
    const rendered = katex.renderToString(String.raw`x^2 + \frac{1}{2}`, {
      output: "mathml",
      throwOnError: true,
      displayMode: true,
    });
    expect(rendered).toContain("<math");
    expect(rendered).toContain("<msup");
    expect(rendered).toContain("<mfrac");
  });

  it("does not inherit trust from Object.prototype (GHSA-238p-pmpm-9mq7)", () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "trust");
    let rendered: string;
    try {
      Object.defineProperty(Object.prototype, "trust", {
        value: true,
        configurable: true,
        writable: true,
      });
      rendered = katex.renderToString(
        String.raw`\href{javascript:alert(1)}{x}`,
        {
          output: "mathml",
          throwOnError: false,
        },
      );
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "trust", previous);
      else Reflect.deleteProperty(Object.prototype, "trust");
    }
    expect(rendered).not.toMatch(/\bhref\s*=/u);
  });
});
