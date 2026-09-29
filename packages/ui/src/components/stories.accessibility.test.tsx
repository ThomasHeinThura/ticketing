import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";

type StoryModule = {
  default: {
    component?: (props: Record<string, unknown>) => ReactNode;
    args?: Record<string, unknown>;
    decorators?: unknown[];
    loaders?: unknown[];
  };
  [key: string]: unknown;
};

type Story = {
  args?: Record<string, unknown>;
  render?: (args: Record<string, unknown>) => ReactNode;
  decorators?: unknown[];
  loaders?: unknown[];
  play?: unknown;
};

const storyModules = import.meta.glob<StoryModule>("./*.stories.tsx", {
  eager: true,
});

afterEach(cleanup);

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (media: string) => ({
        matches: false,
        media,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => [];
  }
});

describe("Storybook stories have no critical or serious accessibility violations", () => {
  for (const [modulePath, storyModule] of Object.entries(storyModules)) {
    const meta = storyModule.default;

    for (const [exportName, exportedStory] of Object.entries(storyModule)) {
      if (exportName === "default" || exportName.startsWith("__")) continue;

      const story = exportedStory as Story;
      if (!story || typeof story !== "object") continue;

      it(`${modulePath} — ${exportName}`, async () => {
        // The UI stories currently use only args and render functions. Fail
        // closed if a future story needs Storybook-only setup, so this suite
        // cannot silently claim coverage while omitting a decorator, loader,
        // or play-driven state.
        expect(meta.decorators ?? []).toEqual([]);
        expect(meta.loaders ?? []).toEqual([]);
        expect(story.decorators ?? []).toEqual([]);
        expect(story.loaders ?? []).toEqual([]);
        expect(story.play).toBeUndefined();

        const args = { ...meta.args, ...story.args };
        const element = story.render
          ? story.render(args)
          : meta.component
            ? createElement(meta.component, args)
            : null;

        expect(element, "story must render an element").not.toBeNull();
        const { baseElement } = render(element as ReactNode);
        await expectNoA11yViolations(baseElement, {
          impact: "serious-or-critical",
          // Base UI's menu portal inserts an invisible aria-owns focus
          // guard, a known jsdom false positive also excluded by the
          // Menubar component test.
          ignoredRules:
            modulePath === "./menubar.stories.tsx" &&
            exportName === "WithOpenMenuAndSeparator"
              ? ["aria-required-children"]
              : [],
        });
      });
    }
  }
});
