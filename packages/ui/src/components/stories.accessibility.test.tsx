import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectNoA11yViolations } from "../test/a11y";

type StoryModule = {
  default: {
    component?: (props: Record<string, unknown>) => ReactNode;
    args?: Record<string, unknown>;
    render?: (args: Record<string, unknown>) => ReactNode;
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

type Csf2Story = ((args: Record<string, unknown>) => ReactNode) & {
  args?: Record<string, unknown>;
};

function resolveStoryElement(
  meta: StoryModule["default"],
  exportedStory: unknown,
): ReactNode {
  let story: Story;

  if (typeof exportedStory === "function") {
    const csf2Story = exportedStory as Csf2Story;
    story = { args: csf2Story.args, render: csf2Story };
  } else if (
    typeof exportedStory === "object" &&
    exportedStory !== null &&
    !Array.isArray(exportedStory)
  ) {
    const candidate = exportedStory as Record<string, unknown>;
    const supportedKeys = new Set([
      "args",
      "render",
      "decorators",
      "loaders",
      "play",
    ]);
    const unsupportedKeys = Object.keys(candidate).filter(
      (key) => !supportedKeys.has(key),
    );
    if (unsupportedKeys.length > 0) {
      throw new Error(
        `Unsupported story export fields: ${unsupportedKeys.join(", ")}`,
      );
    }
    if (
      (candidate.args !== undefined &&
        (typeof candidate.args !== "object" ||
          candidate.args === null ||
          Array.isArray(candidate.args))) ||
      (candidate.render !== undefined && typeof candidate.render !== "function")
    ) {
      throw new Error("Malformed Storybook story export");
    }
    story = candidate as Story;
  } else {
    throw new Error("Named Storybook export is not a supported story");
  }

  const args = { ...meta.args, ...story.args };
  const renderStory = story.render ?? meta.render;
  if (renderStory) return renderStory(args);
  if (meta.component) return createElement(meta.component, args);
  throw new Error("Story has no render function or component");
}

const storyModules = import.meta.glob<StoryModule>("./*.stories.tsx", {
  eager: true,
});

afterEach(cleanup);

describe("Storybook story export handling", () => {
  it("renders a CSF2 function story with inherited meta args", () => {
    const element = resolveStoryElement(
      { args: { label: "CSF2 action" } },
      (args) => <button type="button">{args.label as string}</button>,
    );
    const { getByRole } = render(element as ReactNode);
    expect(getByRole("button", { name: "CSF2 action" })).toBeInTheDocument();
  });

  it("rejects a malformed named export instead of skipping it", () => {
    expect(() => resolveStoryElement({}, "not a story")).toThrow(
      "Named Storybook export is not a supported story",
    );
  });
});

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

      it(`${modulePath} — ${exportName}`, async () => {
        // The UI stories currently use only args and render functions. Fail
        // closed if a future story needs Storybook-only setup, so this suite
        // cannot silently claim coverage while omitting a decorator, loader,
        // or play-driven state.
        expect(meta.decorators ?? []).toEqual([]);
        expect(meta.loaders ?? []).toEqual([]);
        const story =
          typeof exportedStory === "function"
            ? ({ render: exportedStory } as Story)
            : typeof exportedStory === "object" && exportedStory !== null
              ? (exportedStory as Story)
              : undefined;
        expect(story, "named export must be a supported story").toBeDefined();
        expect(story?.decorators ?? []).toEqual([]);
        expect(story?.loaders ?? []).toEqual([]);
        expect(story?.play).toBeUndefined();

        const element = resolveStoryElement(meta, exportedStory);
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
