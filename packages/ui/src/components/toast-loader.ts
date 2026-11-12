type ContentsModule = typeof import("./toast-viewport");

/** Shared by idle warm-up and first use; a failure never poisons the next attempt. */
export function createToastContentsLoader(
  importer: () => Promise<ContentsModule> = () => import("./toast-viewport"),
) {
  let pending: Promise<ContentsModule> | undefined;
  return () => {
    if (!pending) {
      pending = (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await importer();
          } catch (error) {
            if (attempt === 2) throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, attempt === 0 ? 250 : 750),
            );
          }
        }
      })().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

export const loadToastContents = createToastContentsLoader();
let warmupScheduled = false;

/** Called from an effect: give first paint two frames, then use bounded idle time. */
export function warmToastContents() {
  if (warmupScheduled) return;
  warmupScheduled = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const load = () => void loadToastContents().catch(() => {});
      if (typeof window.requestIdleCallback === "function")
        window.requestIdleCallback(load, { timeout: 2_000 });
      else setTimeout(load, 1_000);
    });
  });
}
