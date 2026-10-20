// The command palette warms (loads its module) once a heavy screen's primary content is up,
// so ⌘K opens without a download. The sidebar loads in the same window; on a throttled
// connection the two downloads compete and the palette can stay cold (G11 palette cases).
// The sidebar therefore waits for the palette on those screens, for a bounded time.

let markWarm: () => void = () => {};
const warm = new Promise<void>((resolve) => {
  markWarm = resolve;
});

/** Called once the palette module has loaded, by warm-up or by the user's shortcut. */
export function markPaletteWarm(): void {
  markWarm();
}

/** Resolves when the palette has warmed, or after `timeoutMs`, whichever is first. */
export function whenPaletteWarm(timeoutMs = 1_500): Promise<void> {
  return Promise.race([
    warm,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
