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
 *  2. The tree walk charges every node `classify` resolves to one of those values as an
 *     **alias** read, BY DEFAULT — unless its immediate context (parent, seeing through the
 *     same transparent wrappers `classify` does) is one of the specifically recognized safe
 *     narrowings: a member/element access that narrows it further (a **named** read — a
 *     literal variable name off the bag, attributable — or a **computed** read — a dynamic
 *     key into the bag, not attributable to a name); an argument a resolved wrapper call
 *     (`Reflect.get`, `Object.getOwnPropertyDescriptor`, `require`/dynamic `import`) already
 *     consumes; a tracked-alias/destructuring declaration site (`handleBindingDeclaration`
 *     decides whether and how to charge it there instead); or a bare condition test
 *     (`if (process)`, a `typeof` operand) that reads nothing out of the value. See
 *     `isSafeConsumingContext`. This is a structural default-flip (Opus review of #423 pass
 *     1), not an allow-list of shapes to charge — every place one of these five values
 *     appears as a value and nothing more specific claimed it is charged, because the default
 *     is to charge, not because that particular shape was separately enumerated.
 *
 * `process[X]`/`globalThis[X]`/`import.meta[X]` with anything other than a literal string
 * that plainly is NOT the property being reached (or a numeric index) fails closed as a match
 * — see `memberMatch`. A concatenation, a variable, a substituted template: all assumed to be
 * reaching `.env`/`.process` rather than proven not to. Nothing is exempted from this — see
 * `check-env.mjs`'s test-vs-application scope note for the one carve-out this gate has at all.
 *
 * Accepted limits, by design (documented so the next reviewer finds the answer here, not by
 * re-discovering it — Opus review of #423 pass 2, F5: a bare function argument and a
 * non-exported function's return are now CAUGHT by the default-flip above, not limits; a
 * `.then(cb)` callback is caught too, but by the dedicated `.then` case in `visit()`, not by
 * the default-flip): rest-destructuring from `process`/`globalThis`
 * (`const { ...rest } = process` — the rest element itself is not traced further);
 * `.default.env` reached through a dynamic/namespace import
 * (`(await import("./cfg")).default.env`); a bare condition test — `if (process.env)`,
 * `while (import.meta.env)`, a ternary's own condition position, a `typeof` operand — is
 * deliberately not charged, since nothing escapes from a check that never hands the value to
 * anyone (see `isSafeConsumingContext`); a bare `globalThis`/`window` value (not narrowed by
 * `.process`/`[...]`) is never charged by design — only the narrowed access matters; legacy
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

/** Is `node` anywhere in `root`'s own subtree (including `root` itself)? Walks `node`'s real
 * parent chain — the only primitive `isShadowRegion`/`isShadowedAt` below need. */
function isWithin(node, root) {
  if (!root) return false;
  for (let current = node; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

/** Is `node` lexically within `fn`'s own shadowing region — its body, or one of its
 * parameters' own name/default-value bindings? A computed class-member/method key
 * (`current.name`), a decorator on the function/method itself, or a decorator on ONE of its
 * OWN parameters, all evaluate in the OUTER scope, before that parameter's binding takes
 * effect — none of those make `current` "inside" `fn` for shadowing purposes (Opus review of
 * #423 pass 1: `class C { [process.env.SECRET_KEY](process) {} }` must still see the real
 * `process`, even though the method's own parameter happens to be named `process`). */
function isShadowRegion(node, fn) {
  if (isWithin(node, fn.body)) return true;
  for (const parameter of fn.parameters ?? []) {
    if (
      isWithin(node, parameter.name) ||
      (parameter.initializer && isWithin(node, parameter.initializer))
    )
      return true;
  }
  return false;
}

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
      ) &&
      isShadowRegion(node, current)
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

/**
 * Structural default-flip (Opus review of #423 pass 1, "the coverage-regression class"):
 * walk up through the same transparent wrappers `unwrap` sees through (a real parent may be
 * several parens/casts/`await`s above the node classify() actually resolved), and return the
 * outermost transparent wrapper together with ITS real parent — the syntactic position that
 * actually decides whether this value is consumed safely.
 */
function effectiveParent(node) {
  let current = node;
  for (;;) {
    const parent = current.parent;
    if (
      parent &&
      (parent.kind === ts.SyntaxKind.ParenthesizedExpression ||
        parent.kind === ts.SyntaxKind.AsExpression ||
        parent.kind === ts.SyntaxKind.SatisfiesExpression ||
        parent.kind === ts.SyntaxKind.TypeAssertionExpression ||
        parent.kind === ts.SyntaxKind.NonNullExpression ||
        parent.kind === ts.SyntaxKind.AwaitExpression) &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    return { node: current, parent };
  }
}

/** Is `effNode` exactly the initializer of a declaration whose OWN alias-tracking dispatch
 * (`handleBindingDeclaration`, reached from `visit`'s `VariableDeclaration`/`Parameter`/
 * `BinaryExpression` cases) already decides whether — and how — to charge it? Those three
 * sites are the only places a plain identifier/object/array binding target gets tracked
 * forward as an alias instead of charged as a bare escape right here; charging the generic
 * default there too would double-count every later use of the alias. For the
 * `BinaryExpression` (plain assignment) case specifically, this only holds when the
 * assignment is itself a bare standalone statement (Opus review of #423 pass 3, F3
 * follow-up) — if the assignment's own value is consumed anywhere (an argument, chained
 * into another assignment, a declaration initializer, a return/export value, ...), that is a
 * real escape and is not exempted here. */
function isTrackedAliasDeclarationSite(effNode, parent) {
  if (!parent) return false;
  // `ArrayBindingPattern` is deliberately NOT here (Opus review of #423 pass 2, F2):
  // `handleBindingDeclaration` just returns for an array pattern without charging anything
  // (array-pattern destructuring isn't traced — an accepted, documented limit), so treating
  // it as "already handled" here silently dropped the charge instead of falling through to
  // the default. Neither `const [a] = process.env` nor a destructured array-pattern
  // parameter default is actually iterable at runtime, but this gate still charges the
  // escape, matching the old tokenizer.
  const bindableName = (kind) =>
    kind === ts.SyntaxKind.Identifier ||
    kind === ts.SyntaxKind.ObjectBindingPattern;
  if (
    (parent.kind === ts.SyntaxKind.VariableDeclaration ||
      parent.kind === ts.SyntaxKind.Parameter) &&
    parent.initializer === effNode
  )
    return bindableName(parent.name?.kind);
  if (
    parent.kind === ts.SyntaxKind.BinaryExpression &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === effNode &&
    parent.left.kind === ts.SyntaxKind.Identifier &&
    // Opus review of #423 pass 3 (F3 follow-up): this exemption only holds when the
    // assignment itself is thrown away as a bare standalone statement (`x = process;` on
    // its own) — nothing consumes the assignment's own VALUE. If the assignment's result is
    // itself used (an argument, chained into another assignment, a declaration initializer,
    // a return/export value, ...), that use is a real escape and must fall through to the
    // generic default charge below, not be silently exempted here.
    effectiveParent(parent).parent?.kind === ts.SyntaxKind.ExpressionStatement
  )
    return true;
  return false;
}

/**
 * Opus review of #423 pass 1 — the structural fix: `classify()` resolving a node to
 * `process`/`globalThis`/`importMeta`/`env`/`importMetaEnv` is, by default, a read of
 * interest (charge it as an escape), unless the immediate (transparent-wrapper-adjusted)
 * context is one of the specifically recognized SAFE narrowings:
 *
 *  - a member/element access that narrows it further, OR a genuine named/computed property
 *    read off the bag itself (both already handled elsewhere — `visit`'s own
 *    `PropertyAccessExpression`/`ElementAccessExpression` case for the latter);
 *  - an argument already consumed by a wrapper call `classify()` itself resolves
 *    (`Reflect.get`, `Object.getOwnPropertyDescriptor`, `require`/dynamic `import`) —
 *    charging the argument too would double-count the same value the call was built from;
 *  - a tracked-alias/destructuring declaration site — `handleBindingDeclaration` already
 *    decides whether and how to charge it (unconditionally for the `env`/`importMetaEnv` bag
 *    itself, only on module-boundary crossing for a bare `process`/`import.meta` alias).
 *
 * Every other place one of these five values appears as a value — a plain identifier
 * reference, a constructor/call argument, a return value at any depth, an operator operand,
 * an assignment target that is not a plain identifier, a class field initializer, a
 * destructuring pattern with a quoted/computed key, a JSX spread/prop, and so on — is charged
 * here, structurally, because nothing more specific claimed it; not because that particular
 * shape was separately enumerated. Takes one parameter besides `node` — the aliases collected
 * so far, the same collaborator `classify()` itself needs — so it is pure/testable on its own
 * structural logic; `findEnvReadsInSourceFile` is the only real caller.
 */
function isSafeConsumingContext(node, aliases) {
  const { node: effNode, parent } = effectiveParent(node);
  if (
    (parent?.kind === ts.SyntaxKind.PropertyAccessExpression ||
      parent?.kind === ts.SyntaxKind.ElementAccessExpression) &&
    parent.expression === effNode
  )
    return true;
  if (
    parent?.kind === ts.SyntaxKind.CallExpression &&
    parent.arguments?.[0] === effNode &&
    classify(parent, aliases) !== null
  )
    return true;
  if (isTrackedAliasDeclarationSite(effNode, parent)) return true;
  // A truthiness test — `if (process)`, `while (import.meta.env)` — reads nothing OUT of the
  // bag/global and hands the value to no one; matches the existing, pre-#423 "does not flag
  // D3 shape L1's false positives" behavior (a condition test is not a read).
  if (
    (parent?.kind === ts.SyntaxKind.IfStatement ||
      parent?.kind === ts.SyntaxKind.WhileStatement ||
      parent?.kind === ts.SyntaxKind.DoStatement) &&
    parent.expression === effNode
  )
    return true;
  if (
    parent?.kind === ts.SyntaxKind.ConditionalExpression &&
    parent.condition === effNode
  )
    return true;
  // `typeof process !== "undefined"` — `typeof` never reads a value out of its operand, same
  // reasoning as the truthiness-test exemption above (Opus review of #423 pass 2, F4).
  if (
    parent?.kind === ts.SyntaxKind.TypeOfExpression &&
    parent.expression === effNode
  )
    return true;
  return false;
}

/** Is `node` a declaration's own BINDING name — a `const p = ...`, a parameter, or a
 * destructuring target — rather than a reference to whatever value that name resolves to?
 * Real JS scoping distinguishes a binding from a reference structurally; `classify()` must
 * never be asked "what does this NAME denote" for the name being introduced, only for a real
 * usage of it (matches this file's own "does not flag D3 shape L1's false positives" note:
 * "this design never calls classify() on a declaration's own name, only on the values
 * initializers/arguments actually resolve to"). A `{ process }` SHORTHAND property is
 * deliberately excluded here — that one Identifier is simultaneously the key and a genuine
 * value reference (D3's own "object literal shorthand property" case). */
const DECLARATION_NAME_HOLDER_KINDS = new Set([
  // Binds a NEW local name — not a reference to whatever that name resolves to.
  ts.SyntaxKind.VariableDeclaration,
  ts.SyntaxKind.Parameter,
  ts.SyntaxKind.BindingElement,
  ts.SyntaxKind.ImportSpecifier,
  ts.SyntaxKind.ImportClause,
  ts.SyntaxKind.NamespaceImport,
  // `export * as process from "./x"` — `process` here is the new binding name the namespace
  // is re-exported under, not a reference to anything (the same non-reference role
  // `NamespaceImport`'s own name plays); it re-exports "./x"'s namespace, never the real
  // global (Opus review of #423 pass 2, F4).
  ts.SyntaxKind.NamespaceExport,
  // A property/method/class/function's own NAME is a key, not a value — `process` as an
  // object-literal property key (`{ process: { env: {...} } }`) or a class/method/function
  // name is exactly as unrelated to the real global as any other identically-spelled local
  // (matches this file's own "ignores nested properties named like runtime globals" note).
  // `ShorthandPropertyAssignment` is deliberately NOT here — that one identifier is
  // simultaneously the key and a genuine value reference (D3's own shorthand-property case).
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  // A member access's own `.name` (`options.process`) is a property name, not a reference to
  // whatever variable happens to share that spelling — `classify`'s own
  // `PropertyAccessExpression` case never looks at it either, only at `.expression`; matches
  // the existing "ignores nested properties named like runtime globals" test.
  ts.SyntaxKind.PropertyAccessExpression,
]);

/**
 * The positions above (`DECLARATION_NAME_HOLDER_KINDS`, keyed off `.name`) plus a handful of
 * further NAME-shaped positions the AST spells with a different field, none of them a value
 * reference either (Opus review of #423 pass 2, F3/F4):
 *
 *  - the LHS of a plain `x = ...` assignment — re-establishing what `x` denotes, not reading
 *    it (matches a declaration's own binding name; without this, `let x; x = process;`
 *    double-charges once `x` becomes a tracked alias on a later fixed-point round, where
 *    `const p = process` alone charges zero — a later genuine read of `x`, e.g. `x.env.Y`,
 *    is unaffected since that identifier is a separate node in a safe consuming context, not
 *    this one);
 *  - a labeled statement's own label, and a `break`/`continue` naming that label;
 *  - a JSX attribute's NAME (`<C process={1}/>` — a prop name, not a value);
 *  - a destructuring element's PROPERTY key when it differs from the bound name (`const {
 *    process: child } = options` — a key read off `options`, not a reference to the global);
 *  - an import specifier's ORIGINAL name (`import { process as p } from "./x"` — names what
 *    is being imported, not a reference to anything already in scope);
 *  - an export specifier's exported name, but ONLY when a distinct local name precedes it
 *    (`export { x as process }` — `process` is purely the exported spelling; `export {
 *    process }` alone has no separate local name, so that same field IS the real local
 *    reference and must still resolve to the global, matching the `ShorthandPropertyAssignment`
 *    carve-out above).
 *
 * A `typeof` operand (`typeof process !== "undefined"`) is a further NAME-shaped position, but
 * lives in `isSafeConsumingContext` instead — unlike the positions here, it isn't restricted to
 * a bare identifier (`typeof process.env` narrows through a real `PropertyAccessExpression`
 * first), so it needs the same parent-of-any-node-kind treatment as the truthiness-test
 * exemption there.
 */
function isDeclarationBindingName(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (node.kind !== ts.SyntaxKind.Identifier) return false;
  if (parent.name === node && DECLARATION_NAME_HOLDER_KINDS.has(parent.kind))
    return true;
  if (
    parent.kind === ts.SyntaxKind.BinaryExpression &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node
  )
    return true;
  if (
    (parent.kind === ts.SyntaxKind.LabeledStatement ||
      parent.kind === ts.SyntaxKind.BreakStatement ||
      parent.kind === ts.SyntaxKind.ContinueStatement) &&
    parent.label === node
  )
    return true;
  if (parent.kind === ts.SyntaxKind.JsxAttribute && parent.name === node)
    return true;
  if (
    parent.kind === ts.SyntaxKind.BindingElement &&
    parent.propertyName === node
  )
    return true;
  if (
    parent.kind === ts.SyntaxKind.ImportSpecifier &&
    parent.propertyName === node
  )
    return true;
  if (
    parent.kind === ts.SyntaxKind.ExportSpecifier &&
    parent.name === node &&
    parent.propertyName
  )
    return true;
  return false;
}

function hasExportModifier(node) {
  return (node?.modifiers ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

/** Every name a binding pattern introduces, recursively — object/array patterns, nesting,
 * rest, defaults, and renamed keys all included. Unlike `flatBindingNames` (which fails
 * closed to `null` the moment a shape gets complex, because IT is deciding what to attribute
 * a read to), this is purely additive: it feeds `exportedNames`, so under-collecting a name
 * here can only leave a later reassignment of it uncharged, never wrongly exempt one — same
 * one-way-safe direction #423 pass 4's plain-identifier collection already relies on. */
function collectBindingNames(nameNode, names) {
  if (nameNode.kind === ts.SyntaxKind.Identifier) {
    names.add(nameNode.text);
    return;
  }
  if (
    nameNode.kind !== ts.SyntaxKind.ObjectBindingPattern &&
    nameNode.kind !== ts.SyntaxKind.ArrayBindingPattern
  )
    return;
  for (const element of nameNode.elements) {
    if (element.kind === ts.SyntaxKind.BindingElement && element.name) {
      collectBindingNames(element.name, names);
    }
  }
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

  // Top-level `export`-modified variable names, collected once so a later plain
  // reassignment (`x = process;`) can be charged as a module-boundary escape too —
  // `handleBindingDeclaration`'s own `exported` check only sees the declaration site.
  // `collectBindingNames` also reaches every name a destructuring declaration introduces
  // (`export let { a: x } = o;`), closing #427 (Opus review of #423 pass 5, F7) — a plain-
  // identifier-only collection here missed exactly that shape's later reassignment.
  const exportedNames = new Set();
  for (const statement of sourceFile.statements) {
    if (
      statement.kind !== ts.SyntaxKind.VariableStatement ||
      !hasExportModifier(statement)
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      collectBindingNames(declaration.name, exportedNames);
    }
  }

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
        if (element.dotDotDotToken) continue; // accepted limit, unchanged — see file header
        const keyNode = element.propertyName ?? element.name;
        if (keyNode.kind !== ts.SyntaxKind.Identifier) {
          // A quoted or computed key off `process`/`import.meta` itself — same fail-closed
          // reasoning as `memberMatch`'s own computed-key default: cannot prove this key is
          // NOT `"env"`, so charge the escape rather than silently drop it (Opus review of
          // #423 pass 1, "Destructuring from process | a quoted or computed key").
          chargeEscape(element, bagKind);
          continue;
        }
        if (keyNode.text !== "env") continue;
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
        if (element.dotDotDotToken) continue; // accepted limit, unchanged — see file header
        const keyNode = element.propertyName ?? element.name;
        if (keyNode.kind !== ts.SyntaxKind.Identifier) {
          // Same fail-closed reasoning as the `process`/`import.meta` branch above, applied
          // to a quoted/computed key reaching for `"process"` off `globalThis`.
          chargeEscape(element, "process.env");
          continue;
        }
        if (keyNode.text !== "process") continue;
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
    if (plainKind === "process" || plainKind === "importMeta") {
      // env/importMetaEnv classifications were already charged above, unconditionally; only
      // the bare-process/import.meta case is new here (#382 M1's `export const p = process`
      // / `export default process`). A function VALUE (`export const get = () => process`)
      // is not a function classify() resolves at all — it is caught generically instead, by
      // `chargeBareValueIfEscaping` reaching the arrow's own return value during the ordinary
      // tree walk into its body, the same as any other return, exported or not.
      chargeBareValueIfEscaping(initializer);
    }
  }

  function visit(node) {
    if (
      (node.kind === ts.SyntaxKind.Identifier ||
        node.kind === ts.SyntaxKind.MetaProperty ||
        node.kind === ts.SyntaxKind.PropertyAccessExpression ||
        node.kind === ts.SyntaxKind.ElementAccessExpression ||
        node.kind === ts.SyntaxKind.CallExpression) &&
      !isDeclarationBindingName(node) &&
      !isSafeConsumingContext(node, aliases)
    ) {
      chargeBareValueIfEscaping(node);
    }
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
      case ts.SyntaxKind.CallExpression: {
        // `import("node:process").then((m) => m.env.X)` — the awaited form is handled by
        // `classify`'s CallExpression case already; this narrow addition resolves the
        // promise-chained callback's own parameter to the same "process" alias, so its
        // body's `.env` access is attributed exactly like any other alias. A destructured
        // (not simple-identifier) callback parameter — `.then(({ env }) => env.X)` — is
        // handled the same way any other destructure of `process`/`import.meta` is.
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
            } else if (
              param?.name?.kind === ts.SyntaxKind.ObjectBindingPattern
            ) {
              analyzeObjectPattern(param.name, target);
            }
          }
        }
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
        // Only the plain-identifier-assignment case still needs its own dispatch (into
        // `handleBindingDeclaration`, for alias-tracking); every other operator — `||`, `??`,
        // `&&`, the comma operator, `in`, a logical-assignment (`||=`/`&&=`/`??=`), an
        // ordinary `=` to a non-identifier target — is handled generically above: whichever
        // operand denotes the bag/global gets visited as its own node with this
        // `BinaryExpression` as its real parent, which is not a recognized safe context, so
        // the blanket check already charges it.
        if (
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          node.left.kind === ts.SyntaxKind.Identifier
        ) {
          handleBindingDeclaration(
            node.left,
            node.right,
            exportedNames.has(node.left.text),
          );
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
