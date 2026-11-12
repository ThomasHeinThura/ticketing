import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SAFE_STACK_FUNCTIONS = [
  "failure",
  "handler",
  "dispatch",
  "fetch",
  "main",
  "onError",
  "next",
] as const;

/** Extract locations only; the exception's first line and arbitrary non-frame text are discarded. */
export function serverErrorFrames(
  stack: unknown,
  base = process.cwd(),
): string[] {
  if (typeof stack !== "string") return [];
  let root = resolve(base);
  while (
    !existsSync(resolve(root, "pnpm-workspace.yaml")) &&
    resolve(root, "..") !== root
  )
    root = resolve(root, "..");
  if (!existsSync(resolve(root, "pnpm-workspace.yaml"))) root = resolve(base);
  const result: string[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const match =
      /^\s*at (?:(?<fn>[\w.$<>-]{1,100}) \()?((?:file:\/\/)?\/[^\s()?#]+):([0-9]{1,7}):([0-9]{1,7})\)?\s*$/.exec(
        line,
      );
    if (!match?.[2]) continue;
    try {
      const path = match[2].startsWith("file:")
        ? fileURLToPath(match[2])
        : match[2];
      if (!isAbsolute(path)) continue;
      const real = realpathSync(path);
      const rel = relative(root, real).split(sep).join("/");
      if (rel.startsWith("../") || !rel || !/^[\w./@-]+$/.test(rel)) continue;
      const parts = rel.split("/");
      const nm = parts.lastIndexOf("node_modules");
      const file =
        nm < 0
          ? rel
          : `node_modules/${parts[nm + 1]?.startsWith("@") ? `${parts[nm + 1]}/${parts[nm + 2]}` : parts[nm + 1]}`;
      if (
        nm < 0 &&
        (!/^(apps|packages|tests)\//.test(rel) ||
          !/\.(?:[cm]?js|[cm]?ts|tsx|jsx)$/.test(rel))
      )
        continue;
      const candidate = match.groups?.fn;
      const fn =
        candidate &&
        (SAFE_STACK_FUNCTIONS as readonly string[]).includes(candidate)
          ? candidate
          : undefined;
      const frame = `${fn ? `${fn} ` : ""}${file}:${Number(match[3])}:${Number(match[4])}`;
      // Long opaque components and email-like strings can be credentials or personal data.
      if (
        /@[^/]+\./.test(frame) ||
        /[A-Za-z0-9_-]{32,}/.test(frame) ||
        (fn &&
          /token|secret|password|credential|cookie|authorization/i.test(fn))
      )
        continue;
      result.push(frame);
      if (result.length === 15) break;
    } catch {
      /* Unresolvable paths are not emitted. */
    }
  }
  return result;
}
