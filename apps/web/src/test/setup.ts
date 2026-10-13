import "@testing-library/jest-dom/vitest";
import { installJSDOMLayoutStubs } from "./jsdom-layout";
import { installJSDOMLocalStorage } from "./jsdom-local-storage";

const testGlobal = globalThis as typeof globalThis & {
  jsdom: { window: Window };
};

// Vitest skips globals already present on Node, including Node 26's undefined
// localStorage accessor. Restore the actual storage object from its JSDOM window.
installJSDOMLocalStorage(testGlobal.jsdom.window);

installJSDOMLayoutStubs(
  globalThis as unknown as Parameters<typeof installJSDOMLayoutStubs>[0],
);
