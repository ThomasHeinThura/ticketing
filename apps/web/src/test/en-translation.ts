import en from "@i18n/en-US.json";

const AGENT_TERM_KEYS = new Set([
  "work_item",
  "project",
  "cycle",
  "module",
  "epic",
  "request",
  "submission",
  "service",
  "change",
]);

function interpolateEnglish(
  value: string,
  namespace: string,
  options: Record<string, unknown>,
): string {
  return value.replace(/\{\{(\w+)\}\}/g, (_token, name: string) => {
    if (name.startsWith("term_")) {
      const match =
        /^term_(work_item|project|cycle|module|epic|request|submission|service|change)_(one|other)$/.exec(
          name,
        );
      const termKey = match?.[1];
      const termForm = match?.[2];
      if (!termKey || !termForm || !AGENT_TERM_KEYS.has(termKey))
        throw new Error(
          `Unknown closed English terminology placeholder ${name}`,
        );
      const audience = namespace === "portal" ? "customer" : "agent";
      const terms = (en as Record<string, unknown>).term as Record<
        string,
        Record<string, string>
      >;
      const term = terms[audience]?.[`${termKey}_${termForm}`];
      if (typeof term !== "string")
        throw new Error(`Missing English ${audience} term ${name}`);
      return term;
    }
    return String(options[name] ?? "");
  });
}

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
  if (typeof value !== "string") {
    if (typeof options.defaultValue === "string") {
      return interpolateEnglish(options.defaultValue, namespace, options);
    }
    throw new Error(`Missing en-US key ${key}`);
  }
  return interpolateEnglish(value, namespace, options);
}
