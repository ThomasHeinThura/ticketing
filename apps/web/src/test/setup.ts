import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { configureNotifyScheduler } from "@/query-client/notify-scheduler";
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

// Same notification ordering as production (see query-client/notify-scheduler).
configureNotifyScheduler();

// Testing Library registers its automatic cleanup only when test globals are
// enabled, and this suite runs without them. Unmount every rendered tree after
// each test, so no React work is still scheduled when the JSDOM environment is
// torn down ("window is not defined" from the scheduler, reported as an
// unhandled error that fails the run even though every test passed).
afterEach(() => {
  cleanup();
});
