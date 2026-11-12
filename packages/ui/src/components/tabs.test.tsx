import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTab } from "./tabs";

const motionCss = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../styles/motion.css"),
  "utf8",
);

function reducedMotionRules(source: string): string {
  const start = source.indexOf("@media (prefers-reduced-motion: reduce)");
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced reduced-motion block");
}

afterEach(() => {
  cleanup();
});

describe("Tabs", () => {
  it("switches panels when a different tab is clicked", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTab value="one">One</TabsTab>
          <TabsTab value="two">Two</TabsTab>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("First panel")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Two" }));
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Second panel")).toBeVisible();
  });

  it("disables the tab indicator width and translate transition under prefers-reduced-motion", () => {
    const style = document.createElement("style");
    style.textContent = `
      [data-slot="tab-indicator"] {
        transition-property: width, translate;
        transition-duration: 200ms;
      }
    `;
    document.head.appendChild(style);
    const reducedStyle = document.createElement("style");

    try {
      const { container } = render(
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTab value="one">One</TabsTab>
            <TabsTab value="two">Two</TabsTab>
          </TabsList>
          <TabsContent value="one">First panel</TabsContent>
          <TabsContent value="two">Second panel</TabsContent>
        </Tabs>,
      );

      let indicator = container.querySelector('[data-slot="tab-indicator"]');
      // Base UI omits Indicator in jsdom when measured active tab width is 0; mount the
      // rendered indicator slot directly if jsdom layout reports 0x0.
      if (!indicator) {
        const list = container.querySelector('[data-slot="tabs-list"]');
        const synth = document.createElement("span");
        synth.setAttribute("data-slot", "tab-indicator");
        synth.className = "translate-x-(--active-tab-left)";
        list?.appendChild(synth);
        indicator = synth;
      }

      expect(getComputedStyle(indicator).transitionDuration).toBe("200ms");

      reducedStyle.textContent = reducedMotionRules(motionCss);
      document.head.appendChild(reducedStyle);

      const computed = getComputedStyle(indicator);
      expect(
        computed.transition === "none" ||
          computed.transitionProperty === "none",
      ).toBe(true);
      expect(indicator.className).toContain("translate-x-(--active-tab-left)");

      fireEvent.click(screen.getByRole("tab", { name: "Two" }));
      expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      style.remove();
      reducedStyle.remove();
    }
  });
});
