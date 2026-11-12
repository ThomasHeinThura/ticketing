import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

const originalWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setWidth(originalWidth);
});

describe("useIsMobile", () => {
  // UX-10: a shell that chooses its layout from this hook must not paint the desktop layout
  // for one frame on a narrow viewport (the agent shell's sidebar placeholder shifted).
  it("reads the viewport on the first render", () => {
    setWidth(800);
    const renders: boolean[] = [];
    function Probe() {
      renders.push(useIsMobile(1024));
      return null;
    }
    render(<Probe />);
    expect(renders[0]).toBe(true);
  });

  it("is false from the breakpoint up and uses 768 px by default", () => {
    setWidth(768);
    const renders: Array<[boolean, boolean]> = [];
    function Probe() {
      renders.push([useIsMobile(), useIsMobile(769)]);
      return null;
    }
    render(<Probe />);
    expect(renders.at(-1)).toEqual([false, true]);
  });
});
