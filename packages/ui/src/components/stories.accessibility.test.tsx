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
  decorators?: unknown[];
  loaders?: unknown[];
  play?: unknown;
  [key: string]: unknown;
};

function normalizeStoryExport(exportedStory: unknown): Story {
  if (typeof exportedStory === "function") {
    const csf2Story = exportedStory as Csf2Story;
    // Check every own property, including non-enumerable properties. The
    // standard function properties are the only accepted non-Storybook keys.
    const supportedFunctionKeys = new Set([
      "args",
      "decorators",
      "loaders",
      "play",
    ]);
    const standardFunctionKeys = new Set([
      "length",
      "name",
      "arguments",
      "caller",
      "prototype",
    ]);
    const unsupportedFunctionKeys = Reflect.ownKeys(csf2Story).filter(
      (key) =>
        typeof key !== "string" ||
        (!supportedFunctionKeys.has(key) && !standardFunctionKeys.has(key)),
    );
    if (unsupportedFunctionKeys.length > 0) {
      throw new Error(
        `Unsupported CSF2 function story fields: ${unsupportedFunctionKeys
          .map((key) => (typeof key === "symbol" ? key.toString() : key))
          .join(", ")}`,
      );
    }
    if (
      (csf2Story.args !== undefined &&
        (typeof csf2Story.args !== "object" ||
          csf2Story.args === null ||
          Array.isArray(csf2Story.args))) ||
      (csf2Story.decorators !== undefined &&
        (!Array.isArray(csf2Story.decorators) ||
          csf2Story.decorators.length > 0)) ||
      (csf2Story.loaders !== undefined &&
        (!Array.isArray(csf2Story.loaders) || csf2Story.loaders.length > 0)) ||
      csf2Story.play !== undefined
    ) {
      throw new Error("Unsupported CSF2 story annotations");
    }
    return {
      args: csf2Story.args,
      render: csf2Story,
      decorators: csf2Story.decorators,
      loaders: csf2Story.loaders,
      play: csf2Story.play,
    };
  }

  if (
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
    return candidate as Story;
  }

  throw new Error("Named Storybook export is not a supported story");
}

function resolveStoryElement(
  meta: StoryModule["default"],
  exportedStory: unknown,
): ReactNode {
  const story = normalizeStoryExport(exportedStory);
  const args = { ...meta.args, ...story.args };
  const renderStory = story.render ?? meta.render;
  if (renderStory) return renderStory(args);
  if (meta.component) return createElement(meta.component, args);
  throw new Error("Story has no render function or component");
}

const storyModules = import.meta.glob<StoryModule>("../**/*.stories.{ts,tsx}", {
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

  it("renders a CSF2 function story with attached args", () => {
    const story = Object.assign(
      (args: Record<string, unknown>) => (
        <button type="button">{args.label as string}</button>
      ),
      { args: { label: "Attached args" } },
    );
    const element = resolveStoryElement({}, story);
    const { getByRole } = render(element as ReactNode);
    expect(getByRole("button", { name: "Attached args" })).toBeInTheDocument();
  });

  it("rejects a malformed named export instead of skipping it", () => {
    expect(() => resolveStoryElement({}, "not a story")).toThrow(
      "Named Storybook export is not a supported story",
    );
  });

  it.each([
    ["decorators", { decorators: [() => null] }],
    ["loaders", { loaders: [() => ({})] }],
    ["play", { play: async () => undefined }],
    ["unknown annotation", { customAnnotation: true }],
  ])("rejects unsupported CSF2 %s annotations", (_label, annotations) => {
    const story = Object.assign(
      (args: Record<string, unknown>) => (
        <button type="button">{args.label as string}</button>
      ),
      annotations,
    );
    expect(() => normalizeStoryExport(story)).toThrow();
  });

  it("rejects unknown non-enumerable CSF2 function properties", () => {
    const story = (args: Record<string, unknown>) => (
      <button type="button">{args.label as string}</button>
    );
    Object.defineProperty(story, "customAnnotation", {
      value: true,
      enumerable: false,
    });
    expect(() => normalizeStoryExport(story)).toThrow(
      "Unsupported CSF2 function story fields: customAnnotation",
    );
  });

  it("reports unknown CSF2 symbol properties without losing the fail-closed error", () => {
    const story = (args: Record<string, unknown>) => (
      <button type="button">{args.label as string}</button>
    );
    Object.defineProperty(story, Symbol.for("custom"), { value: true });
    expect(() => normalizeStoryExport(story)).toThrow(
      "Unsupported CSF2 function story fields: Symbol(custom)",
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

describe("Storybook stories have no accessibility violations", () => {
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
        const story = normalizeStoryExport(exportedStory);
        expect(story.decorators ?? []).toEqual([]);
        expect(story.loaders ?? []).toEqual([]);
        expect(story.play).toBeUndefined();

        const element = resolveStoryElement(meta, exportedStory);
        const { baseElement } = render(element as ReactNode);
        await expectNoA11yViolations(baseElement, {
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
