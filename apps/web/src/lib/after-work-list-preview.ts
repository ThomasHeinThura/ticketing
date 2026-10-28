const PREVIEW = "[data-testid='work-item-list-preview']";

/** Start optional downloads only after the route's existing preview has painted. */
export function afterWorkListPreview(
  root: HTMLElement,
  signal: AbortSignal,
  onPainted: () => void,
): () => void {
  if (signal.aborted) return () => {};
  let frame: number | undefined;
  let started = false;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    signal.removeEventListener("abort", cleanup);
  };
  const check = () => {
    if (disposed || started || signal.aborted || !root.querySelector(PREVIEW))
      return;
    started = true;
    observer.disconnect();
    frame = requestAnimationFrame(() => {
      if (disposed || signal.aborted) return;
      frame = requestAnimationFrame(() => {
        if (disposed || signal.aborted) return;
        cleanup();
        if (!signal.aborted && root.querySelector(PREVIEW)) onPainted();
      });
    });
  };
  const observer = new MutationObserver(check);
  observer.observe(root, { childList: true, subtree: true });
  signal.addEventListener("abort", cleanup, { once: true });
  check();
  return cleanup;
}
