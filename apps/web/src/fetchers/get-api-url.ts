export function getApiUrl(path: string) {
  // `??`, not `||`: an explicitly empty VITE_API_URL (the bundled same-origin
  // image's build arg) means "use a relative path", and must not fall back to
  // the dev default the way undefined (nothing set, e.g. `vite dev`) does.
  const trimmedBase = (
    import.meta.env.VITE_API_URL ?? "http://localhost:1337"
  ).replace(/\/+$/, "");
  const apiUrl = trimmedBase.endsWith("/api")
    ? trimmedBase
    : `${trimmedBase}/api`;
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;

  return `${apiUrl}${normalizedPath}`;
}

// A same-origin build (VITE_API_URL="") makes getApiUrl() return a relative
// path like "/api/ws" with no scheme. `WebSocket`'s constructor resolves a
// relative URL against the page, but then requires the RESOLVED scheme to be
// ws/wss — resolving "/api/ws" against an https page yields "https:", which
// fails that check and throws synchronously. This builds an explicit ws(s)
// URL from the current origin instead of relying on that resolution.
export function toWebSocketBase(httpOrRelativeApiUrl: string): string {
  if (/^https?:\/\//.test(httpOrRelativeApiUrl)) {
    return httpOrRelativeApiUrl.replace(/^http/, "ws");
  }
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${httpOrRelativeApiUrl}`;
}
