// On the work list and boards the sidebar mounts once the rows are up, and the command palette
// mounts after the sidebar has rendered. Mounting the palette first left the sidebar's render
// to land on the user's first ⌘K, and G11's palette click-to-paint jittered past its budget.
// The palette's module still downloads as soon as the rows are up; only its mount waits.

let markShown: () => void = () => {};
const shown = new Promise<void>((resolve) => {
  markShown = resolve;
});

/** Called once the app sidebar has rendered for the first time this session. */
export function markSidebarShown(): void {
  markShown();
}

/** Resolves when the sidebar has rendered, or after `timeoutMs`, whichever is first. */
export function whenSidebarShown(timeoutMs = 2_000): Promise<void> {
  return Promise.race([
    shown,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
