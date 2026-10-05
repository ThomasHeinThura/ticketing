import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import enUS from "@i18n/en-US.json";
import { describe, expect, it } from "vitest";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(sourceDirectory, "../../../../../");
const translatedScreens = [
  "../../routes/agent/_layout/_authenticated/god-mode/authentication.tsx",
  "identity-connection-editor.tsx",
  "identity-connection-events.tsx",
  "scim-match-attributes-settings.tsx",
  "scim-group-mappings-settings.tsx",
  "scim-token-settings.tsx",
];

function findHardcodedCopy(source: string, fileName: string) {
  const findings: string[] = [];
  for (const match of source.matchAll(
    /<([A-Za-z][\w.-]*)\b[^>]*>([^<>]*)<\/\1>/gsu,
  )) {
    const rawText = match[2]?.trim();
    if (rawText?.includes("Microsoft Entra ·")) continue;
    if (rawText?.startsWith("{")) continue;
    const text = rawText?.replace(/\{[^{}]*\}/gu, "").trim();
    if (text && /[A-Za-z]/u.test(text) && text !== "Microsoft Entra ·") {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(`${fileName}:${line}: ${JSON.stringify(text)}`);
    }
  }
  for (const match of source.matchAll(
    /\b(aria-label|aria-description|placeholder|title|alt)="([^"]+)"/gu,
  )) {
    const line = source.slice(0, match.index).split("\n").length;
    findings.push(
      `${fileName}:${line}: ${match[1]}=${JSON.stringify(match[2])}`,
    );
  }
  return findings;
}

describe("identity connection admin copy coverage", () => {
  it("keeps static visible and accessible copy in the translation API", () => {
    const findings = translatedScreens.flatMap((relativePath) => {
      const path = resolve(sourceDirectory, relativePath);
      return findHardcodedCopy(readFileSync(path, "utf8"), relativePath);
    });
    expect(findings).toEqual([]);
  });

  it("resolves every static identity connection translation reference", () => {
    const identity = (enUS as Record<string, unknown>)
      .identityConnections as Record<string, unknown>;
    const missing: string[] = [];
    for (const relativePath of translatedScreens) {
      const source = readFileSync(
        resolve(sourceDirectory, relativePath),
        "utf8",
      );
      for (const match of source.matchAll(/\bt\("([\w.]+)"/gu)) {
        let value: unknown = identity;
        for (const part of (match[1] ?? "").split(".")) {
          value =
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[part]
              : undefined;
        }
        if (typeof value !== "string") {
          const line = source.slice(0, match.index).split("\n").length;
          missing.push(`${relativePath}:${line}: ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(resolve(repositoryRoot, "i18n/en-US.json")).toBeTruthy();
  });
});
