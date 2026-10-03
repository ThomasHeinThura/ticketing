/**
 * Resolves the Hono client base URL from `VITE_API_URL` (or default).
 * If the value already ends with `/api`, it is returned as-is; otherwise `/api` is appended.
 */
export function resolveApiBaseUrl(viteApiUrl: string | undefined): string {
  // `??`, not `||`: an explicitly empty VITE_API_URL (the bundled same-origin
  // image's build arg) means "use a relative path", and must not fall back to
  // the dev default the way undefined (nothing set, e.g. `vite dev`) does.
  const raw = viteApiUrl ?? "http://localhost:1337";
  // Avoid a suffix regex here: a long run of slashes followed by a non-slash
  // can make the engine retry the same suffix at many starting positions.
  let end = raw.length;
  while (end > 0 && raw.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  const baseUrl = raw.slice(0, end);
  return baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
}
