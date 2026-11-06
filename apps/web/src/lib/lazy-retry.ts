/**
 * Recovery for code chunks that fail to load (a dropped connection, or a new release that
 * replaced the hashed file names). `React.lazy` keeps a rejected loader for good, so a page
 * that failed once cannot recover in place: a short in-page retry covers a brief network blip,
 * and a full page reload is the recovery that always works.
 */

/** Each browser's wording for a failed dynamic import, and Vite's for a failed CSS preload. */
const CHUNK_LOAD_ERROR_MESSAGES = [
  "Failed to fetch dynamically imported module", // Chromium
  "error loading dynamically imported module", // Firefox
  "Importing a module script failed", // Safari
  "Unable to preload CSS", // Vite
];

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  return CHUNK_LOAD_ERROR_MESSAGES.some((text) => error.message.includes(text));
}

export const CHUNK_IMPORT_RETRY_DELAYS_MS = [250, 750];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `load`, and runs it again after each delay while it fails with a chunk load error. Any
 * other error, or the last chunk error, is passed on unchanged.
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
      if (delay === undefined || !isChunkLoadError(error)) throw error;
      await wait(delay);
    }
  }
}

const CHUNK_RELOAD_STORAGE_PREFIX = "taskdesk:chunk-reload:";

/**
 * Reloads the page once per failing chunk per tab session (the error message names the chunk's
 * URL, and a new release renames its chunks). Returns false, without reloading, when this chunk
 * already caused a reload, or when session storage cannot record the attempt: without that
 * record a lasting failure would reload forever. A slow failure cannot slip past this guard the
 * way it could past a time window.
 */
export function reloadOnceForChunkError(
  error: unknown,
  reload: () => void = () => window.location.reload(),
): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const key = `${CHUNK_RELOAD_STORAGE_PREFIX}${message}`;
  try {
    if (sessionStorage.getItem(key) !== null) return false;
    sessionStorage.setItem(key, "1");
  } catch {
    return false;
  }
  reload();
  return true;
}
