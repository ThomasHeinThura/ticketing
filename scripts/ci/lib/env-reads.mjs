/**
 * Finds and classifies every environment read in a source file.
 *
 * **#342, #352, #382 — from a hand-written tokenizer to a real parser.** The original
 * detector (a small hand-rolled lexer, see git history) had to re-derive comment/string/
 * regex/JSX-text boundaries itself, and every round of review against it found another real
 * spelling it missed: object-spread (`{ ...process.env }`), `globalThis.process.env`,
 * bracket/optional-chaining access, destructuring or aliasing `process` itself, `Reflect.get`,
 * `node:process` imports, and a comment between `process` and `.env` (#342 E1/E2, all closed
 * by #352); then a further round (#382's Opus review, "D3") found the same class recurring at
 * a narrower scope — casts (`(process as any).env`), string-literal escapes
 * (`process['\x65nv']`), nested `globalThis` destructuring, and — the fundamental one — JSX
 * text that merely *looks* like a comment or a regex confusing the lexer's own grammar
 * (H1, the same class as check-ui.mjs's own pre-#255 regex). That review's own recommendation,
 * matching this repo's established pattern for exactly this class of gate
 * (check-deps.mjs, check-ui.mjs's #255 rewrite): stop patching lexer special cases and parse
 * with a real grammar. `typescript/unstable/ast` via `typescript/unstable/sync`'s `API` is
 * the same real TypeScript parser the rest of the toolchain uses, so a JSX text node, a
 * comment, a string, and a regex are never ambiguous with real syntax — the class H1 named is
 * closed structurally, not by one more special case.
 *
 * The design below is not "detect `process.env.NAME`" — the kaneo import proved a check for
 * that exact shape misses the reads that matter: the seven S3 connection variables go through
 * a local `env(name)` helper backed by `process.env[name]`, four `CREEM_PRODUCT_*` names are
 * built from a lookup table, and the eight `SMTP_*` names arrive through the parameter default
 * `env: SmtpEnv = process.env`. None of those is a `process.env.NAME` expression. So instead:
 *
 *  1. `classify(node)` answers "what does this expression *denote*" — the `process` global
 *     itself, `globalThis`/`global`, `import.meta`, or the environment bag reachable from any
 *     of those (`process.env` / `import.meta.env`), seeing through parens, `as`/`satisfies`/
 *     `<Type>`/`!` casts, `await`, a `require`/dynamic `import` of `"process"`/`"node:process"`,
 *     `Reflect.get`/`Object.getOwnPropertyDescriptor`, and any alias created by a plain
 *     `const x = <one of the above>` (including chains: an alias of an alias).
 *  2. The tree walk uses that purely to decide, at every real property/element access,
 *     destructuring pattern, spread, assignment, and module export in the file, whether it is
 *     a **named** read (a literal variable name — attributable), a **computed** read (a
 *     dynamic key into the bag — cannot be attributed to a name), or an **alias** read (the
 *     whole bag, or the bare `process`/`import.meta` object itself, escapes as a value — a
 *     parameter default, an object spread, a non-flat destructure, or crossing a module
 *     boundary via `export`). Nothing here is a special case for one shape; every shape above
 *     is just what `classify` returns at a real AST node the grammar already distinguishes.
 *
 * `process[X]`/`globalThis[X]`/`import.meta[X]` with anything other than a literal string
 * that plainly is NOT the property being reached (or a numeric index) fails closed as a match
 * — see `memberMatch`. A concatenation, a variable, a substituted template: all assumed to be
 * reaching `.env`/`.process` rather than proven not to. Nothing is exempted from this — see
 * `check-env.mjs`'s test-vs-application scope note for the one carve-out this gate has at all.
 *
 * Accepted limits, by design (documented so the next reviewer finds the answer here, not by
 * re-discovering it): cross-file dataflow (a raw `process`/`process.env` passed as a bare
 * function argument, or returned from a function that is never itself exported, is not
 * traced into its callee); a `.then(cb => ...)` callback on `import('node:process')` (the
 * awaited/`await import(...)` form is handled, the promise-chaining form is not); legacy
 * `<Type>expr` angle-bracket assertions in a `.tsx`-parsed fixture (real files keep their own
 * extension and are unaffected — this is a unit-test-harness limitation only, see
 * `parseAdHocSourceFile`, not a real detection gap: `as`/`satisfies`/non-null casts exercise
 * the identical `unwrap` code path this shape would).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/** `import.meta.env` members Vite defines itself; they are not deployment configuration. */
export const viteBuiltIns = new Set([
  "MODE",
  "DEV",
  "PROD",
  "SSR",
  "BASE_URL",
  "LEGACY",
]);

// ── structural helpers ──────────────────────────────────────────────────────────────

/** See through parens, TS casts, non-null assertions, and `await` — none of them change
 * what an expression denotes, only how it is annotated or when it resolves. */
function unwrap(startNode) {
  let node = startNode;
  for (;;) {
    if (!node) return node;
    switch (node.kind) {
      case ts.SyntaxKind.ParenthesizedExpression:
      case ts.SyntaxKind.AsExpression:
      case ts.SyntaxKind.SatisfiesExpression:
      case ts.SyntaxKind.TypeAssertionExpression:
      case ts.SyntaxKind.NonNullExpression:
      case ts.SyntaxKind.AwaitExpression:
        node = node.expression;
        continue;
      default:
        return node;
    }
  }
}

/** The decoded string value of a literal — reading the parser's own `.text`, exactly like
 * check-ui.mjs's `literalSpecifierText`, is what makes an escaped or Unicode-obfuscated
 * literal (`'\x65nv'`, `process`) transparent: the parser already decoded it. */
function literalText(node) {
  if (!node) return undefined;
  return node.kind === ts.SyntaxKind.StringLiteral ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ? node.text
    : undefined;
}

function isProcessModuleSpecifier(text) {
  return text === "process" || text === "node:process";
}

function isBareIdentifierNamed(node, name) {
  return node?.kind === ts.SyntaxKind.Identifier && node.text === name;
}

function isPropertyAccessNamed(node, objectName, propertyName) {
  return (
    node?.kind === ts.SyntaxKind.PropertyAccessExpression &&
    node.expression?.kind === ts.SyntaxKind.Identifier &&
    node.expression.text === objectName &&
    node.name?.text === propertyName
  );
}

/**
 * What a member access transitions an already-classified object *into*: `process.env`,
 * `globalThis.process` (also `global.`), `import.meta.env`. Fails closed on a computed key
 * that cannot be proven to be something else: only a literal string/no-substitution-template
 * that is a DIFFERENT, plain name (or a numeric index) is treated as "definitely not this" —
 * a variable, a concatenation, a substituted template all count as a match. This is the same
 * design as the tokenizer it replaces (see its own header, "process[computed]"), now applied
 * uniformly to `globalThis[...]` and `import.meta[...]` too (closing the #382 "L2" gap that
 * only `process["env"]` got this treatment).
 */
const TRANSITIONS = {
  process: { member: "env", result: "env" },
  globalThis: { member: "process", result: "process" },
  importMeta: { member: "env", result: "importMetaEnv" },
};

function memberMatch(node, objectKind) {
  const transition = TRANSITIONS[objectKind];
  if (!transition) return null;
  if (node.kind === ts.SyntaxKind.PropertyAccessExpression) {
    return node.name.text === transition.member ? transition.result : null;
  }
  const keyNode = node.argumentExpression;
  const literal = literalText(keyNode);
  const isNumeric = keyNode?.kind === ts.SyntaxKind.NumericLiteral;
  if (literal === transition.member) return transition.result;
  if (literal !== undefined || isNumeric) return null; // a different, plain literal/index
  return transition.result; // unresolved computed key — assume the worst, fail closed
}

const SHADOWABLE_NAMES = new Set(["process", "globalThis", "global", "window"]);

const FUNCTION_LIKE_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

/**
 * Is `name` shadowed at `node`'s lexical position — a real, per-scope answer, not a file-wide
 * one? Walks `node`'s parent chain (the real parser sets `.parent`, so this needs no separate
 * bookkeeping pass) looking for an enclosing function whose own parameter list binds `name`, or
 * an enclosing `catch` clause whose binding is `name`. Either makes `name` refer to that local
 * binding for everything lexically inside it — the real JS scoping rule this file otherwise
 * does not model (see the `Identifier` case's own comment) — without treating a same-named
 * binding ANYWHERE else in the file as relevant, which is what the previous, file-wide `Set`
 * did (#403's ordinary review, Finding 1: a shadow parameter in one function was silently
 * suppressing an unrelated, real `process.env.X` read elsewhere in the same file).
 */
function isShadowedAt(node, name) {
  for (let current = node?.parent; current; current = current.parent) {
    if (
      FUNCTION_LIKE_KINDS.has(current.kind) &&
      (current.parameters ?? []).some(
        (parameter) =>
          parameter.name?.kind === ts.SyntaxKind.Identifier &&
          parameter.name.text === name,
      )
    )
      return true;
    if (
      current.kind === ts.SyntaxKind.CatchClause &&
      current.variableDeclaration?.name?.kind === ts.SyntaxKind.Identifier &&
      current.variableDeclaration.name.text === name
    )
      return true;
  }
  return false;
}

/**
 * What does `node` *denote*, given the aliases collected so far in this file? One of
 * `"process"`, `"globalThis"`, `"importMeta"` (not yet narrowed to the environment bag), or
 * `"env"` / `"importMetaEnv"` (the bag itself), or `null` (nothing of interest). Two
 * intermediate results (`"propDescEnv"` / `"propDescImportMetaEnv"`) exist only to let
 * `Object.getOwnPropertyDescriptor(process, "env").value` resolve across its own `.value`
 * access; nothing else produces or consumes them.
 */
function classify(startNode, aliases) {
  const node = unwrap(startNode);
  if (!node) return null;
  switch (node.kind) {
    case ts.SyntaxKind.Identifier: {
      const name = node.text;
      // #382's Opus review, "L1" — a catch-clause binding or parameter can legitimately be
      // named `process`/`globalThis`/`global`/`window`, shadowing the real global for the
      // rest of that scope. `isShadowedAt` answers this per the identifier's own lexical
      // position (walking its real parent chain), not file-wide — see its own comment for
      // why file-wide was wrong (#403's Finding 1).
      if (SHADOWABLE_NAMES.has(name) && isShadowedAt(node, name)) return null;
      if (name === "process" || aliases.process.has(name)) return "process";
      if (
        name === "globalThis" ||
        name === "global" ||
        name === "window" ||
        aliases.globalThis.has(name)
      )
        return "globalThis";
      if (aliases.env.has(name)) return "env";
      if (aliases.importMeta.has(name)) return "importMeta";
      if (aliases.importMetaEnv.has(name)) return "importMetaEnv";
      return null;
    }
    case ts.SyntaxKind.MetaProperty:
      return node.keywordToken === ts.SyntaxKind.ImportKeyword &&
        node.name?.text === "meta"
        ? "importMeta"
        : null;
    case ts.SyntaxKind.PropertyAccessExpression:
    case ts.SyntaxKind.ElementAccessExpression: {
      const objectKind = classify(node.expression, aliases);
      if (!objectKind) return null;
      const next = memberMatch(node, objectKind);
      if (next) return next;
      if (
        node.kind === ts.SyntaxKind.PropertyAccessExpression &&
        node.name.text === "value"
      ) {
        if (objectKind === "propDescEnv") return "env";
        if (objectKind === "propDescImportMetaEnv") return "importMetaEnv";
      }
      return null;
    }
    case ts.SyntaxKind.CallExpression: {
      const callee = unwrap(node.expression);
      const firstArg = literalText(node.arguments[0]);
      if (
        isBareIdentifierNamed(callee, "require") &&
        isProcessModuleSpecifier(firstArg)
      )
        return "process";
      if (
        callee?.kind === ts.SyntaxKind.ImportKeyword &&
        isProcessModuleSpecifier(firstArg)
      )
        return "process";
      if (isPropertyAccessNamed(callee, "Reflect", "get")) {
        const target = classify(node.arguments[0], aliases);
        const key = literalText(node.arguments[1]);
        if (target === "process" && key === "env") return "env";
        if (target === "importMeta" && key === "env") return "importMetaEnv";
        return null;
      }
      if (isPropertyAccessNamed(callee, "Object", "getOwnPropertyDescriptor")) {
        const target = classify(node.arguments[0], aliases);
        const key = literalText(node.arguments[1]);
        if (target === "process" && key === "env") return "propDescEnv";
        if (target === "importMeta" && key === "env")
          return "propDescImportMetaEnv";
        return null;
      }
      return null;
    }
    default:
      return null;
  }
}

/** The value an exported arrow/function *actually* exposes, unwrapping a concise arrow body
 * or a shallow `return` in the first block of statements (a return nested in an `if`/loop is
 * an accepted limit — the exported-boundary check this feeds is a narrow, deliberate net for
 * #382's M1 examples, not a general control-flow analysis). Returns `expr` itself, unchanged,
 * when it is not a function at all. */
function unwrapFunctionReturn(expr) {
  const node = unwrap(expr);
  if (!node) return expr;
  if (node.kind === ts.SyntaxKind.ArrowFunction) {
    if (node.body?.kind !== ts.SyntaxKind.Block) return unwrap(node.body);
    return shallowReturn(node.body) ?? expr;
  }
  if (node.kind === ts.SyntaxKind.FunctionExpression) {
    return shallowReturn(node.body) ?? expr;
  }
  return expr;
}

function shallowReturn(block) {
  if (!block) return null;
  for (const statement of block.statements) {
    if (
      statement.kind === ts.SyntaxKind.ReturnStatement &&
      statement.expression
    ) {
      return unwrap(statement.expression);
    }
  }
  return null;
}

function hasExportModifier(node) {
  return (node?.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

/** Only flat, statically-named binding elements: no rest, no default, no nested pattern, and
 * a plain identifier property key (a quoted-string key is deliberately NOT flat here, matching
 * this gate's existing, more conservative behavior for that one shape). Returns `null` — not a
 * partial list — the moment any element breaks flatness, so a hostile mix of one real name and
 * one rest/computed/nested element does not leak the real name out as "attributed". */
function flatBindingNames(pattern) {
  const names = [];
  for (const element of pattern.elements) {
    if (element.dotDotDotToken) return null;
    if (element.initializer) return null;
    if (
      element.propertyName &&
      element.propertyName.kind !== ts.SyntaxKind.Identifier
    )
      return null;
    if (element.name.kind !== ts.SyntaxKind.Identifier) return null;
    names.push({
      name: (element.propertyName ?? element.name).text,
      node: element,
    });
  }
  return names;
}

/**
 * @typedef {object} EnvRead
 * @property {"process.env" | "import.meta.env"} object which environment object was used
 * @property {"named" | "computed" | "alias"} kind how the read was written
 * @property {string | null} name the resolved variable name, when there is one
 * @property {number} line 1-based line number
 * @property {string} snippet the source line, trimmed
 */

const OBJECT_OF = { env: "process.env", importMetaEnv: "import.meta.env" };

/**
 * Walk a real, parsed TypeScript source file and classify every environment read in it.
 *
 * @param {import("typescript/unstable/ast").SourceFile} sourceFile
 * @returns {EnvRead[]}
 */
export function findEnvReadsInSourceFile(sourceFile) {
  const aliases = {
    process: new Set(),
    globalThis: new Set(),
    env: new Set(),
    importMeta: new Set(),
    importMetaEnv: new Set(),
  };
  const text = sourceFile.text;
  const lines = text.split("\n");
  let reads = [];

  const positionOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

  const addRead = (node, object, kind, name = null) => {
    const { line } = positionOf(node);
    reads.push({
      object,
      kind,
      name,
      line: line + 1,
      snippet: (lines[line] ?? "").trim(),
    });
  };
  const chargeEscape = (node, kindOfBag) =>
    addRead(node, OBJECT_OF[kindOfBag] ?? kindOfBag, "alias", null);

  function chargeBareValueIfEscaping(expr) {
    const kind = classify(expr, aliases);
    if (kind === "process") chargeEscape(expr, "process.env");
    else if (kind === "importMeta") chargeEscape(expr, "import.meta.env");
    else if (kind === "env") chargeEscape(expr, "process.env");
    else if (kind === "importMetaEnv") chargeEscape(expr, "import.meta.env");
  }

  function analyzeObjectPattern(pattern, sourceKind) {
    if (!pattern || pattern.kind !== ts.SyntaxKind.ObjectBindingPattern) return;

    if (sourceKind === "env" || sourceKind === "importMetaEnv") {
      const object = OBJECT_OF[sourceKind];
      const flat = flatBindingNames(pattern);
      if (flat === null) {
        chargeEscape(pattern, sourceKind);
      } else {
        for (const { name, node } of flat) addRead(node, object, "named", name);
      }
      return;
    }

    if (sourceKind === "process" || sourceKind === "importMeta") {
      const bagKind = sourceKind === "process" ? "env" : "importMetaEnv";
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) continue;
        const keyNode = element.propertyName ?? element.name;
        if (keyNode.kind !== ts.SyntaxKind.Identifier || keyNode.text !== "env")
          continue;
        chargeEscape(element, bagKind);
        if (element.name.kind === ts.SyntaxKind.Identifier) {
          (bagKind === "env" ? aliases.env : aliases.importMetaEnv).add(
            element.name.text,
          );
        }
      }
      return;
    }

    if (sourceKind === "globalThis") {
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) continue;
        const keyNode = element.propertyName ?? element.name;
        if (
          keyNode.kind !== ts.SyntaxKind.Identifier ||
          keyNode.text !== "process"
        )
          continue;
        if (element.name.kind === ts.SyntaxKind.Identifier) {
          aliases.process.add(element.name.text);
        } else if (element.name.kind === ts.SyntaxKind.ObjectBindingPattern) {
          analyzeObjectPattern(element.name, "process");
        }
      }
    }
  }

  function handleBindingDeclaration(nameNode, initializer, exported) {
    if (!initializer) return;

    if (nameNode.kind === ts.SyntaxKind.ObjectBindingPattern) {
      analyzeObjectPattern(nameNode, classify(initializer, aliases));
      return;
    }
    if (nameNode.kind !== ts.SyntaxKind.Identifier) return; // array pattern — accepted limit

    const plainKind = classify(initializer, aliases);
    if (plainKind === "process") aliases.process.add(nameNode.text);
    else if (plainKind === "globalThis") aliases.globalThis.add(nameNode.text);
    else if (plainKind === "importMeta") aliases.importMeta.add(nameNode.text);
    else if (plainKind === "env") {
      // Deliberately NOT tracked into `aliases.env` for forward resolution (unlike the
      // destructuring-from-`process` case in `analyzeObjectPattern`, which the tokenizer
      // this replaces already resolved forward, and still does here). A plain alias of the
      // WHOLE bag — `const smtpEnv = process.env` or a parameter default `env: T =
      // process.env` — is exactly the shape `packages/email/src/smtp-config.ts` is
      // baselined debt for (env-baseline.json), on the strength of ONE escape charge per
      // site; resolving `env.SMTP_HOST` etc. forward through it would be more precise, but
      // would also surface eight more specific names as NEWLY unattributable on code this
      // change does not otherwise touch — which the merge-base ratchet (GPT-F3, this same
      // file) correctly refuses to let a baseline edit launder. Closing that would be a real
      // improvement, but it is a configuration-reference/baseline change for a separate,
      // deliberate PR, not a side effect of this detector rewrite.
      chargeEscape(initializer, "env");
    } else if (plainKind === "importMetaEnv") {
      chargeEscape(initializer, "importMetaEnv");
    }

    if (!exported) return;
    const unwrapped = unwrapFunctionReturn(initializer);
    if (unwrapped !== initializer) {
      // A function body's return value crossing the module boundary (#382 M1's
      // `export const get = () => process`) — `get` itself is a function, not an alias,
      // so it is never added to `aliases`, only checked for this one escape charge.
      chargeBareValueIfEscaping(unwrapped);
    } else if (plainKind === "process" || plainKind === "importMeta") {
      // env/importMetaEnv classifications were already charged above, unconditionally;
      // only the bare-process/import.meta case is new here (#382 M1's `export const p =
      // process` / `export default process`, handled at the ExportAssignment case).
      chargeBareValueIfEscaping(initializer);
    }
  }

  function visit(node) {
    switch (node.kind) {
      case ts.SyntaxKind.PropertyAccessExpression:
      case ts.SyntaxKind.ElementAccessExpression: {
        const objectKind = classify(node.expression, aliases);
        if (objectKind === "env" || objectKind === "importMetaEnv") {
          const object = OBJECT_OF[objectKind];
          if (node.kind === ts.SyntaxKind.PropertyAccessExpression) {
            addRead(node, object, "named", node.name.text);
          } else {
            const literal = literalText(node.argumentExpression);
            const isNumeric =
              node.argumentExpression?.kind === ts.SyntaxKind.NumericLiteral;
            if (literal !== undefined) addRead(node, object, "named", literal);
            else if (!isNumeric) addRead(node, object, "computed", null);
          }
        }
        break;
      }
      case ts.SyntaxKind.SpreadAssignment:
      case ts.SyntaxKind.SpreadElement: {
        const kind = classify(node.expression, aliases);
        if (kind === "env" || kind === "importMetaEnv")
          chargeEscape(node, kind);
        break;
      }
      // Ordinary review of #423 (this PR), Finding 2 — the bag or a bare global escaping
      // through an object-literal property value, an array-literal element, a ternary branch,
      // or an `||`/`??` fallback is exactly as much an escape as the spread case above (a value
      // that used to be reachable only through a real member access is now reachable through
      // whatever consumes this container/expression); charged the same way, via
      // `chargeBareValueIfEscaping`, which already no-ops on anything that isn't a bare
      // process/import.meta/env/import.meta.env value.
      case ts.SyntaxKind.PropertyAssignment:
        chargeBareValueIfEscaping(node.initializer);
        break;
      case ts.SyntaxKind.ShorthandPropertyAssignment:
        chargeBareValueIfEscaping(node.name);
        break;
      case ts.SyntaxKind.ArrayLiteralExpression:
        for (const element of node.elements) {
          if (element.kind !== ts.SyntaxKind.SpreadElement)
            chargeBareValueIfEscaping(element);
        }
        break;
      case ts.SyntaxKind.ConditionalExpression:
        chargeBareValueIfEscaping(node.whenTrue);
        chargeBareValueIfEscaping(node.whenFalse);
        break;
      case ts.SyntaxKind.CallExpression: {
        // A call classify() itself resolves (require/dynamic import/Reflect.get/
        // Object.getOwnPropertyDescriptor of process or import.meta) already has its
        // meaning accounted for wherever ITS result is consumed; charging its own
        // arguments too would double-count the same `process` it was built from (#382's
        // own "does not double-flag Reflect.get because process is its first argument").
        // Every other call is an ordinary escape: passing the bare bag, or `process`/
        // `import.meta` itself, to some other function is exactly #382's M1 class
        // ("process passed as a bare/later call argument") — this file cannot know what
        // the callee does with it, so it is charged here, at the call site.
        if (classify(node, aliases) === null) {
          for (const argument of node.arguments) {
            chargeBareValueIfEscaping(argument);
          }
        }
        // `import("node:process").then((m) => m.env.X)` — the awaited form is handled by
        // `classify`'s CallExpression case already; this narrow addition resolves the
        // promise-chained callback's own parameter to the same "process" alias, so its
        // body's `.env` access is attributed exactly like any other alias.
        if (
          node.expression?.kind === ts.SyntaxKind.PropertyAccessExpression &&
          node.expression.name.text === "then"
        ) {
          const target = classify(node.expression.expression, aliases);
          if (target === "process" || target === "importMeta") {
            const callback = node.arguments[0];
            const param = callback?.parameters?.[0];
            if (param?.name?.kind === ts.SyntaxKind.Identifier) {
              (target === "process" ? aliases.process : aliases.importMeta).add(
                param.name.text,
              );
            }
          }
        }
        break;
      }
      case ts.SyntaxKind.WithStatement: {
        // `with (process) { ... }` brings every property of `process` into scope as bare
        // identifiers inside its body — this file cannot know which ones a body goes on
        // to use, so the whole construct is charged as one escape at the `with` itself,
        // fail closed, rather than trying to resolve bare identifiers inside the body.
        chargeBareValueIfEscaping(node.expression);
        break;
      }
      case ts.SyntaxKind.VariableDeclaration: {
        const exported = hasExportModifier(node.parent?.parent);
        handleBindingDeclaration(node.name, node.initializer, exported);
        break;
      }
      case ts.SyntaxKind.Parameter:
        handleBindingDeclaration(node.name, node.initializer, false);
        break;
      case ts.SyntaxKind.BinaryExpression:
        if (
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          node.left.kind === ts.SyntaxKind.Identifier
        ) {
          handleBindingDeclaration(node.left, node.right, false);
        } else if (
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        ) {
          chargeBareValueIfEscaping(node.left);
          chargeBareValueIfEscaping(node.right);
        }
        break;
      case ts.SyntaxKind.ExportAssignment:
        chargeBareValueIfEscaping(unwrapFunctionReturn(node.expression));
        break;
      case ts.SyntaxKind.FunctionDeclaration:
        if (hasExportModifier(node)) {
          const returned = shallowReturn(node.body);
          if (returned) chargeBareValueIfEscaping(returned);
        }
        break;
      case ts.SyntaxKind.ExportDeclaration: {
        const specifier = literalText(node.moduleSpecifier);
        if (
          specifier &&
          isProcessModuleSpecifier(specifier) &&
          node.exportClause?.kind === ts.SyntaxKind.NamedExports
        ) {
          for (const element of node.exportClause.elements) {
            const importedName = (element.propertyName ?? element.name).text;
            if (importedName === "env") chargeEscape(element, "env");
          }
        }
        break;
      }
      case ts.SyntaxKind.ImportDeclaration: {
        const specifier = literalText(node.moduleSpecifier);
        if (
          specifier &&
          isProcessModuleSpecifier(specifier) &&
          node.importClause
        ) {
          const clause = node.importClause;
          if (clause.name) aliases.process.add(clause.name.text);
          if (clause.namedBindings?.kind === ts.SyntaxKind.NamespaceImport) {
            aliases.process.add(clause.namedBindings.name.text);
          } else if (
            clause.namedBindings?.kind === ts.SyntaxKind.NamedImports
          ) {
            for (const element of clause.namedBindings.elements) {
              const importedName = (element.propertyName ?? element.name).text;
              if (importedName === "env") aliases.env.add(element.name.text);
            }
          }
        }
        break;
      }
      default:
        break;
    }
    node.forEachChild(visit);
  }

  // Aliasing can run in either source order (`const p = process; const q = p;`) or reverse
  // (`const q = p; const p = process;`) — a fixed point over the whole file resolves either,
  // the same guarantee the tokenizer's separate collect-then-scan passes gave, generalized to
  // arbitrarily long chains. Bounded to 10 rounds: real alias chains in reviewed code are a
  // handful of hops at most, and each round can only ever grow four finite sets.
  for (let round = 0; round < 10; round += 1) {
    const before =
      aliases.process.size +
      aliases.globalThis.size +
      aliases.env.size +
      aliases.importMeta.size +
      aliases.importMetaEnv.size;
    reads = [];
    visit(sourceFile);
    const after =
      aliases.process.size +
      aliases.globalThis.size +
      aliases.env.size +
      aliases.importMeta.size +
      aliases.importMetaEnv.size;
    if (after === before) break;
  }
  return reads;
}

/**
 * Parse a raw source string into a real TypeScript AST, for unit tests only — `check-env.mjs`
 * never calls this; it batches every real repository file through one `API` instance instead
 * (see its own header), the same split check-ui.mjs's `parseAdHoc`/`main` already established
 * for this exact class of gate. Parsed as `.ts` by default, or `.tsx` when a fixture needs
 * real JSX (the H1 class) — the one thing the two extensions disagree on is the legacy
 * `<Type>expr` angle-bracket cast, a real syntax conflict with JSX (a `.tsx` file cannot have
 * both); a real `.ts` file in the repository keeps its own extension and is scanned correctly
 * by `check-env.mjs` either way, so this is a unit-test-harness choice, never a detection gap.
 *
 * @param {string} source
 * @param {boolean} jsx
 * @returns {import("typescript/unstable/ast").SourceFile}
 */
function parseAdHocSourceFile(source, jsx) {
  const dir = mkdtempSync(path.join(tmpdir(), "env-reads-scratch-"));
  try {
    const file = path.join(dir, jsx ? "fixture.tsx" : "fixture.ts");
    writeFileSync(file, source);
    const api = new API({ cwd: dir });
    try {
      const snapshot = api.updateSnapshot({ openFiles: [file] });
      try {
        const project = snapshot.getDefaultProjectForFile(file);
        const sourceFile = project?.program.getSourceFile(file);
        if (!sourceFile) {
          throw new Error(`could not parse fixture source (${file})`);
        }
        return sourceFile;
      } finally {
        snapshot.dispose();
      }
    } finally {
      api.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} source file contents
 * @param {{ jsx?: boolean }} [options] pass `{ jsx: true }` for a fixture that needs real JSX
 *   syntax (parsed as `.tsx`); see `parseAdHocSourceFile`'s own comment for why this is a
 *   test-harness choice, not a real scanning difference.
 * @returns {EnvRead[]}
 */
export function findEnvReads(source, { jsx = false } = {}) {
  return findEnvReadsInSourceFile(parseAdHocSourceFile(source, jsx));
}

/**
 * A stable identity for one unattributable read.
 *
 * **GPT-F3.** `env-baseline.json` recorded unattributable reads as a COUNT per file —
 * `{ reason, reads: 1 }` — and that count was compared against the merge base by
 * `addedWithinKeys`, which compares arrays. The value was an object, so the comparison
 * silently saw two empty lists and returned `[]` for every possible change:
 *
 *   base:  "apps/api/src/storage/s3.ts": { reason: "…", reads: 1 }
 *   diff:  a second computed `process.env[…]` read, plus reads: 1 -> 2
 *   result: check:env GREEN
 *
 * Same-diff bypass, one level below the one F3 closed. A count is also blind to a
 * replacement: delete one baselined read, add a different one, and the number is
 * unchanged while the debt is not.
 *
 * So the baseline records identities instead. The identity is the read's kind plus the
 * source line it sits on, whitespace-collapsed, with a 1-based index to separate
 * genuinely identical lines. Deliberately NOT the line number: inserting an unrelated
 * function above a baselined read would otherwise register as new debt, and a ratchet
 * that fires on unrelated edits is a ratchet people delete.
 *
 * @param {EnvRead} read
 * @param {number} index 1-based, among reads sharing this fingerprint body
 * @returns {string}
 */
export function readFingerprint(read, index) {
  const snippet = read.snippet.replace(/\s+/g, " ").trim();
  return `${read.kind} #${index}: ${snippet}`;
}

/**
 * Fingerprints for a file's unattributable reads, in source order, de-duplicated by
 * appending an occurrence index.
 *
 * @param {EnvRead[]} reads
 * @returns {string[]}
 */
export function readFingerprints(reads) {
  const seen = new Map();
  return reads.map((read) => {
    const body = `${read.kind}: ${read.snippet.replace(/\s+/g, " ").trim()}`;
    const index = (seen.get(body) ?? 0) + 1;
    seen.set(body, index);
    return readFingerprint(read, index);
  });
}
