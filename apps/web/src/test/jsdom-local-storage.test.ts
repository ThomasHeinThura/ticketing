import { describe, expect, it } from "vitest";
import { installJSDOMLocalStorage } from "./jsdom-local-storage";

describe("jsdom localStorage test setup", () => {
  it("uses jsdom storage when a host global shadows browser storage", () => {
    const jsdomWindow = (
      globalThis as typeof globalThis & {
        jsdom: { window: Window };
      }
    ).jsdom.window;
    const browserStorage = jsdomWindow.localStorage;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: undefined,
    });

    try {
      installJSDOMLocalStorage(jsdomWindow);

      expect(window.localStorage).toBe(browserStorage);
      const key = "test:jsdom-local-storage";
      window.localStorage.setItem(key, "browser storage remains functional");
      expect(jsdomWindow.localStorage.getItem(key)).toBe(
        "browser storage remains functional",
      );
      window.localStorage.removeItem(key);
    } finally {
      installJSDOMLocalStorage(jsdomWindow);
    }
  });
});
