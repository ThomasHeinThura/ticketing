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
