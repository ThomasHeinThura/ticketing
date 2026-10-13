import en from "@i18n/en-US.json";

// Resolves "namespace:dotted.key" against the real en-US catalog and applies
// {{placeholder}} interpolation, so accessible-name assertions fail when a key
// is missing instead of silently matching the key text.
export function translate(
  key: string,
  options: Record<string, unknown> = {},
): string {
  const [namespace, path] = key.split(":");
  const value = path
    ?.split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      (en as Record<string, unknown>)[namespace],
    );
  if (typeof value !== "string") throw new Error(`Missing en-US key ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options[name] ?? ""),
  );
}
