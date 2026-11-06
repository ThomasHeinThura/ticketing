/**
 * Recovery for code chunks that fail to load (a dropped connection, or a new release that
 * replaced the hashed file names). `React.lazy` keeps a rejected loader for good, so a page
 * that failed once cannot recover in place: a short in-page retry covers a brief network blip,
 * and a full page reload is the recovery that always works.
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

export function isChunkLoadError(error: unknown): boolean {
  if (isModuleImportError(error)) return true;
  return (
    error instanceof Error && error.message.includes(CSS_PRELOAD_ERROR_MESSAGE)
  );
}

export const CHUNK_IMPORT_RETRY_DELAYS_MS = [250, 750];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `load`, and runs it again after each delay while it fails to import a JavaScript module.
 * Any other error, or the last import error, is passed on unchanged. A failed CSS preload is not
 * retried here: Vite records each stylesheet as requested before it loads, so a second import
 * would skip the missing stylesheet and render the page unstyled. It goes straight to the reload.
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

const CHUNK_RELOAD_STORAGE_PREFIX = "taskdesk:chunk-reload:";
/** The key TanStack Router's `lazyRouteComponent` sets when it reloads for a failed route chunk. */
const TANSTACK_RELOAD_STORAGE_PREFIX = "tanstack_router_reload:";
/** Chromium, Firefox and Vite name the failing file; Safari's message names none. */
const NAMES_A_URL = /(?:https?:\/\/|\/)\S/u;

/**
 * Reloads the page once per failing chunk per tab session (the error message names the chunk's
 * URL, and a new release renames its chunks). Returns false, without reloading, when this chunk
 * already caused a reload, or when session storage cannot record the attempt: without that
 * record a lasting failure would reload forever. A slow failure cannot slip past this guard the
 * way it could past a time window.
 *
 * A message that names the chunk also honours TanStack Router's own reload record for it, so a
 * route chunk that keeps failing reloads once, not twice. Safari's message names no chunk, so
 * its record is scoped by the page path as well; TanStack's record for that message is not
 * chunk-specific and is not honoured, or one failure would block every later one in the tab.
 */
export function reloadOnceForChunkError(
  error: unknown,
  reload: () => void = () => window.location.reload(),
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const namesChunk = NAMES_A_URL.test(message);
  try {
    if (
      namesChunk &&
      sessionStorage.getItem(`${TANSTACK_RELOAD_STORAGE_PREFIX}${message}`) !==
        null
    )
      return false;
    const key = namesChunk
      ? `${CHUNK_RELOAD_STORAGE_PREFIX}${message}`
      : `${CHUNK_RELOAD_STORAGE_PREFIX}${message}@${window.location.pathname}`;
    if (sessionStorage.getItem(key) !== null) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    return false;
  }
  reload();
  return true;
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
