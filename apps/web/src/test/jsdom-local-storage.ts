export function installJSDOMLocalStorage(
  jsdomWindow: Window,
  testWindow: Window = window,
): void {
  Object.defineProperty(testWindow, "localStorage", {
    configurable: true,
    enumerable: true,
    value: jsdomWindow.localStorage,
  });
}
