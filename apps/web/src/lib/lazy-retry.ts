/**
 * Recovery for code chunks that fail to load (a dropped connection, or a new release that
 * replaced the hashed file names). `React.lazy` keeps a rejected loader for good, so a page
 * that failed once cannot recover in place: a short in-page retry covers a brief network blip,
 * and the error screen's Try again (a full page reload) is the recovery that always works. The
 * page never reloads on its own: if the failure persists, an automatic reload would land on a
 * worse state (a page stuck loading) instead of the error screen.
 */

import { type ComponentType, type LazyExoticComponent, lazy } from "react";

/** Each browser's wording for a failed dynamic import of a JavaScript module. */
const MODULE_IMPORT_ERROR_MESSAGES = [
  "Failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
];

/** Vite's wording for a stylesheet a chunk needs that failed to load. */
const CSS_PRELOAD_ERROR_MESSAGE = "Unable to preload CSS";

/** A failed JavaScript module import, which importing again can repair. */
function isModuleImportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  return MODULE_IMPORT_ERROR_MESSAGES.some((text) =>
    error.message.includes(text),
  );
}

/** A stylesheet a chunk needs that failed to load, which importing again cannot repair. */
function isCssPreloadError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes(CSS_PRELOAD_ERROR_MESSAGE)
  );
}

export function isChunkLoadError(error: unknown): boolean {
  return isModuleImportError(error) || isCssPreloadError(error);
}

export const CHUNK_IMPORT_RETRY_DELAYS_MS = [250, 750];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `load`, and runs it again after each delay while it fails to import a JavaScript module.
 * Any other error, or the last import error, is passed on unchanged. A failed CSS preload is not
 * retried here: Vite records each stylesheet as requested before it loads, so a second import
 * would skip the missing stylesheet and render the page unstyled. It goes straight to the error
 * screen.
 */
export async function importWithRetry<T>(
  load: () => Promise<T>,
  delaysMs: readonly number[] = CHUNK_IMPORT_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      const delay = delaysMs[attempt];
      if (delay === undefined || !isModuleImportError(error)) throw error;
      await wait(delay);
    }
  }
}

/**
 * Wraps `load` so a failed CSS preload is not forgotten. Vite records each stylesheet as
 * requested before it loads and never requests it again, so after one failure (for example
 * during a hover prefetch whose error nobody sees) a later import resolves without the
 * stylesheet and the page renders unstyled. Once a CSS preload has failed, every later call
 * rejects with that same error, so the page shows the error screen, whose Try again reloads
 * the page and requests the stylesheet afresh.
 */
export function rememberCssPreloadFailure<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let cssFailure: { error: unknown } | undefined;
  return async () => {
    if (cssFailure) throw cssFailure.error;
    try {
      return await load();
    } catch (error) {
      if (isCssPreloadError(error)) cssFailure = { error };
      throw error;
    }
  };
}

/**
 * `React.lazy` that can try again. `React.lazy` keeps a rejected load for good, so after a
 * rejection the holder's `Component` is replaced by a fresh lazy component; render
 * `holder.Component` (read at render), and the next render after the error imports afresh.
 */
// biome-ignore lint/suspicious/noExplicitAny: the same constraint as `React.lazy`, so any component's own props are kept.
export function resettableLazy<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): { Component: LazyExoticComponent<T> } {
  const holder = {} as { Component: LazyExoticComponent<T> };
  const create = (): LazyExoticComponent<T> =>
    lazy(() =>
      load().catch((error: unknown) => {
        holder.Component = create();
        throw error;
      }),
    );
  holder.Component = create();
  return holder;
}
