/**
 * `| G1 | waived | … |` — what a waiver has to produce before CI believes it.
 *
 * **GPT-F4 — `waived` was not tied to one explicit waiver decision.** The F7 fix replaced
 * "any non-empty third cell" with "a citation to docs/07-planning/decision-log.md, plus
 * the gate identifier appearing anywhere in that file". Both halves are too weak, and the
 * second is weak in a way that reads as strong:
 *
 *   - the `#anchor` was optional, so a waiver could cite a 2,000-line document rather
 *     than a decision;
 *   - the identifier test was `new RegExp("\\bG1\\b", "i")` over the WHOLE file, so any
 *     mention anywhere authorised the waiver. The decision log already contains dozens of
 *     `G1`…`G13` mentions in unrelated entries. Worse, the sentence *"G1 is not waived"*
 *     — which this very repository's own PR bodies contain — satisfied it perfectly.
 *
 * So a control that printed "no entry, no waiver" actually meant "the string G1 appears
 * somewhere in a file that is 1,400 lines long".
 *
 * ## What replaced it
 *
 * Prose cannot be read for intent by a regular expression, and trying is how the negation
 * bypass happened. So the decision log carries a **declaration**, not a sentence, and the
 * declaration is what is checked. One line, inside the cited entry, whole-line anchored:
 *
 *   **Waives gate:** `G1` · **PR:** #19 · **Follow-up:** #123
 *
 * Three bindings, all of them things the previous check could not do:
 *
 *   1. **A specific entry.** The `#anchor` is mandatory and must resolve to exactly one
 *      heading in the decision log. The declaration is then looked for in THAT entry's
 *      body only — not in the file.
 *   2. **This gate.** The identifier is inside backticks and compared exactly, so a
 *      neighbouring entry about G2 cannot authorise G1 and a mention in prose cannot
 *      authorise anything.
 *   3. **This pull request, and a follow-up issue.** A waiver is scoped to the change it
 *      excuses; a blanket waiver is not a waiver. The follow-up issue is
 *      ux-quality-gates.md § Waiving a gate step 3 made mechanical — "a waiver without a
 *      follow-up issue is not a waiver, it is debt with no owner".
 *
 * *"G1 is not waived"* cannot produce that line, which is the adversarial case this
 * design is built around rather than patched for.
 *
 * ## What is still NOT enforced, said plainly
 *
 * Step 2 of that procedure — "get explicit approval from Thomas. An AI agent may not
 * self-approve a waiver" — remains unenforceable here and is not claimed. Agents commit
 * through the same repository identity Thomas does, so nothing readable from a pull
 * request or a committed file proves who authored a line. What the declaration provides
 * is a durable, specific, unambiguous, reviewable record in version control, bound to the
 * gate, the pull request and a follow-up issue. Authorship is Thomas's to confirm at the
 * merge button, and the message says so instead of implying the machine checked it.
 */

/** One line, whole-line anchored. Nothing may follow it, so no clause can negate it. */
const DECLARATION =
  /^[ \t]*\*\*Waives gate:\*\*[ \t]*`([^`]+)`[ \t]*[·|—–-][ \t]*\*\*PR:\*\*[ \t]*#(\d+)[ \t]*[·|—–-][ \t]*\*\*Follow-up:\*\*[ \t]*#(\d+)[ \t]*$/gim;

/** The canonical form of the declaration, for the failure messages. */
export const DECLARATION_SYNTAX =
  "**Waives gate:** `<gate>` · **PR:** #<pr> · **Follow-up:** #<issue>";

/**
 * GitHub's heading-anchor slug: lower-cased, punctuation dropped, spaces to hyphens.
 *
 * The `·` in `### 2026-09-08 · The mandatory security review …` is dropped and leaves the
 * two spaces around it behind, so that heading's anchor really does carry a double
 * hyphen. Reproducing that exactly matters — the anchor an author copies out of the
 * rendered page is the one this has to resolve.
 *
 * @param {string} heading
 * @returns {string}
 */
export function slugifyHeading(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Zs}\p{Pd}_]/gu, "")
    .replace(/\p{Zs}/gu, "-")
    .replace(/\p{Pd}/gu, "-");
}

/**
 * Every heading in a markdown document, with the body it owns.
 *
 * EVERY heading, at every level, because GitHub gives every heading an anchor and an
 * author will cite the one they can see in the rendered page. A heading's body runs to
 * the next heading at the same level or higher, so a `###` decision entry with `####`
 * subsections owns all of them — a declaration inside a subsection is inside the entry.
 *
 * @param {string} source
 * @returns {{heading: string, level: number, anchor: string, body: string}[]}
 */
export function documentEntries(source) {
  const lines = source.split("\n");
  const headings = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(lines[i]);
    if (match) {
      headings.push({ index: i, level: match[1].length, heading: match[2] });
    }
  }

  return headings.map((current, position) => {
    let end = lines.length;
    for (const later of headings.slice(position + 1)) {
      if (later.level <= current.level) {
        end = later.index;
        break;
      }
    }
    return {
      heading: current.heading,
      level: current.level,
      anchor: slugifyHeading(current.heading),
      body: lines.slice(current.index + 1, end).join("\n"),
    };
  });
}

/**
 * Waiver declarations inside one entry body.
 *
 * @param {string} body
 * @returns {{gate: string, pr: number, followUp: number}[]}
 */
export function waiverDeclarations(body) {
  const found = [];
  DECLARATION.lastIndex = 0;
  for (
    let match = DECLARATION.exec(body);
    match !== null;
    match = DECLARATION.exec(body)
  ) {
    found.push({
      gate: match[1].replace(/\s+/g, " ").trim(),
      pr: Number(match[2]),
      followUp: Number(match[3]),
    });
  }
  return found;
}

/**
 * The comparable form of a gate token: backticks removed, whitespace collapsed, case
 * folded.
 *
 * Backticks go because the declaration itself is delimited by them, so a gate whose
 * label contains code spans — `Route coverage (\`test:permissions\`)` in the template —
 * cannot be written inside them literally. Removing them from BOTH sides means the
 * declaration is authored as `` `Route coverage (test:permissions)` `` and still binds
 * to that row, with no ambiguity introduced: no two gate labels in the template differ
 * only by a backtick.
 */
export function normaliseGateToken(value) {
  return value.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Compare a declared gate token with the identifier taken from the `## Gates` row. */
function sameGate(declared, identifier) {
  return normaliseGateToken(declared) === normaliseGateToken(identifier);
}

/**
 * Resolve `#anchor` against a document's headings.
 *
 * Exact slug first; then a hyphen-collapsed comparison, because a hand-written anchor
 * that writes one hyphen where GitHub emits two is a typo rather than a different
 * decision. Ambiguity — two headings collapsing to the same anchor — is a failure, not a
 * guess.
 *
 * @returns {{kind:"one", entry: object} | {kind:"none"} | {kind:"many", headings: string[]}}
 */
export function resolveAnchor(entries, anchor) {
  const wanted = anchor.toLowerCase();
  const exact = entries.filter((entry) => entry.anchor === wanted);
  if (exact.length === 1) return { kind: "one", entry: exact[0] };
  if (exact.length > 1)
    return { kind: "many", headings: exact.map((entry) => entry.heading) };

  const collapse = (value) => value.replace(/-+/g, "-");
  const loose = entries.filter(
    (entry) => collapse(entry.anchor) === collapse(wanted),
  );
  if (loose.length === 1) return { kind: "one", entry: loose[0] };
  if (loose.length > 1)
    return { kind: "many", headings: loose.map((entry) => entry.heading) };

  return { kind: "none" };
}

/**
 * The gate identifier a `## Gates` row waives. `G1 — No bespoke primitives` is waived as
 * `G1`; a row with no `G<n>` prefix is waived by its whole label.
 *
 * @param {string} gateCell
 * @returns {string}
 */
export function gateIdentifier(gateCell) {
  return /^\s*(G\d+)\b/.exec(gateCell)?.[1] ?? gateCell.trim();
}

/**
 * Verify one waived `## Gates` row.
 *
 * @param {object} input
 * @param {string} input.gate the row's gate cell, verbatim, for the messages
 * @param {string} input.link the row's third cell
 * @param {string|null} input.decisionLog decision-log.md contents, or null when absent
 * @param {string} input.decisionLogPath repo-relative path, for the messages
 * @param {number|null} input.pullRequest this pull request's number, or null when unknown
 * @returns {{ok: true, anchor: string, followUp: number} | {ok: false, problem: string}}
 */
export function verifyWaiver({
  gate,
  link,
  decisionLog,
  decisionLogPath,
  pullRequest,
}) {
  const identifier = gateIdentifier(gate);
  // Shown inside backticks in the messages, so its own backticks are stripped first.
  const shownIdentifier = identifier.replace(/`/g, "");
  const cell = link ?? "";

  const reference = new RegExp(
    `${decisionLogPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}#([\\p{L}\\p{N}_.-]+)`,
    "u",
  ).exec(cell);

  if (!reference) {
    const cited = new RegExp(
      decisionLogPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).test(cell);
    return {
      ok: false,
      problem:
        `"${gate}" is waived and its link cell ${cell === "" ? "is empty" : `reads "${cell}"`}. ` +
        (cited
          ? `A waiver must cite ONE decision, not the whole of ${decisionLogPath} — ` +
            "append the entry's `#anchor`. "
          : `A waiver must cite a committed entry in ${decisionLogPath} with its ` +
            "`#anchor`. ") +
        `That entry must carry the declaration\n        ${DECLARATION_SYNTAX}\n` +
        "      This check CANNOT verify who authored a waiver — agents share the " +
        "repository identity — so the durable, specific, gate-bound record is the whole " +
        "control: no declaration, no waiver.",
    };
  }

  if (decisionLog === null) {
    return {
      ok: false,
      problem: `"${gate}" cites ${decisionLogPath}, which is not present in this branch.`,
    };
  }

  if (pullRequest === null) {
    return {
      ok: false,
      problem:
        `"${gate}" is waived, and this run could not determine which pull request it is ` +
        "checking. A waiver is scoped to one pull request, so it cannot be verified " +
        "without that number — pass `--pr <number>`, or run in the pull-request event " +
        "context. Failing closed: an unscoped waiver is a blanket waiver.",
    };
  }

  const anchor = reference[1];
  const resolution = resolveAnchor(documentEntries(decisionLog), anchor);

  if (resolution.kind === "none") {
    return {
      ok: false,
      problem:
        `"${gate}" cites ${decisionLogPath}#${anchor}, and no heading in that document ` +
        "has that anchor. A waiver has to point at a specific decision entry; an anchor " +
        "that resolves to nothing points at the whole file, which is what GPT-F4 " +
        "closed.",
    };
  }

  if (resolution.kind === "many") {
    return {
      ok: false,
      problem:
        `"${gate}" cites ${decisionLogPath}#${anchor}, which matches ` +
        `${resolution.headings.length} headings (${resolution.headings.join("; ")}). ` +
        "Which entry authorises the waiver must not be a matter of interpretation.",
    };
  }

  const entry = resolution.entry;
  const declarations = waiverDeclarations(entry.body);
  const forThisGate = declarations.filter((declaration) =>
    sameGate(declaration.gate, identifier),
  );

  if (forThisGate.length === 0) {
    const others = declarations.map((declaration) => `\`${declaration.gate}\``);
    return {
      ok: false,
      problem:
        `"${gate}" is waived citing ${decisionLogPath}#${anchor} ("${entry.heading}"), ` +
        `and that entry carries no waiver declaration for \`${shownIdentifier}\`. ` +
        (others.length > 0
          ? `It declares ${others.join(", ")}. `
          : "It declares none at all. ") +
        `Add, inside that entry, on one line:\n        ${DECLARATION_SYNTAX}\n` +
        "      Prose is deliberately not accepted. The previous check looked for the " +
        'gate identifier anywhere in the document, which the sentence "' +
        `${shownIdentifier} is not waived" satisfied — so intent is declared in a fixed ` +
        "syntax that a negation cannot produce.",
    };
  }

  const forThisPr = forThisGate.filter(
    (declaration) => declaration.pr === pullRequest,
  );

  if (forThisPr.length === 0) {
    return {
      ok: false,
      problem:
        `"${gate}" is waived citing ${decisionLogPath}#${anchor} ("${entry.heading}"), ` +
        `and that entry's declaration for \`${shownIdentifier}\` names PR ` +
        `${forThisGate.map((declaration) => `#${declaration.pr}`).join(", ")}, not ` +
        `#${pullRequest}. A waiver is scoped to the change it excuses. Reusing another ` +
        "pull request's waiver is how one exception becomes the default.",
    };
  }

  return { ok: true, anchor, followUp: forThisPr[0].followUp };
}
