#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { repoRoot, violation, walk } from "./lib/repo.mjs";

const manifestPath = "packages/ui/src/styles/pairs.json";
const requireFromWeb = createRequire(
  path.join(repoRoot, "apps/web/package.json"),
);

function parseClassToken(className) {
  const segments = [];
  let bracketDepth = 0;
  let segmentStart = 0;
  for (let index = 0; index < className.length; index += 1) {
    const character = className[index];
    if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === ":" && bracketDepth === 0) {
      segments.push(className.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }
  segments.push(className.slice(segmentStart));
  return {
    className,
    variants: segments.slice(0, -1),
    utility: segments.at(-1) ?? "",
  };
}

function isTranslucentBackgroundUtility(className, tokenNames = new Set()) {
  const utility = parseClassToken(className).utility;
  const match = utility.match(/^bg-([a-z0-9-]+)(?:\/(\d+))?$/u);
  if (!match) return false;
  const opacity = Number(match[2] ?? 100);
  return opacity < 100 || tokenNames.has(match[1]);
}

function isOpaqueBackgroundUtility(className, tokenNames = new Set()) {
  return !isTranslucentBackgroundUtility(className, tokenNames);
}

function parseForegroundUtility(parsed, tokenNames) {
  const match = parsed.utility.match(/^text-([a-z0-9-]+)(?:\/(.*))?$/u);
  if (!match || !tokenNames.has(match[1])) {
    // Tailwind's arbitrary `text-*` utility is ambiguous: some forms set font
    // size and others set color. Detect the concrete color syntaxes we can
    // recognize and reject them until they have an explicit measured token.
    if (
      /^text-\[/u.test(parsed.utility) &&
      !/^text-\[(?:length:)?-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)\]$/u.test(
        parsed.utility,
      )
    )
      return { unsupported: true, token: parsed.utility };
    return undefined;
  }
  if (match[2] !== undefined && !/^\d+$/u.test(match[2]))
    return { unsupported: true, token: match[1] };
  if (match[2] !== undefined && Number(match[2]) > 100)
    return { unsupported: true, token: match[1] };
  return {
    name: match[1],
    className: parsed.className,
    opacity: match[2] === undefined ? 100 : Number(match[2]),
  };
}

function contrastPairKey(
  fg,
  bg,
  backgroundClass,
  theme,
  foregroundClass,
  backdropLayers = [],
) {
  const tokenClass = fg.replace(/^--color-/, "text-");
  const key = `${fg}|${bg}|${backgroundClass}|${theme}${
    backdropLayers.length ? `|backdrop:${backdropLayers.join(">")}` : ""
  }`;
  const foregroundUtility = foregroundClass
    ? parseClassToken(foregroundClass).utility
    : tokenClass;
  return foregroundUtility !== tokenClass ? `${key}|${foregroundUtility}` : key;
}

function classAvailableInTheme(className, theme) {
  const variants = parseClassToken(className).variants;
  return !variants.includes(theme === "light" ? "dark" : "light");
}

export function probeSurfaceDescriptor(className) {
  const descendant = className.startsWith("*:");
  return {
    className: descendant ? className.slice(2) : className,
    descendant,
  };
}

function classLiteralGroups(source) {
  const literal = /(["'`])([\s\S]*?)\1/g;
  const groups = [];
  for (const match of source.matchAll(literal)) {
    if (match[1] !== "`" || !match[2].includes("${")) {
      groups.push(match[2]);
      continue;
    }
    let variants = [match[2]];
    for (const interpolation of match[2].matchAll(/\$\{([\s\S]*?)\}/gu)) {
      const expression = interpolation[1] ?? "";
      const conditional = expression.match(
        /^([\s\S]*?)\?\s*(["'])([\s\S]*?)\2\s*:\s*(["'])([\s\S]*?)\4\s*$/u,
      );
      const choices = conditional ? [conditional[3], conditional[5]] : [""];
      variants = variants.flatMap((variant) =>
        choices.map((choice) =>
          variant.replace(interpolation[0], ` ${choice} `),
        ),
      );
    }
    groups.push(...variants);
  }
  function directArguments(body) {
    const args = [];
    let start = 0;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "(" || character === "[" || character === "{") {
        depth += 1;
      } else if (character === ")" || character === "]" || character === "}") {
        depth -= 1;
      } else if (character === "," && depth === 0) {
        args.push(body.slice(start, index));
        start = index + 1;
      }
    }
    args.push(body.slice(start));
    const branches = [];
    function addLiteral(text, guard, argIndex) {
      branches.push({ text, guard: guard?.trim() || null, argIndex });
    }
    function splitConditional(expression) {
      let depth = 0;
      let quote = "";
      let escaped = false;
      let question = -1;
      let nested = 0;
      for (let index = 0; index < expression.length; index += 1) {
        const character = expression[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === quote) quote = "";
          continue;
        }
        if (character === "'" || character === '"' || character === "`") {
          quote = character;
          continue;
        }
        if (character === "(" || character === "[" || character === "{") {
          depth += 1;
          continue;
        }
        if (character === ")" || character === "]" || character === "}") {
          depth -= 1;
          continue;
        }
        if (depth !== 0) continue;
        if (character === "?" && expression[index + 1] !== ".") {
          if (question < 0) question = index;
          else nested += 1;
        } else if (character === ":" && question >= 0) {
          if (nested === 0)
            return [
              expression.slice(0, question),
              expression.slice(question + 1, index),
              expression.slice(index + 1),
            ];
          nested -= 1;
        }
      }
      return undefined;
    }
    function combineGuard(parent, condition) {
      return [parent, condition].filter(Boolean).join(" && ");
    }
    function addExpression(expression, guard, argIndex) {
      const trimmed = expression
        .trim()
        .replace(/^\((.*)\)$/u, "$1")
        .trim();
      const conditional = splitConditional(trimmed);
      if (conditional) {
        addExpression(
          conditional[1],
          combineGuard(guard, conditional[0].trim()),
          argIndex,
        );
        addExpression(
          conditional[2],
          combineGuard(guard, `!(${conditional[0].trim()})`),
          argIndex,
        );
        return;
      }
      const literalValue = trimmed.match(/^(["'`])([\s\S]*)\1$/u);
      if (literalValue) {
        addLiteral(literalValue[2], guard, argIndex);
        return;
      }
      const and = trimmed.match(/^([\s\S]*?)&&\s*(["'`])([\s\S]*)\2$/u);
      if (and) {
        addLiteral(and[3], combineGuard(guard, and[1].trim()), argIndex);
        return;
      }
      const objectEntries = [
        ...trimmed.matchAll(/(["'`])([^"'`]+)\1\s*:\s*([^,}]+)/g),
      ];
      if (objectEntries.length > 0) {
        for (const entry of objectEntries)
          addLiteral(entry[2], combineGuard(guard, entry[3]), argIndex);
        return;
      }
      const values = [...trimmed.matchAll(literal)].map((match) => match[2]);
      for (const value of values) addLiteral(value, guard, argIndex);
    }
    for (const [argIndex, argument] of args.entries()) {
      addExpression(argument, null, argIndex);
    }
    return branches;
  }
  function compatibleGuards(left, right) {
    if (!left || !right) return true;
    const normalize = (guard) => guard.replace(/[()\s]/g, "");
    const leftNormalized = normalize(left);
    const rightNormalized = normalize(right);
    const leftAtoms = leftNormalized.split("&&");
    const rightAtoms = rightNormalized.split("&&");
    if (
      leftAtoms.some((atom) =>
        rightAtoms.includes(atom.startsWith("!") ? atom.slice(1) : `!${atom}`),
      )
    )
      return false;
    if (
      leftNormalized === `!${rightNormalized}` ||
      rightNormalized === `!${leftNormalized}`
    )
      return false;
    const leftNegated = left.match(/^!\(\s*(.*?)\s*\)$/)?.[1];
    const rightNegated = right.match(/^!\(\s*(.*?)\s*\)$/)?.[1];
    if (
      (leftNegated && normalize(leftNegated) === rightNormalized) ||
      (rightNegated && normalize(rightNegated) === leftNormalized)
    )
      return false;
    const equality = (guard) =>
      guard.match(
        /^\(?\s*([\w.$]+)\s*(===|!==|==|!=)\s*["'`]([^"'`]+)["'`]\s*\)?$/,
      );
    const l = equality(left);
    const r = equality(right);
    if (l && r && l[1] === r[1]) {
      if (l[2].startsWith("!") !== r[2].startsWith("!")) return l[3] !== r[3];
      if (!l[2].startsWith("!") && l[3] !== r[3]) return false;
    }
    return true;
  }
  const calls = /\bcn\s*\(/g;
  for (const call of source.matchAll(calls)) {
    const open = source.indexOf("(", call.index);
    let depth = 1;
    let quote = "";
    let escaped = false;
    for (let index = open + 1; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          const body = source.slice(open + 1, index);
          const branches = directArguments(body);
          for (let left = 0; left < branches.length; left += 1) {
            for (let right = left + 1; right < branches.length; right += 1) {
              if (compatibleGuards(branches[left].guard, branches[right].guard))
                groups.push(`${branches[left].text} ${branches[right].text}`);
            }
          }
          break;
        }
      }
    }
  }
  return groups;
}

function classNameLiteralGroups(source) {
  const groups = [];
  const attributes = /\bclassName\s*=\s*/g;
  for (const attribute of source.matchAll(attributes)) {
    const valueStart = attribute.index + attribute[0].length;
    const opening = source[valueStart];
    if (opening === '"' || opening === "'") {
      let end = valueStart + 1;
      while (end < source.length) {
        if (source[end] === "\\") end += 2;
        else if (source[end] === opening) break;
        else end += 1;
      }
      groups.push(...classLiteralGroups(source.slice(valueStart, end + 1)));
      continue;
    }
    if (opening !== "{") continue;
    let depth = 1;
    let quote = "";
    let escaped = false;
    let end = valueStart + 1;
    for (; end < source.length && depth > 0; end += 1) {
      const character = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`")
        quote = character;
      else if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
    }
    groups.push(...classLiteralGroups(source.slice(valueStart + 1, end - 1)));
  }
  return groups;
}

function cvaClassLiteralGroups(source) {
  const groups = [];
  for (const call of source.matchAll(/\bcva\s*\(/gu)) {
    const open = source.indexOf("(", call.index);
    let depth = 1;
    let quote = "";
    let escaped = false;
    for (let index = open + 1; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
        if (depth === 0) {
          groups.push(...classLiteralGroups(source.slice(open + 1, index)));
          break;
        }
      }
    }
  }
  return groups;
}

function wrappedFunctionInitializer(initializer) {
  if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    return initializer;
  if (
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    initializer.expression.text === "memo"
  ) {
    const [wrapped] = initializer.arguments;
    if (
      wrapped &&
      (ts.isArrowFunction(wrapped) || ts.isFunctionExpression(wrapped))
    )
      return wrapped;
  }
  return undefined;
}

function sourceUsesPair(source, foregroundClass, backgroundClass, theme) {
  for (const classText of [
    ...classNameLiteralGroups(source),
    ...(/const alertVariants\s*=\s*cva\s*\(/u.test(source)
      ? cvaClassLiteralGroups(source)
      : []),
  ]) {
    const classes = classText.split(/\s+/).map(parseClassToken);
    const foregroundFound = classes.some((parsed) => {
      const darkScoped = parsed.variants.includes("dark");
      return (
        parsed.className === foregroundClass &&
        (!darkScoped || theme === "dark")
      );
    });
    if (!foregroundFound) continue;
    if (
      classes.some((parsed) => {
        const darkScoped = parsed.variants.includes("dark");
        return (
          parsed.className === backgroundClass &&
          (!darkScoped || theme === "dark")
        );
      })
    ) {
      return true;
    }
  }
  return false;
}

export function validatePairManifest(pairs, readUsage, observedPairs) {
  const failures = [];
  const seen = new Set();
  const occurrenceSurfaceContexts = new Set([
    "caller-chain",
    "component-surface-contract",
    "function-return-property",
    "imported-opaque-wrapper",
    "nearest-opaque-ancestor",
    "route-layout-body",
    "same-element",
    "storybook-body",
  ]);
  const themeSource = requireFromWeb("node:fs").readFileSync(
    path.join(repoRoot, "packages/ui/src/styles/theme.css"),
    "utf8",
  );
  const intrinsicAlphaTokens = new Set(
    [...themeSource.matchAll(/--([a-z0-9-]+)\s*:\s*--alpha\(/gu)].map(
      (match) => match[1],
    ),
  );
  for (const [index, pair] of pairs.entries()) {
    const label = `${manifestPath} entry ${index + 1}`;
    if (!pair || typeof pair.fg !== "string" || typeof pair.bg !== "string") {
      failures.push(
        violation(manifestPath, `${label} needs fg and bg tokens.`),
      );
      continue;
    }
    const occurrenceShapeValid =
      Array.isArray(pair.occurrenceIds) &&
      pair.occurrenceIds.length > 0 &&
      pair.occurrenceIds.every(
        (id) => typeof id === "string" && id.length > 0,
      ) &&
      Array.isArray(pair.occurrences) &&
      pair.occurrences.length > 0 &&
      pair.occurrences.every((occurrence) => {
        const expectedKeys = [
          "backdropLayers",
          "category",
          "chain",
          "id",
          "surfaceContext",
          "usage",
        ];
        const actualKeys =
          occurrence !== null && typeof occurrence === "object"
            ? Object.keys(occurrence).sort()
            : [];
        return (
          occurrence !== null &&
          typeof occurrence === "object" &&
          !Array.isArray(occurrence) &&
          actualKeys.length === expectedKeys.length &&
          expectedKeys.every((key, index) => actualKeys[index] === key) &&
          typeof occurrence.id === "string" &&
          occurrence.id.trim().length > 0 &&
          typeof occurrence.usage === "string" &&
          occurrence.usage.trim().length > 0 &&
          occurrenceSurfaceContexts.has(occurrence.surfaceContext) &&
          ["body", "large-text", "non-text"].includes(occurrence.category) &&
          Array.isArray(occurrence.chain) &&
          occurrence.chain.length > 0 &&
          occurrence.chain.every(
            (entry) => typeof entry === "string" && entry.trim().length > 0,
          ) &&
          Array.isArray(occurrence.backdropLayers) &&
          occurrence.backdropLayers.every(
            (layer) => typeof layer === "string" && layer.trim().length > 0,
          )
        );
      });
    if (!occurrenceShapeValid) {
      failures.push(
        violation(
          manifestPath,
          `${label} needs non-empty occurrenceIds and well-shaped occurrence records.`,
        ),
      );
    } else {
      const projectedIds = [
        ...new Set(pair.occurrences.map((occurrence) => occurrence.id)),
      ];
      if (
        new Set(pair.occurrenceIds).size !== pair.occurrenceIds.length ||
        pair.occurrenceIds.length !== projectedIds.length ||
        pair.occurrenceIds.some((id, position) => id !== projectedIds[position])
      ) {
        failures.push(
          violation(
            manifestPath,
            `${label} occurrenceIds must match the first-seen unique IDs in occurrences.`,
          ),
        );
      }
    }
    const expectedRatio = pair.category === "body" ? 4.5 : 3;
    if (
      !["body", "large-text", "non-text"].includes(pair.category) ||
      pair.minRatio !== expectedRatio
    ) {
      failures.push(
        violation(
          manifestPath,
          `${label} has invalid WCAG category/threshold.`,
        ),
      );
    }
    if (
      !Array.isArray(pair.themes) ||
      pair.themes.length === 0 ||
      pair.themes.some((theme) => !["light", "dark"].includes(theme)) ||
      new Set(pair.themes).size !== pair.themes.length
    ) {
      failures.push(
        violation(
          manifestPath,
          `${label} must list one or more unique light/dark themes.`,
        ),
      );
    }
    if (!pair.usage || !pair.backdrop)
      failures.push(
        violation(
          manifestPath,
          `${label} needs a real usage owner and opaque backdrop token.`,
        ),
      );
    const occurrenceOwners = Array.isArray(pair.occurrences)
      ? [
          ...new Set(
            pair.occurrences
              .map((occurrence) => occurrence?.usage)
              .filter((usagePath) => typeof usagePath === "string"),
          ),
        ]
      : [];
    const usagePaths = occurrenceOwners.length
      ? occurrenceOwners
      : pair.usage
        ? [pair.usage]
        : [];
    const usageSources = new Map(
      usagePaths.map((usagePath) => [usagePath, readUsage(usagePath)]),
    );
    const usage = pair.usage
      ? (usageSources.get(pair.usage) ?? readUsage(pair.usage))
      : "";
    const fgToken = pair.fg.replace(/^--color-/, "");
    const parsedForeground = pair.foregroundClass
      ? parseForegroundUtility(
          parseClassToken(pair.foregroundClass),
          new Set([fgToken]),
        )
      : undefined;
    const fgClass = pair.foregroundClass;
    if (!parsedForeground || parsedForeground.unsupported)
      failures.push(
        violation(
          manifestPath,
          `${label} foregroundClass must be a supported text utility for ${pair.fg}.`,
        ),
      );
    if (!usage || !pair.backgroundClass || !pair.backdrop) {
      failures.push(
        violation(manifestPath, `${label} has no usage or surface class.`),
      );
      continue;
    }
    for (const theme of pair.themes ?? []) {
      const backgroundClass = pair.backgroundClass[theme];
      const backgroundIsOpaque = isOpaqueBackgroundUtility(
        backgroundClass ?? "",
        intrinsicAlphaTokens,
      );
      const backdropLayers = pair.backdropLayers ?? [];
      if (!backgroundIsOpaque) {
        const terminalBackdrop = backdropLayers.at(-1);
        const terminalToken = terminalBackdrop?.match(
          /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
        )?.[1];
        if (
          !terminalBackdrop ||
          !isOpaqueBackgroundUtility(terminalBackdrop, intrinsicAlphaTokens) ||
          backdropLayers
            .slice(0, -1)
            .some((layer) =>
              isOpaqueBackgroundUtility(layer, intrinsicAlphaTokens),
            ) ||
          pair.backdrop !== `--color-${terminalToken}`
        ) {
          failures.push(
            violation(
              manifestPath,
              `${label} translucent surface ${backgroundClass} needs a source-bound paint chain ending at its opaque backdrop.`,
            ),
          );
          continue;
        }
      }
      const tokenMatch = backgroundClass?.match(
        /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/,
      );
      const actualBg =
        backgroundClass === "bg-transparent"
          ? pair.backdrop
          : tokenMatch
            ? `--color-${tokenMatch[1]}`
            : "";
      if (actualBg !== pair.bg) {
        failures.push(
          violation(
            manifestPath,
            `${label} bg token does not match ${theme} surface class ${backgroundClass ?? "(missing)"}.`,
          ),
        );
        continue;
      }
      const key = contrastPairKey(
        pair.fg,
        pair.bg,
        backgroundClass,
        theme,
        pair.foregroundClass,
        pair.backdropLayers ?? [],
      );
      if (seen.has(key))
        failures.push(violation(manifestPath, `${label} duplicates ${key}.`));
      seen.add(key);
      if (!observedPairs?.has(key)) {
        failures.push(
          violation(
            manifestPath,
            `declared pair ${key} has no observed source use.`,
          ),
        );
      }
      const inheritedSurface =
        pair.surfaceContext === "nearest-opaque-ancestor" &&
        observedPairs?.inheritedUses?.has(`${pair.usage}|${key}`);
      const importedSurface =
        pair.surfaceContext === "imported-opaque-wrapper" &&
        observedPairs?.importedUses?.has(`${pair.usage}|${key}`);
      const routeSurface =
        pair.surfaceContext === "route-layout-body" &&
        observedPairs?.routeUses?.has(`${pair.usage}|${key}`);
      const callerSurface =
        pair.surfaceContext === "caller-chain" &&
        Array.isArray(pair.occurrenceIds) &&
        pair.occurrenceIds.some((occurrenceId) =>
          observedPairs?.callerUses?.has(`${occurrenceId}|${key}`),
        );
      const sameElementSurface =
        pair.surfaceContext === "same-element" &&
        Array.isArray(pair.occurrenceIds) &&
        pair.occurrenceIds.some((occurrenceId) =>
          observedPairs?.directOccurrenceUses?.has(`${occurrenceId}|${key}`),
        );
      const occurrenceBound =
        occurrenceShapeValid &&
        pair.occurrences.length > 0 &&
        new Set(
          pair.occurrences.map(
            (occurrence) =>
              `${occurrence.usage ?? pair.usage}|${occurrence.id}|${occurrence.surfaceContext}|${JSON.stringify(occurrence.chain ?? [])}`,
          ),
        ).size === pair.occurrences.length &&
        pair.occurrences.every((expected) =>
          (observedPairs?.occurrences?.get(key) ?? []).some(
            (actual) =>
              actual.id === expected.id &&
              actual.usage === (expected.usage ?? pair.usage) &&
              actual.surfaceContext === expected.surfaceContext &&
              actual.category === expected.category &&
              JSON.stringify(actual.backdropLayers ?? []) ===
                JSON.stringify(expected.backdropLayers ?? []) &&
              Array.isArray(expected.chain) &&
              JSON.stringify(actual.chain) === JSON.stringify(expected.chain),
          ),
        );
      const occurrenceCoverage =
        occurrenceBound &&
        (observedPairs?.occurrences?.get(key) ?? []).every((actual) =>
          pair.occurrences.some(
            (expected) =>
              actual.id === expected.id &&
              actual.usage === (expected.usage ?? pair.usage) &&
              actual.surfaceContext === expected.surfaceContext &&
              actual.category === expected.category &&
              JSON.stringify(actual.backdropLayers ?? []) ===
                JSON.stringify(expected.backdropLayers ?? []) &&
              JSON.stringify(actual.chain) === JSON.stringify(expected.chain),
          ),
        );
      if (occurrenceCoverage) {
        const actualOccurrences = observedPairs.occurrences.get(key);
        const strongestCategory = actualOccurrences.some(
          (occurrence) => occurrence.category === "body",
        )
          ? "body"
          : "non-text";
        if (pair.category !== strongestCategory) {
          failures.push(
            violation(
              manifestPath,
              `${label} threshold must use the strongest bound occurrence category (${strongestCategory}).`,
            ),
          );
        }
      }
      if (Array.isArray(pair.occurrences) && !occurrenceBound) {
        failures.push(
          violation(
            manifestPath,
            `${label} occurrence contract no longer matches the live source context.`,
          ),
        );
      }
      if (
        Array.isArray(pair.occurrences) &&
        occurrenceBound &&
        !occurrenceCoverage
      ) {
        failures.push(
          violation(
            manifestPath,
            `${label} occurrence contract omits a live source context.`,
          ),
        );
      }
      if (
        !inheritedSurface &&
        !importedSurface &&
        !routeSurface &&
        !callerSurface &&
        !sameElementSurface &&
        !occurrenceBound &&
        !usagePaths.some((usagePath) =>
          sourceUsesPair(
            usageSources.get(usagePath) ?? "",
            fgClass,
            backgroundClass,
            theme,
          ),
        ) &&
        !sourceUsesPair(usage, fgClass, backgroundClass, theme)
      ) {
        failures.push(
          violation(
            manifestPath,
            `${label} foreground/surface classes do not occur together in ${pair.usage} for ${theme}.`,
          ),
        );
      }
    }
  }
  for (const key of observedPairs ?? []) {
    if (!seen.has(key))
      failures.push(
        violation(manifestPath, `used pair ${key} has no manifest entry.`),
      );
  }
  if (pairs.length === 0)
    failures.push(
      violation(manifestPath, "must contain at least one used contrast pair."),
    );
  return failures;
}

export function observedPairsInSources(
  sources,
  tokenNames,
  sourcePaths = [],
  translucentBackgroundTokens = new Set(),
) {
  const foregrounds = new Set([...tokenNames]);
  const backgroundTokens = new Set(tokenNames);
  const observed = new Set();
  observed.pairDetails = new Map();
  observed.pairUses = new Map();
  observed.occurrences = new Map();
  observed.unsupportedForegrounds = [];
  const alertStoryHasOpaqueBackdrop = sourcePaths.some(
    (sourcePath, index) =>
      sourcePath === "packages/ui/src/components/alert.stories.tsx" &&
      /className\s*=\s*["']bg-background["']/u.test(sources[index] ?? ""),
  );
  for (const [sourceIndex, source] of sources.entries()) {
    // CVA variant strings are the rendered class source for shared primitives,
    // even though they are not JSX `className` attributes. Keep translucent
    // surfaces there observable when their foreground is declared alongside
    // the surface in the same variant string. JSX alpha surfaces continue to
    // be resolved through the source-bound ancestor/caller pass below.
    const cvaGroups =
      sourcePaths[sourceIndex] === "packages/ui/src/components/alert.tsx" &&
      alertStoryHasOpaqueBackdrop
        ? cvaClassLiteralGroups(source).filter((group) =>
            group
              .split(/\s+/u)
              .some((className) => className === "text-card-foreground"),
          )
        : [];
    const classGroups = [...classNameLiteralGroups(source), ...cvaGroups];
    for (const [classGroupIndex, classText] of classGroups.entries()) {
      const classes = classText.split(/\s+/).map(parseClassToken);
      const cvaGroupIndex = cvaGroups.indexOf(classText);
      const textNames = classes
        .map((parsed) => {
          const foreground = parseForegroundUtility(parsed, foregrounds);
          if (foreground?.unsupported) {
            observed.unsupportedForegrounds.push({
              className: parsed.className,
              usage: sourcePaths[sourceIndex],
            });
            return undefined;
          }
          return foreground
            ? {
                ...parsed,
                ...foreground,
                darkScoped: parsed.variants.includes("dark"),
              }
            : undefined;
        })
        .filter(Boolean)
        .filter(
          (foreground) =>
            !cvaGroups.includes(classText) ||
            foreground.className === "text-card-foreground",
        );
      const backgroundEntries = classes
        .map((parsed) => ({
          ...parsed,
          name:
            cvaGroups.includes(classText) && parsed.utility === "bg-transparent"
              ? "background"
              : parsed.utility.match(/^bg-([a-z0-9-]+)(?:\/\d+)?$/)?.[1],
          darkScoped: parsed.variants.includes("dark"),
        }))
        .filter(
          ({ name, className }) =>
            name &&
            backgroundTokens.has(name) &&
            (!isTranslucentBackgroundUtility(
              className,
              translucentBackgroundTokens,
            ) ||
              className === "bg-transparent" ||
              (cvaGroups.includes(classText) &&
                isTranslucentBackgroundUtility(
                  className,
                  translucentBackgroundTokens,
                ))),
        );
      const groups = new Map();
      for (const entry of backgroundEntries) {
        const modifiers = entry.variants.filter(
          (variant) => variant !== "dark",
        );
        const key = modifiers.join(":");
        const group = groups.get(key) ?? { modifiers, entries: [] };
        group.entries.push(entry);
        groups.set(key, group);
      }
      for (const foreground of textNames) {
        const foregroundModifiers = foreground.variants.filter(
          (variant) => variant !== "dark",
        );
        for (const group of groups.values()) {
          if (
            group.modifiers.includes("before") ||
            group.modifiers.includes("after")
          ) {
            continue;
          }
          const state = new Set([...foregroundModifiers, ...group.modifiers]);
          if (
            foregroundModifiers.includes("data-indeterminate") &&
            group.modifiers.includes("data-checked")
          ) {
            continue;
          }
          const applicableBackgroundGroups = [...groups.values()].filter(
            (candidate) =>
              candidate.modifiers.every((modifier) => state.has(modifier)),
          );
          const mostSpecific = Math.max(
            ...applicableBackgroundGroups.map(
              (candidate) => candidate.modifiers.length,
            ),
          );
          if (group.modifiers.length !== mostSpecific) continue;
          for (const theme of ["light", "dark"]) {
            const themeForegrounds = textNames.filter((candidate) => {
              if (theme === "light" && candidate.darkScoped) return false;
              const modifiers = candidate.variants.filter(
                (variant) => variant !== "dark",
              );
              return modifiers.every((modifier) => state.has(modifier));
            });
            const mostSpecificForeground = Math.max(
              ...themeForegrounds.map(
                (candidate) =>
                  candidate.variants.filter((variant) => variant !== "dark")
                    .length,
              ),
            );
            const maxSpecificityForegrounds = themeForegrounds.filter(
              (candidate) =>
                candidate.variants.filter((variant) => variant !== "dark")
                  .length === mostSpecificForeground,
            );
            const darkForegrounds = maxSpecificityForegrounds.filter(
              (candidate) => candidate.darkScoped,
            );
            const activeForegrounds =
              theme === "dark" && darkForegrounds.length > 0
                ? darkForegrounds
                : maxSpecificityForegrounds;
            if (!activeForegrounds.includes(foreground)) continue;
            const darkOverride =
              theme === "dark" &&
              group.entries.some((entry) => entry.darkScoped);
            const activeEntries = group.entries.filter(
              (entry) => entry.darkScoped === darkOverride,
            );
            for (const entry of activeEntries) {
              const key = contrastPairKey(
                `--color-${foreground.name}`,
                `--color-${entry.name}`,
                entry.className,
                theme,
                foreground.className,
                cvaGroups.includes(classText) ? ["bg-background"] : [],
              );
              observed.add(key);
              if (cvaGroupIndex >= 0) {
                const occurrenceId = `${sourcePaths[sourceIndex]}::alertVariants::CVA[${cvaGroupIndex}]::${foreground.className}#${entry.className}`;
                const occurrences = observed.occurrences.get(key) ?? [];
                occurrences.push({
                  id: occurrenceId,
                  usage: sourcePaths[sourceIndex],
                  surfaceContext: "same-element",
                  category: "body",
                  chain: [
                    `${sourcePaths[sourceIndex]}:alertVariants`,
                    `cva:${classGroupIndex}>${classText.trim()}`,
                  ],
                  backdropLayers: ["bg-background"],
                });
                observed.occurrences.set(key, occurrences);
              }
              const usages = observed.pairUses.get(key) ?? new Set();
              usages.add(sourcePaths[sourceIndex]);
              observed.pairUses.set(key, usages);
              if (!observed.pairDetails.has(key)) {
                observed.pairDetails.set(key, {
                  usage: sourcePaths[sourceIndex],
                  foregroundClass: foreground.className,
                  backgroundClass: entry.className,
                });
              }
            }
          }
        }
      }
    }
  }
  return observed;
}

export function observeInheritedForegroundSurfaces(sourcePaths, tokenNames) {
  const parser = new API({ cwd: repoRoot });
  const globalCss = requireFromWeb("node:fs").readFileSync(
    path.join(repoRoot, "apps/web/src/index.css"),
    "utf8",
  );
  const themeSource = requireFromWeb("node:fs").readFileSync(
    path.join(repoRoot, "packages/ui/src/styles/theme.css"),
    "utf8",
  );
  const translucentBackgroundTokens = new Set(
    [...themeSource.matchAll(/--([a-z0-9-]+)\s*:\s*--alpha\(/gu)].map(
      (match) => match[1],
    ),
  );
  function opaqueBackground(background) {
    return isOpaqueBackgroundUtility(
      background.className ?? background.utility,
      translucentBackgroundTokens,
    );
  }
  const cssBackgroundByClass = new Map();
  for (const rule of globalCss.matchAll(
    /\.([A-Za-z_][\w-]*)\s*\{([^{}]*)\}/gu,
  )) {
    const token = rule[2].match(
      /\bbackground(?:-color)?\s*:\s*var\(--([a-z0-9-]+)\)/u,
    )?.[1];
    if (token && tokenNames.has(token))
      cssBackgroundByClass.set(rule[1], token);
  }
  const absolutePaths = sourcePaths.map((sourcePath) =>
    path.join(repoRoot, sourcePath),
  );
  const snapshot = parser.updateSnapshot({ openFiles: absolutePaths });
  const pairs = new Set();
  const uses = new Set();
  const pairDetails = new Map();
  const unresolved = new Map();
  const importedUses = new Set();
  const routeUses = new Set();
  const callerUses = new Set();
  const directOccurrenceUses = new Set();
  const alphaSurfaceUses = new Map();
  const sourceFilesByPath = new Map();
  const importsByPath = new Map();

  function classTokens(node, sourceFile) {
    if (!node) return [];
    const attributes = ts.isJsxElement(node)
      ? node.openingElement.attributes
      : ts.isJsxSelfClosingElement(node)
        ? node.attributes
        : undefined;
    if (!attributes) return [];
    const tokens = attributes.properties
      .filter(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "className",
      )
      .flatMap((attribute) =>
        classNameLiteralGroups(attribute.getText(sourceFile)).flatMap((group) =>
          group.split(/\s+/u).filter(Boolean).map(parseClassToken),
        ),
      );
    return [
      ...new Map(tokens.map((token) => [token.className, token])).values(),
    ];
  }
  function hasStateAttribute(node, sourceFile, attributeName, expectedValue) {
    const attributes = ts.isJsxElement(node)
      ? node.openingElement.attributes
      : ts.isJsxSelfClosingElement(node)
        ? node.attributes
        : undefined;
    if (!attributes) return false;
    const matching = attributes.properties.filter(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === attributeName,
    );
    if (matching.length > 0)
      return expectedValue === undefined
        ? true
        : matching.some((attribute) =>
            attribute
              .getText(sourceFile)
              .includes(JSON.stringify(expectedValue)),
          );
    if (expectedValue !== undefined) return false;

    // Base UI emits highlighted state on its menu item primitives. The source
    // wrapper must import that primitive and forward its props to the host.
    const tagName = ts.isJsxElement(node)
      ? node.openingElement.tagName.getText(sourceFile)
      : node.tagName.getText(sourceFile);
    if (
      attributeName === "data-highlighted" &&
      /^MenuPrimitive\.(?:Item|CheckboxItem|RadioItem)$/u.test(tagName) &&
      sourceFile
        .getText(sourceFile)
        .includes(
          'import { Menu as MenuPrimitive } from "@base-ui/react/menu"',
        ) &&
      attributes.properties.some(
        (attribute) =>
          ts.isJsxSpreadAttribute(attribute) &&
          attribute.expression.getText(sourceFile) === "props",
      )
    )
      return true;
    const sourcePath = path.relative(repoRoot, sourceFile.fileName);
    const importedTarget = importsByPath.get(sourcePath)?.get(tagName);
    const primitiveByWrapper = {
      MenuItem: "Item",
      MenuCheckboxItem: "CheckboxItem",
      MenuRadioItem: "RadioItem",
    };
    const primitive =
      importedTarget?.file === "packages/ui/src/components/menu.tsx"
        ? primitiveByWrapper[importedTarget.symbol]
        : undefined;
    if (!primitive) return false;
    const wrapperSource = requireFromWeb("node:fs").readFileSync(
      path.join(repoRoot, importedTarget.file),
      "utf8",
    );
    const wrapperStart = wrapperSource.search(
      new RegExp(`function ${importedTarget.symbol}\\b`, "u"),
    );
    if (wrapperStart < 0) return false;
    const wrapperTail = wrapperSource.slice(wrapperStart);
    const nextWrapper = wrapperTail.slice(1).search(/\nfunction [A-Z]/u);
    const wrapperBody =
      nextWrapper < 0 ? wrapperTail : wrapperTail.slice(0, nextWrapper + 1);
    return (
      wrapperSource.includes(
        'import { Menu as MenuPrimitive } from "@base-ui/react/menu"',
      ) &&
      new RegExp(
        `<MenuPrimitive\\.${primitive}\\b[\\s\\S]*?\\{\\.\\.\\.props\\}`,
        "u",
      ).test(wrapperBody)
    );
  }
  function paintedBackgrounds(node, sourceFile) {
    const utility = classTokens(node, sourceFile).filter((entry) =>
      /^bg-[a-z0-9-]+(?:\/\d+)?$/u.test(entry.utility),
    );
    if (!node || (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)))
      return utility;
    const attributes = ts.isJsxElement(node)
      ? node.openingElement.attributes
      : node.attributes;
    const classAttribute = attributes.properties.find(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === "className",
    );
    const source = classAttribute?.getText(sourceFile) ?? "";
    for (const [className, token] of cssBackgroundByClass) {
      if (
        new RegExp(
          `(?:^|[^A-Za-z0-9_-])${className}(?:$|[^A-Za-z0-9_-])`,
          "u",
        ).test(source)
      ) {
        utility.push({
          className: `bg-${token}`,
          variants: [],
          utility: `bg-${token}`,
          cssClass: className,
        });
      }
    }
    return utility;
  }
  function paintedBackgroundOptions(node, sourceFile) {
    if (!node || (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)))
      return [];
    const attributes = ts.isJsxElement(node)
      ? node.openingElement.attributes
      : node.attributes;
    const classAttribute = attributes.properties.find(
      (attribute) =>
        ts.isJsxAttribute(attribute) &&
        attribute.name.getText(sourceFile) === "className",
    );
    if (!classAttribute) return [];
    const classSource = classAttribute.getText(sourceFile);
    function supportsVariant(variant) {
      if (["dark", "light", "hover", "active"].includes(variant)) return true;
      if (/^(?:not-)?supports-\[backdrop-filter\]$/u.test(variant)) return true;
      const state = variant.match(
        /^(not-)?data-\[([a-z][a-z0-9-]*)=([a-z0-9_-]+)\]$/u,
      );
      if (!state) {
        const attribute = variant.match(/^(not-)?(data-[a-z][a-z0-9-]*)$/u);
        return (
          attribute !== null &&
          hasStateAttribute(node, sourceFile, attribute[2])
        );
      }
      const [, , attributeName, expectedValue] = state;
      return hasStateAttribute(
        node,
        sourceFile,
        `data-${attributeName}`,
        expectedValue,
      );
    }
    const options = new Map();
    let hasUnpainted = false;
    for (const group of classNameLiteralGroups(classSource)) {
      const backgrounds = group
        .split(/\s+/u)
        .filter(Boolean)
        .map(parseClassToken)
        .filter((entry) => {
          const name = entry.utility.match(/^bg-([a-z0-9-]+)(?:\/\d+)?$/u)?.[1];
          return name && tokenNames.has(name);
        });
      for (const [className, token] of cssBackgroundByClass) {
        if (
          new RegExp(
            `(?:^|[^A-Za-z0-9_-])${className}(?:$|[^A-Za-z0-9_-])`,
            "u",
          ).test(group)
        )
          backgrounds.push({
            className: `bg-${token}`,
            variants: [],
            utility: `bg-${token}`,
            cssClass: className,
          });
      }
      if (backgrounds.length === 0) {
        hasUnpainted = true;
        continue;
      }
      if (
        backgrounds.every((background) =>
          background.variants.some(
            (variant) => variant !== "dark" && variant !== "light",
          ),
        )
      )
        hasUnpainted = true;
      const groups = new Map();
      for (const background of backgrounds) {
        if (background.variants.some((variant) => !supportsVariant(variant)))
          return undefined;
        const state = background.variants
          .filter((variant) => variant !== "dark" && variant !== "light")
          .join(":");
        const groupOptions = groups.get(state) ?? [];
        const theme = background.variants.includes("dark")
          ? "dark"
          : background.variants.includes("light")
            ? "light"
            : undefined;
        if (groupOptions.some((option) => option.theme === theme))
          return undefined;
        groupOptions.push({ ...background, theme });
        groups.set(state, groupOptions);
      }
      for (const groupOptions of groups.values()) {
        const hasDark = groupOptions.some((option) => option.theme === "dark");
        for (const option of groupOptions) {
          const themes = option.theme
            ? [option.theme]
            : hasDark
              ? ["light"]
              : ["light", "dark"];
          options.set(option.className, { ...option, themes });
        }
      }
    }
    const result = [...options.values()];
    result.hasUnpainted = hasUnpainted;
    return result;
  }
  const wrapperSurfaceCache = new Map();
  const wrapperSurfaceActive = new Set();
  const uiExportCache = new Map();
  const localExportCache = new Map();
  function sourceModulePath(relative) {
    const candidates = [
      relative,
      `${relative}.tsx`,
      `${relative}.ts`,
      `${relative}.jsx`,
      `${relative}.js`,
      path.join(relative, "index.tsx"),
      path.join(relative, "index.ts"),
      path.join(relative, "index.jsx"),
      path.join(relative, "index.js"),
    ];
    for (const candidate of candidates) {
      try {
        if (
          requireFromWeb("node:fs")
            .statSync(path.join(repoRoot, candidate))
            .isFile()
        ) {
          return candidate;
        }
      } catch {
        // Continue with the next source extension.
      }
    }
    return `${relative}.tsx`;
  }
  function resolveUiExport(exportName) {
    if (!uiExportCache.size) {
      const index = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, "packages/ui/src/index.ts"),
        "utf8",
      );
      for (const block of index.matchAll(
        /export\s*\{([\s\S]*?)\}\s*from\s*["']\.\/components\/([^"']+)["']/gu,
      )) {
        const file = `packages/ui/src/components/${block[2]}.tsx`;
        for (const part of block[1].split(",")) {
          const names = part.trim().split(/\s+as\s+/u);
          if (names.length === 1)
            uiExportCache.set(names[0], { file, symbol: names[0] });
          else uiExportCache.set(names[1], { file, symbol: names[0] });
        }
      }
    }
    return uiExportCache.get(exportName);
  }
  function resolveLocalExport(target) {
    const key = `${target.file}|${target.symbol}`;
    if (localExportCache.has(key)) return localExportCache.get(key);
    let source;
    try {
      source = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, target.file),
        "utf8",
      );
    } catch {
      localExportCache.set(key, target);
      return target;
    }
    let resolved = target;
    const visited = new Set([target.symbol]);
    for (let depth = 0; depth < 8; depth += 1) {
      let nextSymbol;
      for (const block of source.matchAll(/export\s*\{([\s\S]*?)\}/gu)) {
        for (const entry of block[1].split(",")) {
          const [original, exported] = entry.trim().split(/\s+as\s+/u);
          if ((exported ?? original) === resolved.symbol && original) {
            nextSymbol = original;
            break;
          }
        }
        if (nextSymbol) break;
      }
      if (!nextSymbol || visited.has(nextSymbol)) break;
      visited.add(nextSymbol);
      resolved = { ...target, symbol: nextSymbol };
    }
    localExportCache.set(key, resolved);
    return resolved;
  }
  function importedComponents(sourcePath) {
    const source = requireFromWeb("node:fs").readFileSync(
      path.join(repoRoot, sourcePath),
      "utf8",
    );
    const imported = new Map();
    for (const match of source.matchAll(
      /(?:function|const)\s+([A-Z][A-Za-z0-9_]*)\s*(?:=\s*)?(?:\(|<|=)/gu,
    )) {
      imported.set(match[1], { file: sourcePath, symbol: match[1] });
    }
    for (const declaration of source.matchAll(
      /import\s+\{([\s\S]*?)\}\s+from\s*["']([^"']+)["']/gu,
    )) {
      const moduleName = declaration[2];
      for (const entry of declaration[1].split(",")) {
        const [original, local] = entry.trim().split(/\s+as\s+/u);
        if (!original) continue;
        if (moduleName === "@taskdesk/ui") {
          const target = resolveUiExport(original);
          if (target) imported.set(local ?? original, target);
        } else if (moduleName.startsWith(".")) {
          const relative = path.resolve(
            path.dirname(path.join(repoRoot, sourcePath)),
            moduleName,
          );
          imported.set(local ?? original, {
            file: sourceModulePath(path.relative(repoRoot, relative)),
            symbol: original,
          });
        } else if (moduleName.startsWith("@/")) {
          const relative = path.join("apps/web/src", moduleName.slice(2));
          imported.set(local ?? original, {
            file: sourceModulePath(relative),
            symbol: original,
          });
        }
      }
    }
    for (const declaration of source.matchAll(
      /import\s+([A-Za-z_$][\w$]*)(?:\s*,\s*\{[\s\S]*?\})?\s+from\s*["']([^"']+)["']/gu,
    )) {
      const localName = declaration[1];
      const moduleName = declaration[2];
      if (localName === "type") continue;
      if (moduleName.startsWith(".")) {
        const relative = path.resolve(
          path.dirname(path.join(repoRoot, sourcePath)),
          moduleName,
        );
        imported.set(localName, {
          file: sourceModulePath(path.relative(repoRoot, relative)),
          symbol: "default",
        });
      } else if (moduleName.startsWith("@/")) {
        const relative = path.join("apps/web/src", moduleName.slice(2));
        imported.set(localName, {
          file: sourceModulePath(relative),
          symbol: "default",
        });
      }
    }
    function resolveDynamicModule(moduleName) {
      const relative = moduleName.startsWith("@/")
        ? path.join("apps/web/src", moduleName.slice(2))
        : moduleName.startsWith(".")
          ? path.relative(
              repoRoot,
              path.resolve(
                path.dirname(path.join(repoRoot, sourcePath)),
                moduleName,
              ),
            )
          : undefined;
      return relative ? sourceModulePath(relative) : undefined;
    }
    for (const lazy of source.matchAll(
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*lazy\(\s*(?:([A-Za-z_$][\w$]*)|(?:\(\s*\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*,?))\s*\)/gu,
    )) {
      let target;
      if (lazy[3]) {
        const file = resolveDynamicModule(lazy[3]);
        if (file) target = { file, symbol: "default" };
      } else if (lazy[2]) {
        const loader = imported.get(lazy[2]);
        if (loader) {
          const loaderSource = requireFromWeb("node:fs").readFileSync(
            path.join(repoRoot, loader.file),
            "utf8",
          );
          const dynamicPath = loaderSource.match(
            /import\(\s*["']([^"']+)["']\s*\)/u,
          )?.[1];
          if (dynamicPath) {
            const relative = dynamicPath.startsWith("@/")
              ? path.join("apps/web/src", dynamicPath.slice(2))
              : dynamicPath.startsWith(".")
                ? path.relative(
                    repoRoot,
                    path.resolve(
                      path.dirname(path.join(repoRoot, loader.file)),
                      dynamicPath,
                    ),
                  )
                : undefined;
            if (relative)
              target = { file: sourceModulePath(relative), symbol: "default" };
          }
        }
      }
      if (target?.file) imported.set(lazy[1], target);
    }
    // React.lazy also accepts a loader that maps a named module export to its
    // required default component shape. Bind only this explicit mapping; an
    // arbitrary `.then(...)` transform remains unsupported and therefore
    // cannot silently acquire a caller surface.
    for (const lazy of source.matchAll(
      /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*lazy\(\s*\(\s*\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*\.then\(\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\(\s*\{\s*default\s*:\s*\3\.([A-Za-z_$][\w$]*)\s*,?\s*\}\s*\)\s*\)\s*,?\s*\)/gu,
    )) {
      const file = resolveDynamicModule(lazy[2]);
      if (file) imported.set(lazy[1], { file, symbol: lazy[4] });
    }
    for (const [localName, target] of imported)
      imported.set(localName, resolveLocalExport(target));
    return imported;
  }
  function wrapperSurface(target) {
    const normalized = resolveLocalExport(target);
    if (normalized.symbol !== target.symbol) return wrapperSurface(normalized);
    const key = `${target.file}|${target.symbol}`;
    if (wrapperSurfaceCache.has(key)) return wrapperSurfaceCache.get(key);
    if (wrapperSurfaceActive.has(key)) return undefined;
    wrapperSurfaceActive.add(key);
    const absolute = path.join(repoRoot, target.file);
    let source = "";
    try {
      source = requireFromWeb("node:fs").readFileSync(absolute, "utf8");
    } catch {
      wrapperSurfaceCache.set(key, undefined);
      wrapperSurfaceActive.delete(key);
      return undefined;
    }
    const defaultName =
      target.symbol === "default"
        ? source
            .match(
              /export\s+default\s+(?:function|class)\s+([A-Za-z_$][\w$]*)|export\s+default\s+([A-Za-z_$][\w$]*)/u,
            )
            ?.slice(1)
            .find(Boolean)
        : target.symbol;
    if (!defaultName) {
      wrapperSurfaceCache.set(key, undefined);
      wrapperSurfaceActive.delete(key);
      return undefined;
    }
    const start = source.search(
      new RegExp(`(?:function|const)\\s+${defaultName}\\b`, "u"),
    );
    if (start < 0) {
      wrapperSurfaceCache.set(key, undefined);
      return undefined;
    }
    const tail = source.slice(start);
    const next = tail.search(
      /\n(?:export\s+default\s+)?(?:function|const)\s+[A-Z][A-Za-z0-9_]*\b/u,
    );
    const body = next > 0 ? tail.slice(0, next) : tail;
    const surfaces = new Set();
    for (const match of body.matchAll(
      /(?:^|[\s"'`])(bg-[a-z0-9-]+)(?=\s|["'`])/gu,
    )) {
      if (tokenNames.has(match[1].slice(3))) surfaces.add(match[1]);
    }
    let result = surfaces.size === 1 ? [...surfaces][0] : undefined;
    if (surfaces.size === 0) {
      const rootTag = body.match(
        /\breturn\s*(?:\(\s*)?<([A-Z][A-Za-z0-9_]*)/u,
      )?.[1];
      const rootTarget =
        rootTag && importedComponents(target.file).get(rootTag);
      if (rootTarget) result = wrapperSurface(rootTarget);
    }
    wrapperSurfaceCache.set(key, result);
    wrapperSurfaceActive.delete(key);
    return result;
  }
  function callerWrapperSurface(ancestor, sourceFile, target) {
    if (
      target.file === "packages/ui/src/components/button.tsx" &&
      target.symbol === "Button"
    ) {
      const variants = {
        default: "bg-primary",
        destructive: "bg-destructive-strong",
        "destructive-outline": "bg-popover",
        outline: "bg-popover",
        secondary: "bg-secondary",
      };
      const attributes = ts.isJsxElement(ancestor)
        ? ancestor.openingElement.attributes
        : ancestor.attributes;
      const variantAttribute = attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "variant",
      );
      const variant =
        variantAttribute?.initializer &&
        ts.isStringLiteral(variantAttribute.initializer)
          ? variantAttribute.initializer.text
          : variantAttribute
            ? undefined
            : "default";
      const surface = variant ? variants[variant] : undefined;
      const implementation = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, target.file),
        "utf8",
      );
      return surface && implementation.includes(surface) ? surface : undefined;
    }
    return wrapperSurface(target);
  }

  try {
    for (const [index, sourcePath] of absolutePaths.entries()) {
      const sourceFile = snapshot
        .getDefaultProjectForFile(sourcePath)
        .program.getSourceFile(sourcePath);
      if (!sourceFile) {
        unresolved.set(`${sourcePaths[index]}::<source-file-unavailable>`, {
          id: `${sourcePaths[index]}::<source-file-unavailable>`,
          usage: sourcePaths[index],
          component: "<unavailable>",
          ancestry: [],
          foregroundClass: "<source-file-unavailable>",
        });
        continue;
      }
      sourceFilesByPath.set(sourcePaths[index], sourceFile);
      const componentImports = importedComponents(sourcePaths[index]);
      importsByPath.set(sourcePaths[index], componentImports);
      const nonTextComponents = new Set();
      for (const declaration of sourceFile.statements) {
        if (
          !ts.isImportDeclaration(declaration) ||
          declaration.moduleSpecifier.getText(sourceFile) !== '"lucide-react"'
        ) {
          continue;
        }
        const bindings = declaration.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements)
          nonTextComponents.add(element.name.text);
      }
      const occurrenceCounters = new Map();

      function contrastCategory(node, foreground) {
        const tag = ts.isJsxElement(node)
          ? node.openingElement.tagName.getText(sourceFile)
          : node.tagName.getText(sourceFile);
        return nonTextComponents.has(tag) ||
          new Set([
            "svg",
            "circle",
            "ellipse",
            "line",
            "path",
            "polygon",
            "polyline",
            "rect",
          ]).has(tag.toLowerCase()) ||
          foreground.variants.some((variant) => variant.includes("_svg"))
          ? "non-text"
          : "body";
      }

      function returnedObjectProperty(node) {
        const parents = [];
        for (let current = node.parent; current; current = current.parent) {
          parents.push(current);
          if (ts.isFunctionDeclaration(current) || ts.isArrowFunction(current))
            break;
        }
        if (!parents.some(ts.isReturnStatement)) return undefined;
        const property = parents.find(ts.isPropertyAssignment);
        const functionNode = parents.find(
          (parent) =>
            ts.isFunctionDeclaration(parent) || ts.isArrowFunction(parent),
        );
        if (!property || !functionNode) return undefined;
        const propertyName = property.name.getText(sourceFile);
        const functionName = ts.isFunctionDeclaration(functionNode)
          ? functionNode.name?.text
          : ts.isVariableDeclaration(functionNode.parent)
            ? functionNode.parent.name.getText(sourceFile)
            : undefined;
        return functionName ? { functionName, propertyName } : undefined;
      }

      function enclosingFunctionName(node) {
        for (let current = node.parent; current; current = current.parent) {
          if (ts.isFunctionDeclaration(current) && current.name)
            return current.name.text;
          if (
            (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
            ts.isVariableDeclaration(current.parent) &&
            ts.isIdentifier(current.parent.name)
          )
            return current.parent.name.text;
        }
        return undefined;
      }

      function visit(
        node,
        jsxAncestors,
        componentName,
        jsxPath,
        siblingIndex = 0,
      ) {
        let owningComponent = componentName;
        let currentJsxPath = jsxPath;
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          node.parent === sourceFile
        ) {
          owningComponent = node.name.text;
          currentJsxPath = [];
        } else if (
          ts.isVariableDeclaration(node) &&
          node.parent?.parent?.parent === sourceFile &&
          node.name &&
          node.initializer &&
          wrappedFunctionInitializer(node.initializer)
        ) {
          owningComponent = node.name.getText(sourceFile);
          currentJsxPath = [];
        }
        const isElement =
          ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
        const ancestors = isElement ? [...jsxAncestors, node] : jsxAncestors;
        let elementPath = currentJsxPath;
        if (isElement) {
          const tag = ts.isJsxElement(node)
            ? node.openingElement.tagName.getText(sourceFile)
            : node.tagName.getText(sourceFile);
          elementPath = [...currentJsxPath, `${tag}[${siblingIndex}]`];
          const localClasses = classTokens(node, sourceFile);
          const foregrounds = localClasses.filter((entry) => {
            const foreground = parseForegroundUtility(entry, tokenNames);
            return foreground && !foreground.unsupported;
          });
          const localBackgrounds = paintedBackgrounds(node, sourceFile).filter(
            (entry) => {
              const name = entry.utility.match(
                /^bg-([a-z0-9-]+)(?:\/\d+)?$/u,
              )?.[1];
              return name && tokenNames.has(name);
            },
          );
          if (foregrounds.length > 0 && localBackgrounds.length > 0) {
            const attributes = ts.isJsxElement(node)
              ? node.openingElement.attributes
              : node.attributes;
            const classGroups = classNameLiteralGroups(
              attributes.properties
                .filter(
                  (attribute) =>
                    ts.isJsxAttribute(attribute) &&
                    attribute.name.getText(sourceFile) === "className",
                )
                .map((attribute) => attribute.getText(sourceFile))
                .join(" "),
            );
            for (const foreground of foregrounds) {
              const occurrenceBase = `${sourcePaths[index]}::${owningComponent ?? "<module>"}::${elementPath.join("/")}::${foreground.className}`;
              const occurrenceOrdinal =
                occurrenceCounters.get(occurrenceBase) ?? 0;
              occurrenceCounters.set(occurrenceBase, occurrenceOrdinal + 1);
              const occurrenceId = `${occurrenceBase}#${occurrenceOrdinal}`;
              const foregroundToken = `--color-${parseForegroundUtility(foreground, tokenNames).name}`;
              for (const classGroup of classGroups) {
                const direct = observedPairsInSources(
                  [`<div className=${JSON.stringify(classGroup)} />`],
                  tokenNames,
                );
                for (const key of direct) {
                  if (!key.startsWith(`${foregroundToken}|`)) continue;
                  const keyTail = key.split("|").slice(4);
                  const keyForeground = keyTail.find((part) =>
                    part.startsWith("text-"),
                  );
                  const foregroundUtility = parseClassToken(
                    foreground.className,
                  ).utility;
                  const tokenUtility = foregroundToken.replace(
                    /^--color-/u,
                    "text-",
                  );
                  if (
                    (foregroundUtility === tokenUtility && keyForeground) ||
                    (foregroundUtility !== tokenUtility &&
                      keyForeground !== foregroundUtility)
                  )
                    continue;
                  const backgroundClass = key.split("|")[2];
                  const backgroundToken = backgroundClass.match(
                    /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
                  )?.[1];
                  if (
                    backgroundToken &&
                    isTranslucentBackgroundUtility(
                      backgroundClass,
                      translucentBackgroundTokens,
                    )
                  ) {
                    const alphaUse = alphaSurfaceUses.get(occurrenceId) ?? {
                      occurrence: {
                        id: occurrenceId,
                        usage: sourcePaths[index],
                        component: owningComponent ?? "<module>",
                        ancestry: elementPath,
                        foregroundClass: foreground.className,
                        category: contrastCategory(node, foreground),
                      },
                      node,
                      ancestors: jsxAncestors,
                      path: elementPath,
                      owner: owningComponent ?? "<module>",
                      surfaces: [],
                    };
                    alphaUse.surfaces.push({
                      className: backgroundClass,
                      theme: key.split("|")[3],
                    });
                    alphaSurfaceUses.set(occurrenceId, alphaUse);
                    continue;
                  }
                  directOccurrenceUses.add(`${occurrenceId}|${key}`);
                  const contexts = uses.occurrences?.get(key) ?? [];
                  const context = {
                    id: occurrenceId,
                    usage: sourcePaths[index],
                    component: owningComponent ?? "<module>",
                    ancestry: elementPath,
                    foregroundClass: foreground.className,
                    backgroundClass: key.split("|")[2],
                    surfaceContext: "same-element",
                    category: contrastCategory(node, foreground),
                    chain: [
                      `${sourcePaths[index]}:${owningComponent ?? "<module>"}`,
                      `jsx:${elementPath.join("/")}>${key.split("|")[2]}`,
                    ],
                  };
                  if (
                    !contexts.some(
                      (item) =>
                        item.id === context.id &&
                        item.surfaceContext === context.surfaceContext &&
                        item.backgroundClass === context.backgroundClass &&
                        JSON.stringify(item.chain) ===
                          JSON.stringify(context.chain),
                    )
                  )
                    contexts.push(context);
                  const occurrenceUses = uses.occurrences ?? new Map();
                  occurrenceUses.set(key, contexts);
                  uses.occurrences = occurrenceUses;
                }
              }
            }
          }
          if (foregrounds.length > 0 && localBackgrounds.length === 0) {
            let inheritedBackgrounds = [];
            let importedSurface;
            let importedSurfaceComponent;
            let importedSurfaceTarget;
            const importedTranslucentLayers = [];
            let translucentAncestors = [];
            let activeSurfaceBranches = [
              { translucent: [], themes: ["light", "dark"] },
            ];
            let unsupportedAncestorSurface = false;
            for (const ancestor of [...jsxAncestors].reverse()) {
              const ancestorBackgrounds = paintedBackgroundOptions(
                ancestor,
                sourceFile,
              );
              if (ancestorBackgrounds === undefined) {
                unsupportedAncestorSurface = true;
                break;
              }
              if (ancestorBackgrounds.length === 0) {
                const tag = ts.isJsxElement(ancestor)
                  ? ancestor.openingElement.tagName.getText(sourceFile)
                  : ancestor.tagName.getText(sourceFile);
                const target = componentImports.get(tag);
                const surface = target
                  ? callerWrapperSurface(ancestor, sourceFile, target)
                  : undefined;
                if (!surface) continue;
                const wrapperOption = {
                  ...parseClassToken(surface),
                  sourceChain: `${tag}->${target.file}:${target.symbol}`,
                  sourceWrapper: tag,
                  wrapper: tag,
                  wrapperTarget: target,
                };
                const name = wrapperOption.utility.match(
                  /^bg-([a-z0-9-]+)(?:\/\d+)?$/u,
                )?.[1];
                if (!name || !tokenNames.has(name)) continue;
                ancestorBackgrounds.push({
                  ...wrapperOption,
                  themes: wrapperOption.variants.includes("dark")
                    ? ["dark"]
                    : wrapperOption.variants.includes("light")
                      ? ["light"]
                      : ["light", "dark"],
                });
              }
              const nextBranches = [];
              for (const branch of activeSurfaceBranches) {
                for (const background of ancestorBackgrounds) {
                  const themes = branch.themes.filter((theme) =>
                    background.themes.includes(theme),
                  );
                  if (themes.length === 0) continue;
                  if (
                    isOpaqueBackgroundUtility(
                      background.className,
                      translucentBackgroundTokens,
                    )
                  ) {
                    if (branch.translucent.length > 0) {
                      const nearestAlpha = branch.translucent[0];
                      inheritedBackgrounds.push({
                        ...nearestAlpha,
                        themes,
                        backdropLayers: [
                          ...branch.translucent
                            .slice(1)
                            .map((layer) => layer.className),
                          background.className,
                        ],
                      });
                    } else {
                      inheritedBackgrounds.push({ ...background, themes });
                    }
                  } else {
                    nextBranches.push({
                      translucent: [...branch.translucent, background],
                      themes,
                    });
                  }
                }
                if (ancestorBackgrounds.hasUnpainted === true)
                  nextBranches.push(branch);
              }
              activeSurfaceBranches = nextBranches;
              if (activeSurfaceBranches.length === 0) break;
            }
            if (unsupportedAncestorSurface) inheritedBackgrounds = [];
            translucentAncestors = activeSurfaceBranches.flatMap(
              (branch) => branch.translucent,
            );
            if (inheritedBackgrounds.length === 0) {
              for (const ancestor of [...jsxAncestors].reverse()) {
                const tag = ts.isJsxElement(ancestor)
                  ? ancestor.openingElement.tagName.getText(sourceFile)
                  : ancestor.tagName.getText(sourceFile);
                const target = componentImports.get(tag);
                if (!target) continue;
                const callerBackground = classTokens(ancestor, sourceFile).some(
                  (entry) => /^bg-[a-z0-9-]+/u.test(entry.utility),
                );
                if (callerBackground) break;
                const surface = callerWrapperSurface(
                  ancestor,
                  sourceFile,
                  target,
                );
                if (!surface) continue;
                if (
                  isTranslucentBackgroundUtility(
                    surface,
                    translucentBackgroundTokens,
                  )
                ) {
                  importedTranslucentLayers.push(surface);
                  continue;
                }
                importedSurface = surface;
                importedSurfaceComponent = tag;
                importedSurfaceTarget = target;
                break;
              }
            }
            for (const foreground of foregrounds) {
              const fgName = parseForegroundUtility(
                foreground,
                tokenNames,
              )?.name;
              if (!fgName) continue;
              const occurrenceBase = `${sourcePaths[index]}::${owningComponent ?? "<module>"}::${elementPath.join("/")}::${foreground.className}`;
              const occurrenceOrdinal =
                occurrenceCounters.get(occurrenceBase) ?? 0;
              occurrenceCounters.set(occurrenceBase, occurrenceOrdinal + 1);
              const occurrenceId = `${occurrenceBase}#${occurrenceOrdinal}`;
              const returnProperty = returnedObjectProperty(node);
              const context = {
                id: occurrenceId,
                usage: sourcePaths[index],
                component: owningComponent ?? "<module>",
                ancestry: elementPath,
                foregroundClass: foreground.className,
                category: contrastCategory(node, foreground),
                ...(returnProperty ? { returnProperty } : {}),
              };
              if (inheritedBackgrounds.length === 0 && !importedSurface) {
                unresolved.set(occurrenceId, {
                  ...context,
                  sourceNode: node,
                  sourceAncestors: jsxAncestors,
                  sourceOwner: owningComponent ?? "<module>",
                  pendingAlphaSurfaces: translucentAncestors.map((entry) => ({
                    className: entry.className,
                    themes: ["light", "dark"],
                    chain: [
                      `${sourcePaths[index]}:${owningComponent ?? "<module>"}`,
                      `jsx:${elementPath.join("/")}>${entry.className}`,
                    ],
                  })),
                  localFunctionName: enclosingFunctionName(node),
                });
                continue;
              }
              const surfaces = importedSurface
                ? [
                    {
                      className: importedSurface,
                      wrapper: importedSurfaceComponent,
                      backdropLayers: importedTranslucentLayers,
                    },
                  ]
                : inheritedBackgrounds;
              for (const background of surfaces) {
                const bgName = background.className.match(
                  /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
                )?.[1];
                if (!bgName) continue;
                for (const theme of ["light", "dark"]) {
                  if (background.themes && !background.themes.includes(theme))
                    continue;
                  const key = contrastPairKey(
                    `--color-${fgName}`,
                    `--color-${bgName}`,
                    background.className,
                    theme,
                    foreground.className,
                    background.backdropLayers ?? [],
                  );
                  pairs.add(key);
                  uses.add(`${sourcePaths[index]}|${key}`);
                  if (background.wrapper)
                    importedUses.add(`${sourcePaths[index]}|${key}`);
                  const occurrenceUses = uses.occurrences ?? new Map();
                  const contexts = occurrenceUses.get(key) ?? [];
                  const inheritedContext = {
                    ...context,
                    backgroundClass: background.className,
                    backdropLayers: background.backdropLayers ?? [],
                    surfaceContext: background.wrapper
                      ? "imported-opaque-wrapper"
                      : "nearest-opaque-ancestor",
                    chain: background.wrapper
                      ? [
                          `${sourcePaths[index]}:${owningComponent ?? "<module>"}`,
                          `jsx:${elementPath.join("/")}`,
                          `${background.wrapper}->${(background.wrapperTarget ?? importedSurfaceTarget).file}:${(background.wrapperTarget ?? importedSurfaceTarget).symbol}>${background.className}`,
                        ]
                      : background.cssClass
                        ? [
                            `${sourcePaths[index]}:${owningComponent ?? "<module>"}`,
                            `jsx:${elementPath.join("/")}`,
                            `css:.${background.cssClass}>background:var(--${bgName})`,
                          ]
                        : background.sourceChain
                          ? [
                              `${sourcePaths[index]}:${owningComponent ?? "<module>"}`,
                              `jsx:${elementPath.join("/")}`,
                              background.sourceChain,
                              ...(background.backdropLayers ?? []),
                            ]
                          : (context.chain ?? [
                              `${sourcePaths[index]}:${owningComponent ?? "<module>"}`,
                              `jsx:${elementPath.join("/")}>${background.className}`,
                            ]),
                    ...(background.wrapper
                      ? { wrapper: background.wrapper }
                      : {}),
                  };
                  if (
                    !contexts.some(
                      (item) =>
                        item.id === inheritedContext.id &&
                        item.surfaceContext ===
                          inheritedContext.surfaceContext &&
                        item.backgroundClass ===
                          inheritedContext.backgroundClass &&
                        JSON.stringify(item.chain) ===
                          JSON.stringify(inheritedContext.chain),
                    )
                  )
                    contexts.push(inheritedContext);
                  occurrenceUses.set(key, contexts);
                  uses.occurrences = occurrenceUses;
                  if (!pairDetails.has(key)) {
                    pairDetails.set(key, {
                      usage: sourcePaths[index],
                      foregroundClass: foreground.className,
                      backgroundClass: background.className,
                    });
                  }
                }
              }
            }
          }
        }
        const siblingOrdinals = new Map();
        node.forEachChild((child) => {
          let ordinal = 0;
          if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
            const tag = ts.isJsxElement(child)
              ? child.openingElement.tagName.getText(sourceFile)
              : child.tagName.getText(sourceFile);
            ordinal = siblingOrdinals.get(tag) ?? 0;
            siblingOrdinals.set(tag, ordinal + 1);
          }
          visit(child, ancestors, owningComponent, elementPath, ordinal);
        });
      }

      visit(sourceFile, [], undefined, []);
    }

    const routeDefinitions = [...sourceFilesByPath.entries()]
      .filter(([sourcePath]) => sourcePath.startsWith("apps/web/src/routes/"))
      .flatMap(([sourcePath, sourceFile]) => {
        const routePath = sourceFile
          .getText()
          .match(/createFileRoute\(\s*["']([^"']+)["']/u)?.[1];
        return routePath ? [{ sourcePath, sourceFile, routePath }] : [];
      });
    const routeSurfaceCache = new Map();
    function outletSurfaces(sourceFile) {
      const found = new Set();
      const unsupported = { value: false };
      function inspect(node, ancestors) {
        const isElement =
          ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
        const nextAncestors = isElement ? [...ancestors, node] : ancestors;
        if (isElement) {
          const tag = ts.isJsxElement(node)
            ? node.openingElement.tagName.getText(sourceFile)
            : node.tagName.getText(sourceFile);
          if (tag === "Outlet") {
            let nearest = [];
            for (const ancestor of [...ancestors].reverse()) {
              const backgrounds = classTokens(ancestor, sourceFile).filter(
                (entry) => {
                  const name = entry.utility.match(
                    /^bg-([a-z0-9-]+)(?:\/\d+)?$/u,
                  )?.[1];
                  return name && tokenNames.has(name);
                },
              );
              if (backgrounds.length === 0) continue;
              if (backgrounds.some((entry) => entry.variants.length > 0)) {
                unsupported.value = true;
                break;
              }
              nearest = backgrounds;
              break;
            }
            if (nearest.length !== 1) unsupported.value = true;
            else found.add(nearest[0].className);
          }
        }
        node.forEachChild((child) => inspect(child, nextAncestors));
      }
      inspect(sourceFile, []);
      return unsupported.value || found.size !== 1 ? undefined : [...found][0];
    }
    function routeLayoutSurface(sourcePath, active = new Set()) {
      if (routeSurfaceCache.has(sourcePath))
        return routeSurfaceCache.get(sourcePath);
      if (active.has(sourcePath)) return undefined;
      const route = routeDefinitions.find(
        (candidate) => candidate.sourcePath === sourcePath,
      );
      if (!route) return undefined;
      const nextActive = new Set(active).add(sourcePath);
      const parent = routeDefinitions
        .filter(
          (candidate) =>
            candidate.sourcePath !== sourcePath &&
            candidate.routePath.length < route.routePath.length &&
            route.routePath.startsWith(`${candidate.routePath}/`),
        )
        .sort(
          (left, right) => right.routePath.length - left.routePath.length,
        )[0];
      if (parent) {
        const surface = outletSurfaces(parent.sourceFile);
        if (surface) {
          const result = {
            backgroundClass: surface,
            chain: [
              `${route.sourcePath}:${route.routePath}`,
              `${parent.sourcePath}:Outlet>${surface}`,
            ],
          };
          routeSurfaceCache.set(sourcePath, result);
          return result;
        }
        const inherited = routeLayoutSurface(parent.sourcePath, nextActive);
        if (inherited) {
          const result = {
            ...inherited,
            chain: [
              `${route.sourcePath}:${route.routePath}`,
              ...inherited.chain,
            ],
          };
          routeSurfaceCache.set(sourcePath, result);
          return result;
        }
      }
      const indexCss = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, "apps/web/src/index.css"),
        "utf8",
      );
      const bodyBackground = indexCss.match(/body\s*\{([^}]*)\}/su)?.[1];
      const bodyPaintsBackground =
        bodyBackground &&
        (/(?:^|\s)bg-background(?:\s|$)/u.test(bodyBackground) ||
          /@apply\s+[^;}]*\bbg-background\b/u.test(bodyBackground));
      if (bodyPaintsBackground) {
        const result = {
          backgroundClass: "bg-background",
          chain: [
            `${route.sourcePath}:${route.routePath}`,
            "apps/web/src/index.css:body>@apply bg-background",
          ],
        };
        routeSurfaceCache.set(sourcePath, result);
        return result;
      }
      routeSurfaceCache.set(sourcePath, undefined);
      return undefined;
    }

    const componentCallSitesCache = new Map();
    function componentCallSites(target) {
      const targetKey = `${target.file}|${target.symbol}`;
      if (componentCallSitesCache.has(targetKey))
        return componentCallSitesCache.get(targetKey);
      const calls = [];
      function matchesTarget(imported) {
        if (imported?.file !== target.file) return false;
        if (imported.symbol === target.symbol) return true;
        if (imported.symbol !== "default") return false;
        const source = requireFromWeb("node:fs").readFileSync(
          path.join(repoRoot, target.file),
          "utf8",
        );
        const defaultName = source
          .match(
            /export\s+default\s+(?:function|class)\s+([A-Za-z_$][\w$]*)|export\s+default\s+([A-Za-z_$][\w$]*)/u,
          )
          ?.slice(1)
          .find(Boolean);
        const exportedName =
          source.match(
            /export\s+default\s+memo\(\s*([A-Za-z_$][\w$]*)\s*\)/u,
          )?.[1] ?? defaultName;
        return exportedName === target.symbol;
      }
      for (const [callerPath, sourceFile] of sourceFilesByPath) {
        if (/\.(?:test|spec)\.(?:tsx|jsx)$/u.test(callerPath)) continue;
        const imports = importsByPath.get(callerPath) ?? new Map();
        function find(
          node,
          ancestors,
          componentName,
          jsxPath,
          siblingIndex = 0,
        ) {
          let owner = componentName;
          let currentPath = jsxPath;
          if (
            ts.isFunctionDeclaration(node) &&
            node.name &&
            node.parent === sourceFile
          ) {
            owner = node.name.text;
            currentPath = [];
          } else if (
            ts.isVariableDeclaration(node) &&
            node.name &&
            node.initializer &&
            wrappedFunctionInitializer(node.initializer)
          ) {
            owner = node.name.getText(sourceFile);
            currentPath = [];
          }
          const isElement =
            ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
          const nextAncestors = isElement ? [...ancestors, node] : ancestors;
          let nextPath = currentPath;
          if (isElement) {
            const tag = ts.isJsxElement(node)
              ? node.openingElement.tagName.getText(sourceFile)
              : node.tagName.getText(sourceFile);
            nextPath = [...currentPath, `${tag}[${siblingIndex}]`];
            const imported = imports.get(tag);
            const attributes = ts.isJsxElement(node)
              ? node.openingElement.attributes
              : node.attributes;
            const explicitlyUnstyled = attributes.properties.some(
              (attribute) =>
                ts.isJsxAttribute(attribute) &&
                attribute.name.getText(sourceFile) === "unstyled" &&
                (!attribute.initializer ||
                  attribute.initializer.kind === ts.SyntaxKind.TrueKeyword),
            );
            if (matchesTarget(imported) && !explicitlyUnstyled) {
              calls.push({
                node,
                ancestors,
                callerPath,
                owner,
                path: nextPath,
                target,
              });
            }
          }
          const calledImport =
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            matchesTarget(imports.get(node.expression.text));
          const calledLocalFunction =
            callerPath === target.file &&
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === target.symbol;
          if ((calledImport || calledLocalFunction) && ancestors.length > 0) {
            calls.push({
              node,
              ancestors,
              callerPath,
              owner,
              path: nextPath,
              target,
            });
          }
          const siblingCounts = new Map();
          node.forEachChild((child) => {
            let ordinal = 0;
            if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
              const tag = ts.isJsxElement(child)
                ? child.openingElement.tagName.getText(sourceFile)
                : child.tagName.getText(sourceFile);
              ordinal = siblingCounts.get(tag) ?? 0;
              siblingCounts.set(tag, ordinal + 1);
            }
            find(child, nextAncestors, owner, nextPath, ordinal);
          });
        }
        find(sourceFile, [], undefined, []);
      }
      componentCallSitesCache.set(targetKey, calls);
      return calls;
    }
    function returnedPropertyCallSites(sourcePath, returnProperty) {
      const sourceFile = sourceFilesByPath.get(sourcePath);
      if (!sourceFile) return [];
      const calls = [];
      function find(node, ancestors, owner, jsxPath, siblingIndex = 0) {
        let currentOwner = owner;
        let currentPath = jsxPath;
        if (ts.isFunctionDeclaration(node) && node.name)
          currentOwner = node.name.text;
        else if (
          ts.isVariableDeclaration(node) &&
          node.name &&
          node.initializer &&
          wrappedFunctionInitializer(node.initializer)
        )
          currentOwner = node.name.getText(sourceFile);
        const isElement =
          ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
        const nextAncestors = isElement ? [...ancestors, node] : ancestors;
        if (isElement) {
          const tag = ts.isJsxElement(node)
            ? node.openingElement.tagName.getText(sourceFile)
            : node.tagName.getText(sourceFile);
          currentPath = [...jsxPath, `${tag}[${siblingIndex}]`];
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === returnProperty.functionName &&
          ts.isPropertyAccessExpression(node.parent) &&
          node.parent.expression === node &&
          node.parent.name.text === returnProperty.propertyName
        ) {
          calls.push({
            node,
            ancestors,
            callerPath: sourcePath,
            owner: currentOwner,
            path: currentPath,
          });
        }
        const siblingCounts = new Map();
        node.forEachChild((child) => {
          let ordinal = 0;
          if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
            const tag = ts.isJsxElement(child)
              ? child.openingElement.tagName.getText(sourceFile)
              : child.tagName.getText(sourceFile);
            ordinal = siblingCounts.get(tag) ?? 0;
            siblingCounts.set(tag, ordinal + 1);
          }
          find(child, nextAncestors, currentOwner, currentPath, ordinal);
        });
      }
      find(sourceFile, [], undefined, []);
      return calls;
    }
    function localFunctionCallSites(sourcePath, functionName, lexicalOwner) {
      const sourceFile = sourceFilesByPath.get(sourcePath);
      if (!sourceFile || !functionName) return [];
      const calls = [];
      function find(node, ancestors, owner, jsxPath, siblingIndex = 0) {
        let currentOwner = owner;
        let currentPath = jsxPath;
        if (ts.isFunctionDeclaration(node) && node.name)
          currentOwner = node.name.text;
        else if (
          (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
          ts.isVariableDeclaration(node.parent) &&
          ts.isIdentifier(node.parent.name)
        )
          currentOwner = node.parent.name.text;
        const isElement =
          ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
        const nextAncestors = isElement ? [...ancestors, node] : ancestors;
        if (isElement) {
          const tag = ts.isJsxElement(node)
            ? node.openingElement.tagName.getText(sourceFile)
            : node.tagName.getText(sourceFile);
          currentPath = [...jsxPath, `${tag}[${siblingIndex}]`];
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === functionName &&
          currentOwner === lexicalOwner &&
          ancestors.length > 0
        ) {
          calls.push({
            node,
            ancestors,
            callerPath: sourcePath,
            owner: currentOwner,
            path: currentPath,
          });
        }
        const siblingCounts = new Map();
        node.forEachChild((child) => {
          let ordinal = 0;
          if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
            const tag = ts.isJsxElement(child)
              ? child.openingElement.tagName.getText(sourceFile)
              : child.tagName.getText(sourceFile);
            ordinal = siblingCounts.get(tag) ?? 0;
            siblingCounts.set(tag, ordinal + 1);
          }
          find(child, nextAncestors, currentOwner, currentPath, ordinal);
        });
      }
      find(sourceFile, [], undefined, []);
      return calls;
    }
    function functionReturnBackgroundOptions(target) {
      const sourceFile = sourceFilesByPath.get(target.file);
      if (!sourceFile) return undefined;
      const declarationName = target.symbol;
      const roots = [];
      function findDeclaration(node) {
        const namedFunction =
          ts.isFunctionDeclaration(node) && node.name?.text === declarationName;
        const variableFunction =
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === declarationName &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) ||
            ts.isFunctionExpression(node.initializer));
        if (namedFunction || variableFunction) {
          const body = namedFunction
            ? node.body
            : wrappedFunctionInitializer(node.initializer)?.body;
          if (body) {
            function findReturns(current) {
              if (ts.isReturnStatement(current) && current.expression) {
                let expression = current.expression;
                while (ts.isParenthesizedExpression(expression))
                  expression = expression.expression;
                if (
                  ts.isJsxElement(expression) ||
                  ts.isJsxSelfClosingElement(expression)
                )
                  roots.push(expression);
                else if (
                  ts.isConditionalExpression(expression) ||
                  ts.isBinaryExpression(expression)
                ) {
                  function findJsx(value) {
                    if (
                      ts.isJsxElement(value) ||
                      ts.isJsxSelfClosingElement(value)
                    )
                      roots.push(value);
                    else value.forEachChild(findJsx);
                  }
                  findJsx(expression);
                }
              }
              if (
                current !== body &&
                (ts.isFunctionDeclaration(current) ||
                  ts.isFunctionExpression(current) ||
                  ts.isArrowFunction(current))
              )
                return;
              current.forEachChild(findReturns);
            }
            if (ts.isBlock(body)) findReturns(body);
            else if (ts.isJsxElement(body) || ts.isJsxSelfClosingElement(body))
              roots.push(body);
          }
          return;
        }
        node.forEachChild(findDeclaration);
      }
      findDeclaration(sourceFile);
      const options = [];
      for (const root of roots) {
        const backgrounds = paintedBackgroundOptions(root, sourceFile);
        if (backgrounds === undefined) return undefined;
        options.push(...backgrounds);
      }
      return options;
    }
    function callerSurface(call, active = new Set(), depth = 0, pending = []) {
      if (depth > 8) return undefined;
      const callerFile = sourceFilesByPath.get(call.callerPath);
      if (!callerFile) return undefined;
      if (ts.isJsxElement(call.node) || ts.isJsxSelfClosingElement(call.node)) {
        const ownBackgrounds = classTokens(call.node, callerFile).filter(
          (entry) => {
            const name = entry.utility.match(
              /^bg-([a-z0-9-]+)(?:\/\d+)?$/u,
            )?.[1];
            return name && tokenNames.has(name);
          },
        );
        if (ownBackgrounds.length === 1 && call.target) {
          const targetSource = requireFromWeb("node:fs").readFileSync(
            path.join(repoRoot, call.target.file),
            "utf8",
          );
          const targetName =
            call.target.symbol === "default"
              ? targetSource.match(
                  /export\s+default\s+([A-Za-z_$][\w$]*)/u,
                )?.[1]
              : call.target.symbol;
          const rootBinding =
            targetName &&
            /<[A-Za-z_$][\w.$]*\b[^>]*className=\{[^}]*\bclassName\b[^}]*\}/u.test(
              targetSource.slice(
                targetSource.search(
                  new RegExp(`(?:function|const)\\s+${targetName}\\b`, "u"),
                ),
              ),
            );
          if (
            rootBinding &&
            ownBackgrounds[0].variants.length === 0 &&
            opaqueBackground(ownBackgrounds[0])
          ) {
            return [
              {
                className: ownBackgrounds[0].className,
                backdropClass: ownBackgrounds[0].className,
                chain: [
                  `${call.callerPath}:${call.owner ?? "<module>"}`,
                  `jsx:${call.path.join("/")}:root-className`,
                ],
              },
            ];
          }
        }
      }
      const imports = importsByPath.get(call.callerPath) ?? new Map();
      let pendingOptions = pending;
      const resolvedOptions = [];
      let unpaintedPossible = false;
      if (ts.isCallExpression(call.node) && call.target) {
        const returned = functionReturnBackgroundOptions(call.target);
        if (returned === undefined) return undefined;
        if (returned.length > 0) {
          const opaque = returned.filter(opaqueBackground);
          const translucent = returned.filter(
            (background) => !opaqueBackground(background),
          );
          if (pendingOptions.length > 0 && opaque.length > 0) {
            pendingOptions = pendingOptions.flatMap((foregroundSurface) =>
              opaque.flatMap((backdrop) => {
                const themes = foregroundSurface.themes.filter((theme) =>
                  backdrop.themes.includes(theme),
                );
                return themes.length === 0
                  ? []
                  : [
                      {
                        className: foregroundSurface.className,
                        backdropClass: backdrop.className,
                        themes,
                        chain: [
                          ...foregroundSurface.chain,
                          `function-return:${call.target.file}:${call.target.symbol}`,
                          `opaque-backdrop:${backdrop.className}`,
                        ],
                      },
                    ];
              }),
            );
          } else if (pendingOptions.length === 0 && opaque.length > 0) {
            pendingOptions = opaque.map((background) => ({
              className: background.className,
              backdropClass: background.className,
              themes: background.themes,
              chain: [
                `function-return:${call.target.file}:${call.target.symbol}`,
              ],
            }));
          }
          if (translucent.length > 0) {
            if (pendingOptions.length > 0) return undefined;
            pendingOptions = translucent.map((background) => ({
              className: background.className,
              themes: background.themes,
              chain: [
                `function-return:${call.target.file}:${call.target.symbol}`,
              ],
            }));
          }
        }
      }
      for (const ancestor of [...call.ancestors].reverse()) {
        const backgrounds = paintedBackgroundOptions(ancestor, callerFile);
        if (backgrounds === undefined) return undefined;
        if (backgrounds.length > 0) {
          unpaintedPossible ||= backgrounds.hasUnpainted === true;
          const chain = [
            `${call.callerPath}:${call.owner ?? "<module>"}`,
            `jsx:${call.path.join("/")}`,
          ];
          const opaque = [];
          const translucent = [];
          const hadPending = pendingOptions.length > 0;
          for (const background of backgrounds) {
            (opaqueBackground(background) ? opaque : translucent).push(
              background,
            );
          }
          if (pendingOptions.length > 0 && opaque.length > 0) {
            resolvedOptions.push(
              ...pendingOptions.flatMap((foregroundSurface) =>
                opaque.flatMap((backdrop) => {
                  const themes = foregroundSurface.themes.filter((theme) =>
                    backdrop.themes.includes(theme),
                  );
                  return themes.length === 0
                    ? []
                    : [
                        {
                          className: foregroundSurface.className,
                          backdropClass: backdrop.className,
                          backdropLayers: [
                            ...(foregroundSurface.backdropLayers ?? []),
                            backdrop.className,
                          ],
                          themes,
                          chain: [
                            ...foregroundSurface.chain,
                            ...chain,
                            `opaque-backdrop:${backdrop.className}`,
                          ],
                        },
                      ];
                }),
              ),
            );
            pendingOptions = [];
          }
          if (!hadPending && opaque.length > 0) {
            resolvedOptions.push(
              ...opaque.map((background) => ({
                className: background.className,
                backdropClass: background.className,
                backdropLayers: [],
                themes: background.themes,
                chain,
              })),
            );
          }
          if (translucent.length > 0) {
            pendingOptions =
              pendingOptions.length > 0
                ? pendingOptions.flatMap((foregroundSurface) =>
                    translucent.flatMap((background) => {
                      const themes = foregroundSurface.themes.filter((theme) =>
                        background.themes.includes(theme),
                      );
                      return themes.length === 0
                        ? []
                        : [
                            {
                              ...foregroundSurface,
                              backdropLayers: [
                                ...(foregroundSurface.backdropLayers ?? []),
                                background.className,
                              ],
                              themes,
                              chain: [...foregroundSurface.chain, ...chain],
                            },
                          ];
                    }),
                  )
                : translucent.map((background) => ({
                    className: background.className,
                    backdropLayers: [],
                    themes: background.themes,
                    chain,
                  }));
          }
          if (backgrounds.hasUnpainted !== true && pendingOptions.length === 0)
            return resolvedOptions.length > 0 ? resolvedOptions : undefined;
        }
        const tag = ts.isJsxElement(ancestor)
          ? ancestor.openingElement.tagName.getText(callerFile)
          : ancestor.tagName.getText(callerFile);
        const imported = imports.get(tag);
        if (!imported) continue;
        const callerBackground = classTokens(ancestor, callerFile).some(
          (entry) => /^bg-[a-z0-9-]+/u.test(entry.utility),
        );
        if (callerBackground && !unpaintedPossible) return undefined;
        const surface = callerWrapperSurface(ancestor, callerFile, imported);
        if (surface) {
          const chain = [
            `${call.callerPath}:${call.owner ?? "<module>"}`,
            `${tag}->${imported.file}:${imported.symbol}`,
          ];
          if (
            isTranslucentBackgroundUtility(surface, translucentBackgroundTokens)
          ) {
            const themes = parseClassToken(surface).variants.includes("dark")
              ? ["dark"]
              : ["light", "dark"];
            pendingOptions =
              pendingOptions.length > 0
                ? pendingOptions.map((pendingSurface) => ({
                    ...pendingSurface,
                    backdropLayers: [
                      ...(pendingSurface.backdropLayers ?? []),
                      surface,
                    ],
                    themes: pendingSurface.themes.filter((theme) =>
                      themes.includes(theme),
                    ),
                    chain: [...pendingSurface.chain, ...chain],
                  }))
                : [
                    {
                      className: surface,
                      backdropLayers: [],
                      themes,
                      chain,
                    },
                  ];
            continue;
          }
          const wrapperOptions =
            pendingOptions.length > 0
              ? pendingOptions.map((pendingSurface) => ({
                  ...pendingSurface,
                  backdropClass: surface,
                  backdropLayers: [
                    ...(pendingSurface.backdropLayers ?? []),
                    surface,
                  ],
                  themes: pendingSurface.themes,
                  chain: [...pendingSurface.chain, ...chain],
                }))
              : [
                  {
                    className: surface,
                    backdropClass: surface,
                    backdropLayers: [],
                    themes: ["light", "dark"],
                    chain,
                  },
                ];
          return [...resolvedOptions, ...wrapperOptions];
        }
      }
      const routeSurface = routeLayoutSurface(call.callerPath);
      if (routeSurface)
        return [
          ...resolvedOptions,
          ...(pendingOptions.length > 0
            ? pendingOptions.map((surface) => ({
                ...surface,
                backdropClass: routeSurface.backgroundClass,
                backdropLayers: [
                  ...(surface.backdropLayers ?? []),
                  routeSurface.backgroundClass,
                ],
                themes: surface.themes,
                chain: [...surface.chain, ...routeSurface.chain],
              }))
            : []),
          ...(unpaintedPossible
            ? [
                {
                  className: routeSurface.backgroundClass,
                  backdropClass: routeSurface.backgroundClass,
                  backdropLayers: [routeSurface.backgroundClass],
                  themes: ["light", "dark"],
                  chain: routeSurface.chain,
                },
              ]
            : []),
        ];
      if (
        call.callerPath.startsWith("packages/ui/src/components/") &&
        call.callerPath.endsWith(".stories.tsx")
      ) {
        const preview = requireFromWeb("node:fs").readFileSync(
          path.join(repoRoot, "packages/ui/.storybook/preview.ts"),
          "utf8",
        );
        const styles = requireFromWeb("node:fs").readFileSync(
          path.join(repoRoot, "packages/ui/.storybook/tailwind.css"),
          "utf8",
        );
        const bodySurface = storybookBodySurfaceContract(
          call.callerPath,
          preview,
          styles,
        );
        if (bodySurface)
          return [
            {
              className: pendingOptions[0]?.className ?? bodySurface.className,
              backdropClass: bodySurface.className,
              backdropLayers: [
                ...(pendingOptions[0]?.backdropLayers ?? []),
                bodySurface.className,
              ],
              themes: pendingOptions[0]?.themes ?? ["light", "dark"],
              chain: [
                `${call.callerPath}:${call.owner ?? "<story>"}`,
                ...(pendingOptions[0]?.chain ?? []),
                ...bodySurface.chain.slice(1),
              ],
            },
          ];
      }
      if (!call.owner || call.owner === "<module>") return undefined;
      const key = `${call.callerPath}|${call.owner}`;
      if (active.has(key)) return undefined;
      const nextActive = new Set(active).add(key);
      const nested = componentCallSites({
        file: call.callerPath,
        symbol: call.owner,
      });
      const options = nested.map((item) =>
        callerSurface(item, nextActive, depth + 1, pendingOptions),
      );
      if (options.length === 0 || options.some((item) => !item))
        return undefined;
      return options.flat();
    }
    for (const [occurrenceId, occurrence] of [...unresolved.entries()]) {
      if (
        !occurrence.localFunctionName ||
        occurrence.pendingAlphaSurfaces?.length === 0
      )
        continue;
      const calls = localFunctionCallSites(
        occurrence.usage,
        occurrence.localFunctionName,
        occurrence.sourceOwner,
      );
      if (calls.length === 0) continue;
      const alphaUse = {
        occurrence,
        node: occurrence.sourceNode,
        ancestors: occurrence.sourceAncestors,
        path: occurrence.ancestry,
        owner: occurrence.sourceOwner,
        surfaces: occurrence.pendingAlphaSurfaces.flatMap((surface) =>
          (surface.themes ?? []).map((theme) => ({
            className: surface.className,
            theme,
            chain: surface.chain,
          })),
        ),
        helperCalls: calls,
      };
      alphaSurfaceUses.set(occurrenceId, alphaUse);
      unresolved.delete(occurrenceId);
    }
    for (const [occurrenceId, alphaUse] of alphaSurfaceUses) {
      const { occurrence } = alphaUse;
      const options = [];
      for (const surface of alphaUse.surfaces) {
        if (!classAvailableInTheme(surface.className, surface.theme)) continue;
        let resolved = alphaUse.helperCalls
          ? alphaUse.helperCalls
              .map((call) =>
                callerSurface(call, new Set(), 0, [
                  {
                    className: surface.className,
                    themes: [surface.theme],
                    backdropLayers: [],
                    chain: surface.chain,
                  },
                ]),
              )
              .some((item) => !item)
            ? undefined
            : alphaUse.helperCalls.flatMap((call) =>
                callerSurface(call, new Set(), 0, [
                  {
                    className: surface.className,
                    themes: [surface.theme],
                    backdropLayers: [],
                    chain: surface.chain,
                  },
                ]),
              )
          : callerSurface(
              {
                node: alphaUse.node,
                ancestors: alphaUse.ancestors,
                callerPath: occurrence.usage,
                owner: alphaUse.owner,
                path: alphaUse.path,
              },
              new Set(),
              0,
              [
                {
                  className: surface.className,
                  themes: [surface.theme],
                  backdropLayers: [],
                  chain: [
                    `${occurrence.usage}:${occurrence.component}`,
                    `jsx:${alphaUse.path.join("/")}>${surface.className}`,
                  ],
                },
              ],
            );
        if (!resolved && occurrence.component !== "<module>") {
          const calls = componentCallSites({
            file: occurrence.usage,
            symbol: occurrence.component,
          });
          if (calls.length > 0) {
            const callerOptions = calls.map((call) =>
              callerSurface(call, new Set(), 0, [
                {
                  className: surface.className,
                  themes: [surface.theme],
                  backdropLayers: [],
                  chain: [
                    `${occurrence.usage}:${occurrence.component}`,
                    `jsx:${alphaUse.path.join("/")}>${surface.className}`,
                  ],
                },
              ]),
            );
            resolved = callerOptions.some((item) => !item)
              ? undefined
              : callerOptions.flat();
          }
        }
        if (!resolved) continue;
        options.push(...resolved);
      }
      if (options.length === 0) {
        unresolved.set(occurrenceId, occurrence);
        continue;
      }
      const foreground = parseForegroundUtility(
        parseClassToken(occurrence.foregroundClass),
        tokenNames,
      )?.name;
      if (!foreground) continue;
      for (const surface of options) {
        const background = surface.className.match(
          /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
        )?.[1];
        if (!background) continue;
        for (const theme of surface.themes ?? []) {
          const key = contrastPairKey(
            `--color-${foreground}`,
            `--color-${background}`,
            surface.className,
            theme,
            occurrence.foregroundClass,
            surface.backdropLayers ?? [],
          );
          pairs.add(key);
          uses.add(`${occurrence.usage}|${key}`);
          callerUses.add(`${occurrenceId}|${key}`);
          const contexts = uses.occurrences?.get(key) ?? [];
          contexts.push({
            ...occurrence,
            backgroundClass: surface.className,
            backdropClass: surface.backdropClass,
            backdropLayers: surface.backdropLayers ?? [],
            surfaceContext: "caller-chain",
            chain: surface.chain,
          });
          const occurrenceUses = uses.occurrences ?? new Map();
          occurrenceUses.set(key, contexts);
          uses.occurrences = occurrenceUses;
        }
      }
      unresolved.delete(occurrenceId);
    }
    for (const [sourcePath, occurrences] of [...unresolved.entries()]) {
      if (!sourcePath.startsWith("apps/web/src/routes/")) continue;
      const occurrence = occurrences;
      const surface = routeLayoutSurface(occurrence.usage);
      if (!surface) continue;
      const parsedForeground = parseForegroundUtility(
        parseClassToken(occurrence.foregroundClass),
        tokenNames,
      );
      const fgName = parsedForeground?.name;
      if (!fgName) continue;
      const bgName = surface.backgroundClass.match(/^bg-([a-z0-9-]+)$/u)?.[1];
      if (!bgName) continue;
      for (const theme of ["light", "dark"]) {
        const key = contrastPairKey(
          `--color-${fgName}`,
          `--color-${bgName}`,
          surface.backgroundClass,
          theme,
          occurrence.foregroundClass,
        );
        pairs.add(key);
        uses.add(`${occurrence.usage}|${key}`);
        routeUses.add(`${occurrence.usage}|${key}`);
        const contexts = uses.occurrences?.get(key) ?? [];
        contexts.push({
          ...occurrence,
          backgroundClass: surface.backgroundClass,
          chain: surface.chain,
          surfaceContext: "route-layout-body",
        });
        const occurrenceUses = uses.occurrences ?? new Map();
        occurrenceUses.set(key, contexts);
        uses.occurrences = occurrenceUses;
      }
      unresolved.delete(sourcePath);
    }
    for (const [occurrenceId, occurrence] of [...unresolved.entries()]) {
      const sourcePath = occurrence.usage;
      if (
        !sourcePath?.startsWith("packages/ui/src/components/") ||
        !sourcePath.endsWith(".stories.tsx")
      )
        continue;
      const preview = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, "packages/ui/.storybook/preview.ts"),
        "utf8",
      );
      const styles = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, "packages/ui/.storybook/tailwind.css"),
        "utf8",
      );
      const bodySurface = storybookBodySurfaceContract(
        sourcePath,
        preview,
        styles,
      );
      const foreground = parseForegroundUtility(
        parseClassToken(occurrence.foregroundClass),
        tokenNames,
      )?.name;
      if (!bodySurface || !foreground) continue;
      for (const theme of ["light", "dark"]) {
        const key = contrastPairKey(
          `--color-${foreground}`,
          "--color-background",
          "bg-background",
          theme,
          occurrence.foregroundClass,
        );
        pairs.add(key);
        uses.add(`${sourcePath}|${key}`);
        const contexts = uses.occurrences?.get(key) ?? [];
        contexts.push({
          ...occurrence,
          backgroundClass: "bg-background",
          surfaceContext: "storybook-body",
          chain: [
            `${sourcePath}:${occurrence.component}`,
            `jsx:${occurrence.ancestry.join("/")}`,
            ...bodySurface.chain.slice(1),
          ],
        });
        const occurrenceUses = uses.occurrences ?? new Map();
        occurrenceUses.set(key, contexts);
        uses.occurrences = occurrenceUses;
      }
      unresolved.delete(occurrenceId);
    }
    for (const [occurrenceId, occurrence] of [...unresolved.entries()]) {
      if (!occurrence.returnProperty) continue;
      const calls = returnedPropertyCallSites(
        occurrence.usage,
        occurrence.returnProperty,
      );
      if (calls.length === 0) continue;
      const surfaceOptions = calls.map((call) => callerSurface(call));
      if (surfaceOptions.some((surface) => !surface)) continue;
      const foreground = parseForegroundUtility(
        parseClassToken(occurrence.foregroundClass),
        tokenNames,
      )?.name;
      if (!foreground) continue;
      for (const surface of surfaceOptions.flat()) {
        const background = surface.className.match(
          /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
        )?.[1];
        if (!background) continue;
        for (const theme of ["light", "dark"]) {
          if (
            !(surface.themes ?? ["light", "dark"]).includes(theme) ||
            !classAvailableInTheme(surface.className, theme)
          )
            continue;
          const key = contrastPairKey(
            `--color-${foreground}`,
            `--color-${background}`,
            surface.className,
            theme,
            occurrence.foregroundClass,
            surface.backdropLayers ?? [],
          );
          pairs.add(key);
          uses.add(`${occurrence.usage}|${key}`);
          callerUses.add(`${occurrenceId}|${key}`);
          const contexts = uses.occurrences?.get(key) ?? [];
          contexts.push({
            ...occurrence,
            backgroundClass: surface.className,
            backdropClass: surface.backdropClass,
            backdropLayers: surface.backdropLayers ?? [],
            chain: [
              `${occurrence.usage}:${occurrence.returnProperty.functionName}.${occurrence.returnProperty.propertyName}`,
              ...surface.chain,
            ],
            surfaceContext: "function-return-property",
          });
          const occurrenceUses = uses.occurrences ?? new Map();
          occurrenceUses.set(key, contexts);
          uses.occurrences = occurrenceUses;
        }
      }
      unresolved.delete(occurrenceId);
    }
    for (const [occurrenceId, occurrence] of [...unresolved.entries()]) {
      if (
        occurrence.usage !== "packages/ui/src/components/sidebar.tsx" ||
        !["Sidebar", "SidebarMenuBadge"].includes(occurrence.component)
      )
        continue;
      const target = { file: occurrence.usage, symbol: occurrence.component };
      const calls = componentCallSites(target);
      if (occurrence.component === "SidebarMenuBadge" && calls.length > 0)
        continue;
      if (
        occurrence.component === "Sidebar" &&
        calls.some((call) =>
          classTokens(call.node, sourceFilesByPath.get(call.callerPath)).some(
            (entry) => /^(?:text|bg)-[a-z0-9-]+/u.test(entry.utility),
          ),
        )
      )
        continue;
      const source = requireFromWeb("node:fs").readFileSync(
        path.join(repoRoot, occurrence.usage),
        "utf8",
      );
      const surfaces = sidebarSurfaceContract(
        occurrence,
        source,
        calls.length > 0,
      );
      const foreground = parseForegroundUtility(
        parseClassToken(occurrence.foregroundClass),
        tokenNames,
      )?.name;
      if (!surfaces || !foreground) continue;
      for (const surface of surfaces) {
        const background = surface.className.match(
          /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
        )?.[1];
        if (!background) continue;
        for (const theme of ["light", "dark"]) {
          if (
            !(surface.themes ?? ["light", "dark"]).includes(theme) ||
            !classAvailableInTheme(surface.className, theme)
          )
            continue;
          const key = contrastPairKey(
            `--color-${foreground}`,
            `--color-${background}`,
            surface.className,
            theme,
            occurrence.foregroundClass,
            surface.backdropLayers ?? [],
          );
          pairs.add(key);
          uses.add(`${occurrence.usage}|${key}`);
          const contexts = uses.occurrences?.get(key) ?? [];
          const contractContext = {
            ...occurrence,
            backgroundClass: surface.className,
            backdropClass: surface.backdropClass,
            backdropLayers: surface.backdropLayers ?? [],
            surfaceContext: "component-surface-contract",
            chain: surface.chain,
          };
          if (
            !contexts.some(
              (item) =>
                item.id === contractContext.id &&
                item.surfaceContext === contractContext.surfaceContext &&
                item.backgroundClass === contractContext.backgroundClass &&
                JSON.stringify(item.chain) ===
                  JSON.stringify(contractContext.chain),
            )
          )
            contexts.push(contractContext);
          const occurrenceUses = uses.occurrences ?? new Map();
          occurrenceUses.set(key, contexts);
          uses.occurrences = occurrenceUses;
        }
      }
      unresolved.delete(occurrenceId);
    }
    for (const [occurrenceId, occurrence] of [...unresolved.entries()]) {
      if (!occurrence.component || occurrence.component.startsWith("<"))
        continue;
      const target = { file: occurrence.usage, symbol: occurrence.component };
      const calls = componentCallSites(target);
      if (calls.length === 0) continue;
      const surfaceOptions = calls.map((call) => callerSurface(call));
      if (surfaceOptions.some((surface) => !surface)) continue;
      const foreground = parseForegroundUtility(
        parseClassToken(occurrence.foregroundClass),
        tokenNames,
      )?.name;
      if (!foreground) continue;
      for (const surface of surfaceOptions.flat()) {
        const background = surface.className.match(
          /(?:^|:)bg-([a-z0-9-]+)(?:\/\d+)?$/u,
        )?.[1];
        if (!background) continue;
        for (const theme of ["light", "dark"]) {
          if (
            !(surface.themes ?? ["light", "dark"]).includes(theme) ||
            !classAvailableInTheme(surface.className, theme)
          )
            continue;
          const pairKey = contrastPairKey(
            `--color-${foreground}`,
            `--color-${background}`,
            surface.className,
            theme,
            occurrence.foregroundClass,
            surface.backdropLayers ?? [],
          );
          pairs.add(pairKey);
          uses.add(`${occurrence.usage}|${pairKey}`);
          callerUses.add(`${occurrenceId}|${pairKey}`);
          const occurrenceUses = uses.occurrences ?? new Map();
          const contexts = occurrenceUses.get(pairKey) ?? [];
          contexts.push({
            ...occurrence,
            backgroundClass: surface.className,
            backdropClass: surface.backdropClass,
            backdropLayers: surface.backdropLayers ?? [],
            chain: surface.chain,
            surfaceContext: "caller-chain",
          });
          occurrenceUses.set(pairKey, contexts);
          uses.occurrences = occurrenceUses;
        }
      }
      unresolved.delete(occurrenceId);
    }
  } finally {
    snapshot.dispose();
    parser.close();
  }

  for (const [key, contexts] of uses.occurrences ?? []) {
    const unique = new Map();
    for (const context of contexts) {
      const binding = JSON.stringify([
        context.usage,
        context.id,
        context.surfaceContext,
        context.category,
        context.chain ?? [],
        context.backdropLayers ?? [],
      ]);
      unique.set(binding, context);
    }
    uses.occurrences.set(key, [...unique.values()]);
  }

  return {
    pairs,
    uses,
    pairDetails,
    unresolved,
    importedUses,
    routeUses,
    callerUses,
    directOccurrenceUses,
  };
}

export async function collectContrastSourcePaths() {
  const roots = ["apps/web/src", "packages/ui/src"];
  const files = await Promise.all(
    roots.map((root) =>
      walk(
        path.join(repoRoot, root),
        (file) =>
          (file.endsWith(".tsx") || file.endsWith(".jsx")) &&
          !/\.(?:test|spec)\.(?:tsx|jsx)$/u.test(file),
      ),
    ),
  );
  return files
    .flat()
    .map((file) => path.relative(repoRoot, file))
    .sort();
}

export function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

export function sidebarSurfaceContract(occurrence, source, hasCallers = false) {
  if (occurrence.usage !== "packages/ui/src/components/sidebar.tsx")
    return undefined;
  const section = (name) => {
    const start = source.search(new RegExp(`function ${name}\\b`, "u"));
    if (start < 0) return "";
    const next = source.slice(start + 1).search(/\nfunction [A-Z]/u);
    return source.slice(start, next < 0 ? undefined : start + next + 1);
  };
  if (occurrence.component === "Sidebar") {
    const implementation = section("Sidebar");
    if (
      occurrence.foregroundClass === "text-sidebar-foreground" &&
      implementation.includes("text-sidebar-foreground") &&
      implementation.includes("bg-sidebar")
    ) {
      return [
        {
          className: "bg-sidebar",
          chain: [
            `${occurrence.usage}:Sidebar`,
            "component-owned:sidebar-inner.bg-sidebar",
          ],
        },
      ];
    }
    return undefined;
  }
  if (occurrence.component !== "SidebarMenuBadge" || hasCallers)
    return undefined;
  const badge = section("SidebarMenuBadge");
  if (!badge.includes(occurrence.foregroundClass)) return undefined;
  if (occurrence.foregroundClass === "text-sidebar-foreground") {
    const sidebar = section("Sidebar");
    if (!sidebar.includes("bg-sidebar")) return undefined;
    return [
      {
        className: "bg-sidebar",
        chain: [
          `${occurrence.usage}:SidebarMenuBadge`,
          "component-contract:parent Sidebar > sidebar-inner.bg-sidebar",
        ],
      },
    ];
  }
  const buttonStart = source.indexOf("const sidebarMenuButtonVariants = cva(");
  const buttonEnd = source.indexOf("function SidebarMenuButton", buttonStart);
  const button =
    buttonStart >= 0 && buttonEnd > buttonStart
      ? source.slice(buttonStart, buttonEnd)
      : "";
  if (
    occurrence.foregroundClass ===
      "peer-hover/menu-button:text-sidebar-accent-foreground" &&
    badge.includes("peer-hover/menu-button:text-sidebar-accent-foreground") &&
    button.includes("peer/menu-button") &&
    button.includes("hover:bg-sidebar-accent")
  ) {
    return [
      {
        className: "bg-sidebar-accent",
        backdropClass: "bg-sidebar",
        backdropLayers: ["bg-sidebar"],
        chain: [
          `${occurrence.usage}:SidebarMenuBadge`,
          "peer/menu-button:SidebarMenuButton.hover.bg-sidebar-accent",
          "component-contract:Sidebar > sidebar-inner.bg-sidebar",
        ],
      },
    ];
  }
  if (
    occurrence.foregroundClass ===
      "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground" &&
    badge.includes(
      "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
    ) &&
    button.includes("peer/menu-button") &&
    button.includes("data-[active=true]:bg-sidebar-accent")
  ) {
    return [
      {
        className: "bg-sidebar-accent",
        backdropClass: "bg-sidebar",
        backdropLayers: ["bg-sidebar"],
        chain: [
          `${occurrence.usage}:SidebarMenuBadge`,
          "peer/menu-button:SidebarMenuButton.data-active.bg-sidebar-accent",
          "component-contract:Sidebar > sidebar-inner.bg-sidebar",
        ],
      },
    ];
  }
  return undefined;
}

export function storybookBodySurfaceContract(
  callerPath,
  previewSource,
  styleSource,
) {
  if (
    !callerPath.startsWith("packages/ui/src/components/") ||
    !callerPath.endsWith(".stories.tsx") ||
    !previewSource.includes('import "./tailwind.css"') ||
    !/#storybook-root\s*\{[^}]*background-color:\s*var\(--background\)/su.test(
      styleSource,
    )
  )
    return undefined;
  return {
    className: "bg-background",
    chain: [
      `${callerPath}:<story>`,
      "packages/ui/.storybook/preview.ts:imports tailwind.css",
      "packages/ui/.storybook/tailwind.css:#storybook-root.background-color:var(--background)",
    ],
  };
}

export function composite(fg, bg) {
  const alpha = fg[3] ?? 1;
  return [0, 1, 2].map((index) =>
    Math.round(fg[index] * alpha + bg[index] * (1 - alpha)),
  );
}

function parseColor(value) {
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) {
    const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
    const srgb = value.match(
      new RegExp(
        `^color\\(srgb\\s+(${number})\\s+(${number})\\s+(${number})(?:\\s*\\/\\s*(${number}))?\\s*\\)$`,
        "u",
      ),
    );
    if (srgb)
      return [
        Number(srgb[1]) * 255,
        Number(srgb[2]) * 255,
        Number(srgb[3]) * 255,
        Number(srgb[4] ?? 1),
      ];
    const oklab = value.match(
      new RegExp(
        `^oklab\\(\\s*(${number})(%?)\\s+(${number})\\s+(${number})(?:\\s*\\/\\s*(${number})(%?))?\\s*\\)$`,
        "u",
      ),
    );
    const oklch = value.match(
      new RegExp(
        `^oklch\\(\\s*(${number})(%?)\\s+(${number})\\s+(${number}|none)(?:\\s*\\/\\s*(${number})(%?))?\\s*\\)$`,
        "u",
      ),
    );
    if (!oklab && !oklch)
      throw new Error(
        `Chromium returned an unsupported computed color: ${value}`,
      );
    const lightness =
      Number((oklab ?? oklch)[1]) / ((oklab ?? oklch)[2] ? 100 : 1);
    const a = oklab
      ? Number(oklab[3])
      : Number(oklch[3]) *
        Math.cos((Number(oklch[4] === "none" ? 0 : oklch[4]) * Math.PI) / 180);
    const b = oklab
      ? Number(oklab[4])
      : Number(oklch[3]) *
        Math.sin((Number(oklch[4] === "none" ? 0 : oklch[4]) * Math.PI) / 180);
    const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = lightness - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3;
    const m = m_ ** 3;
    const s = s_ ** 3;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    const encoded = linear.map((channel) => {
      const value =
        channel <= 0.0031308
          ? 12.92 * channel
          : 1.055 * channel ** (1 / 2.4) - 0.055;
      return Math.min(255, Math.max(0, value * 255));
    });
    const color = oklab ?? oklch;
    const alpha =
      color[5] === undefined ? 1 : Number(color[5]) / (color[6] ? 100 : 1);
    return [...encoded, alpha];
  }
  const components = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [components[0], components[1], components[2], components[3] ?? 1];
}

async function main() {
  const pairs = JSON.parse(
    await readFile(path.join(repoRoot, manifestPath), "utf8"),
  );
  const sourcePaths = await collectContrastSourcePaths();
  const sourceText = await Promise.all(
    sourcePaths.map((file) => readFile(path.join(repoRoot, file), "utf8")),
  );
  const theme = await readFile(
    path.join(repoRoot, "packages/ui/src/styles/theme.css"),
    "utf8",
  );
  const tokenNames = new Set(
    [...theme.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
  tokenNames.add("white");
  const translucentBackgroundTokens = new Set(
    [...theme.matchAll(/--([a-z0-9-]+)\s*:\s*--alpha\(/gu)].map(
      (match) => match[1],
    ),
  );
  const observedPairs = observedPairsInSources(
    sourceText,
    tokenNames,
    sourcePaths,
    translucentBackgroundTokens,
  );
  const inherited = observeInheritedForegroundSurfaces(sourcePaths, tokenNames);
  for (const key of inherited.pairs) observedPairs.add(key);
  observedPairs.inheritedUses = inherited.uses;
  observedPairs.importedUses = inherited.importedUses;
  observedPairs.routeUses = inherited.routeUses;
  observedPairs.callerUses = inherited.callerUses;
  observedPairs.directOccurrenceUses = inherited.directOccurrenceUses;
  const sourceOccurrences = observedPairs.occurrences;
  observedPairs.occurrences = new Map(inherited.uses.occurrences);
  for (const [key, occurrences] of sourceOccurrences) {
    const combined = observedPairs.occurrences.get(key) ?? [];
    combined.push(...occurrences);
    observedPairs.occurrences.set(key, combined);
  }
  const failures = validatePairManifest(
    pairs,
    (file) => {
      try {
        return requireFromWeb("node:fs").readFileSync(
          path.join(repoRoot, file),
          "utf8",
        );
      } catch {
        return "";
      }
    },
    observedPairs,
  );
  for (const unsupported of observedPairs.unsupportedForegrounds) {
    failures.push(
      violation(
        unsupported.usage ?? manifestPath,
        `unsupported semantic foreground utility ${unsupported.className} must be measured with an exact token class and supported opacity.`,
      ),
    );
  }
  for (const entry of inherited.unresolved.values()) {
    failures.push(
      violation(
        manifestPath,
        `foreground-only color occurrence ${entry.id} has no supported opaque ancestor or explicit surface contract.`,
      ),
    );
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
    return;
  }

  // G3 deliberately measures the production CSS output, not source token expressions.
  execFileSync("pnpm", ["--filter", "@taskdesk/web...", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  const assetDirs = ["agent", "portal"].map((entry) =>
    path.join(repoRoot, "apps/web/dist", entry, "assets"),
  );
  const cssFiles = (
    await Promise.all(
      assetDirs.map(async (assetDir) =>
        (
          await readdir(assetDir)
        )
          .filter((name) => name.endsWith(".css"))
          .map((name) => path.join(assetDir, name)),
      ),
    )
  ).flat();
  if (cssFiles.length === 0)
    throw new Error(
      "Web build produced no CSS assets for the G3 computed-style check.",
    );
  const css = (
    await Promise.all(cssFiles.map((file) => readFile(file, "utf8")))
  ).join("\n");
  const { chromium } = requireFromWeb("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      "<!doctype html><html><head></head><body></body></html>",
    );
    await page.addStyleTag({ content: css });
    if (
      pairs.some((pair) =>
        Object.values(pair.backgroundClass ?? {}).some((value) =>
          value.includes("has-autofill:"),
        ),
      )
    ) {
      if (!css.includes(":has(:autofill)")) {
        failures.push(
          violation(
            manifestPath,
            "built CSS has no :has(:autofill) selector for the declared autofill pair.",
          ),
        );
      } else {
        // Headless Chromium does not expose real autofill state. Replace only the state
        // selector in the built CSS with an equivalent test attribute, retaining the
        // production class selectors, declarations, variables, and cascade.
        await page.addStyleTag({
          content: css.replaceAll(
            ":has(:autofill)",
            ":has([data-autofill-probe])",
          ),
        });
      }
    }
    for (const [index, pair] of pairs.entries()) {
      for (const theme of pair.themes) {
        await page.evaluate(
          (name) =>
            document.documentElement.classList.toggle("dark", name === "dark"),
          theme,
        );
        const surfaceClass = pair.backgroundClass?.[theme] ?? "";
        const probeSurface = probeSurfaceDescriptor(surfaceClass);
        const backdropClasses = pair.backdropLayers ?? [];
        await page.evaluate(
          ({
            bg,
            backdrop,
            backdropClasses,
            foregroundClass,
            backgroundClass,
            sourceSurfaceClass,
            descendantSurface,
            theme,
          }) => {
            const surfaceClass = backgroundClass?.[theme] ?? "";
            const parent = document.createElement("span");
            let surfaceParent;
            const backdropRoot = document.createElement("span");
            if (backdropClasses.length === 0)
              backdropRoot.dataset.contrastBackdrop = "true";
            document.body.append(backdropRoot);
            surfaceParent = backdropRoot;
            if (backdropClasses.length === 0)
              backdropRoot.style.backgroundColor = `var(${backdrop})`;
            for (const className of [...backdropClasses].reverse()) {
              const layer = document.createElement("span");
              layer.className = className;
              layer.dataset.contrastBackdrop = "true";
              surfaceParent.append(layer);
              surfaceParent = layer;
              for (const variant of className.split(":")) {
                const bracketAttribute = variant.match(
                  /^data-\[([a-z0-9-]+)(?:=([^\]]+))?\]$/,
                );
                const plainAttribute = variant.match(/^data-([a-z0-9-]+)$/);
                if (bracketAttribute)
                  layer.setAttribute(
                    `data-${bracketAttribute[1]}`,
                    bracketAttribute[2]?.replace(/^['"]|['"]$/g, "") ?? "",
                  );
                else if (plainAttribute)
                  layer.setAttribute(`data-${plainAttribute[1]}`, "");
              }
            }
            const node = document.createElement(
              surfaceClass.includes("[button&,a&]") ? "a" : "span",
            );
            if (descendantSurface && sourceSurfaceClass)
              parent.className = `${foregroundClass ?? ""} ${sourceSurfaceClass}`;
            if (foregroundClass && !descendantSurface)
              node.className = foregroundClass;
            if (backgroundClass && !descendantSurface)
              node.className = `${node.className} ${backgroundClass[theme]}`;
            node.id = "contrast-probe";
            let parentNeeded = false;
            for (const variant of surfaceClass.split(":")) {
              const bracketAttribute = variant.match(
                /^data-\[([a-z0-9-]+)(?:=([^\]]+))?\]$/,
              );
              const plainAttribute = variant.match(/^data-([a-z0-9-]+)$/);
              const ancestorAttribute = variant.match(/^in-data-([a-z0-9-]+)$/);
              const ancestorClass = variant.match(/^in-\[\.([a-z0-9-]+)\]$/);
              if (bracketAttribute) {
                node.setAttribute(
                  `data-${bracketAttribute[1]}`,
                  bracketAttribute[2]?.replace(/^['"]|['"]$/g, "") ?? "",
                );
              } else if (plainAttribute) {
                node.setAttribute(`data-${plainAttribute[1]}`, "");
              } else if (ancestorAttribute) {
                parent.setAttribute(`data-${ancestorAttribute[1]}`, "");
                parentNeeded = true;
              } else if (ancestorClass) {
                parent.classList.add(ancestorClass[1]);
                parentNeeded = true;
              }
            }
            if (parentNeeded || descendantSurface) {
              parent.dataset.contrastBackdrop = "true";
              parent.append(node);
              surfaceParent.append(parent);
            } else {
              surfaceParent.append(node);
            }
            if (backgroundClass?.[theme]?.includes("has-autofill:")) {
              const child = document.createElement("input");
              child.type = "text";
              child.dataset.autofillProbe = "true";
              child.setAttribute("autocomplete", "given-name");
              node.append(child);
            }
            node.append(document.createTextNode("Contrast"));
            node.style.display = "inline-block";
            node.style.padding = "1rem";
            if (!backgroundClass) node.style.backgroundColor = `var(${bg})`;
            return true;
          },
          {
            ...pair,
            backgroundClass: pair.backgroundClass
              ? { ...pair.backgroundClass, [theme]: probeSurface.className }
              : undefined,
            backdropClasses,
            sourceSurfaceClass: surfaceClass,
            descendantSurface: probeSurface.descendant,
            theme,
          },
        );
        if (
          surfaceClass.includes("hover:") ||
          backdropClasses.some((className) => className.includes("hover:"))
        ) {
          await page.locator("#contrast-probe").hover();
        }
        const values = await page
          .locator("#contrast-probe")
          .evaluate((node) => {
            const style = getComputedStyle(node);
            const backdrops = [];
            for (
              let current = node.parentElement;
              current?.dataset.contrastBackdrop;
              current = current.parentElement
            )
              backdrops.push(getComputedStyle(current).backgroundColor);
            return {
              fg: style.color,
              bg: style.backgroundColor,
              backdrops,
            };
          });
        const background = parseColor(values.bg);
        if (
          pair.backgroundClass?.[theme] &&
          background[3] === 0 &&
          surfaceClass !== "bg-transparent"
        ) {
          failures.push(
            violation(
              manifestPath,
              `entry ${index + 1} surface class ${surfaceClass} has no computed background in ${theme}.`,
            ),
          );
        }
        if (pair.backdropLayers?.length) {
          const terminalBackdropColor = values.backdrops.at(-1);
          if (!terminalBackdropColor) {
            failures.push(
              violation(
                manifestPath,
                `entry ${index + 1} source-bound backdrop chain produced no computed ancestor in ${theme}.`,
              ),
            );
            await page.evaluate(() =>
              document
                .querySelector('[data-contrast-backdrop="true"]')
                ?.remove(),
            );
            continue;
          }
          const terminalBackdrop = parseColor(terminalBackdropColor);
          if (terminalBackdrop.length < 4 || terminalBackdrop[3] < 0.999999) {
            failures.push(
              violation(
                manifestPath,
                `entry ${index + 1} terminal computed backdrop is not opaque in ${theme}.`,
              ),
            );
            await page.evaluate(() =>
              document
                .querySelector('[data-contrast-backdrop="true"]')
                ?.remove(),
            );
            continue;
          }
        }
        let opaqueBg = values.backdrops.length
          ? parseColor(values.backdrops.at(-1)).slice(0, 3)
          : parseColor(values.backdrops[0] ?? "rgb(255, 255, 255)").slice(0, 3);
        for (const color of values.backdrops.slice(0, -1).reverse()) {
          const layer = parseColor(color);
          if (layer[3] > 0) opaqueBg = composite(layer, opaqueBg);
        }
        if (background[3] < 1) opaqueBg = composite(background, opaqueBg);
        else opaqueBg = background.slice(0, 3);
        const foreground = parseColor(values.fg);
        const opaqueFg =
          foreground[3] < 1
            ? composite(foreground, opaqueBg)
            : foreground.slice(0, 3);
        const ratio = contrastRatio(opaqueFg, opaqueBg);
        if (ratio + 1e-6 < pair.minRatio) {
          failures.push(
            violation(
              manifestPath,
              `entry ${index + 1} ${pair.fg} on ${pair.bg} is ${ratio.toFixed(2)}:1 in ${theme} (computed ${values.fg} on ${values.bg}, backdrops ${values.backdrops.join(" over ")}); needs ${pair.minRatio}:1.`,
            ),
          );
        }
        await page.evaluate(() =>
          document.querySelector('[data-contrast-backdrop="true"]')?.remove(),
        );
      }
    }
    const density = await page.evaluate(() => {
      document.body.innerHTML =
        '<table><tr class="td-density-row"><td data-slot="table-cell">row</td></tr></table><span id="field" class="td-density-field" style="display:inline-flex"><input data-slot="input" style="height:32px"></span><div id="card" class="td-density-card">card</div><div data-slot="card"><div data-slot="card-header"></div><div id="card-no-header-border" data-slot="card-panel" class="td-density-card"></div></div><div data-slot="card"><div data-slot="card-header" class="border-b"></div><div id="card-header-border" data-slot="card-panel" class="td-density-card"></div><div data-slot="card-footer"></div></div><div data-slot="card"><div data-slot="card-panel" id="card-no-footer-border" class="td-density-card"></div><div data-slot="card-footer"></div></div><div data-slot="card"><div data-slot="card-panel" id="card-footer-border" class="td-density-card"></div><div data-slot="card-footer" class="border-t"></div></div>';
      const measure = () => ({
        row: getComputedStyle(document.querySelector("[data-slot=table-cell]"))
          .paddingBlockStart,
        field: getComputedStyle(document.querySelector("#field > input"))
          .paddingBlockStart,
        fieldControl: `${getComputedStyle(document.querySelector("#field")).paddingBlockStart}/${document.querySelector("#field").getBoundingClientRect().height}px`,
        card: getComputedStyle(document.querySelector("#card"))
          .paddingBlockStart,
        cardNoHeaderBorder: getComputedStyle(
          document.querySelector("#card-no-header-border"),
        ).paddingBlockStart,
        cardHeaderBorder: getComputedStyle(
          document.querySelector("#card-header-border"),
        ).paddingBlockStart,
        cardNoFooterBorder: getComputedStyle(
          document.querySelector("#card-no-footer-border"),
        ).paddingBlockEnd,
        cardFooterBorder: getComputedStyle(
          document.querySelector("#card-footer-border"),
        ).paddingBlockEnd,
      });
      document.documentElement.classList.remove("compact-mode");
      const comfortable = measure();
      document.documentElement.classList.add("compact-mode");
      const compact = measure();
      return { comfortable, compact };
    });
    for (const [name, expected] of Object.entries({
      row: ["12px", "8px"],
      field: ["8px", "6px"],
      fieldControl: ["0px/32px", "0px/32px"],
      card: ["16px", "12px"],
      cardNoHeaderBorder: ["0px", "0px"],
      cardHeaderBorder: ["16px", "12px"],
      cardNoFooterBorder: ["0px", "0px"],
      cardFooterBorder: ["16px", "12px"],
    })) {
      if (
        density.comfortable[name] !== expected[0] ||
        density.compact[name] !== expected[1]
      ) {
        failures.push(
          violation(
            "packages/ui/src/styles/density.css",
            `${name} density computed ${density.comfortable[name]} comfortable and ${density.compact[name]} compact; expected ${expected.join(" / ")}.`,
          ),
        );
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `check:contrast: ${pairs.length} declared, source-grounded pairs meet thresholds in light/dark built CSS.`,
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  await main();
