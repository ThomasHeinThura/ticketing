// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these strings are GitHub Actions expression syntax under test — a literal `${{ … }}` runner is the attack
/**
 * A8 red probes — F1 to F7, and GEMINI-A8a.
 *
 * A7d declared a grammar ("a simple command or an `&&` chain") and was still a partial
 * shell parser: it had to decide what `&&`, `;`, `|`, `$( )`, `!` and `set +e` each do to
 * an exit status. F1 to F4 are what it got wrong, and they are not five bugs — they are one
 * bug five times. A parser that models shell will always have one more shape.
 *
 * A8 changes the model instead of extending the rule list: a required gate counts only when
 * its step runs **exactly one command and nothing else**. Then there is no control flow to
 * analyse, no dead code to detect, no shell state to track, and `set`/`shopt` are refused
 * for free because they would be a second statement.
 *
 * `preA8CountedAsExecuting` below is A7d's predicate, kept verbatim as the non-vacuity
 * control. Where a case is genuinely a pre-A8 bypass, it asserts the old predicate accepted
 * it. Where the old predicate ALSO refused a shape, the case says so and is asserted as
 * behaviour rather than dressed up as a bypass it never was — the same discipline that
 * caught two of my own A7 cases.
 *
 * One honest limit, stated rather than glossed: for some F4 shapes (`pnpm x; exit 0`) I have
 * NOT established that GitHub's default `bash -e` would actually have produced a false
 * green, because under errexit the failing gate aborts the script before `exit 0` runs.
 * A8 refuses them anyway — an unproven shape is refused whether or not someone can
 * demonstrate the exploit — and that is precisely the benefit of proving one shape instead
 * of adjudicating many.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  cleanUpScratchRepos,
  initRepo,
  installCheckers,
  installFromRepo,
  runChecker,
  scratchDir,
  write,
} from "../lib/scratch-repo.mjs";
import {
  atomicGateInvocation,
  runnerDefaultShellProven,
  WorkflowGatesUnavailableError,
} from "../lib/workflow-gates.mjs";

after(cleanUpScratchRepos);

const GATE_STEP = "run: pnpm check:overrides";

function readWorkflow(dir) {
  return readFileSync(path.join(dir, ".github/workflows/ci-fast.yml"), "utf8");
}

/** A scratch repo carrying the real checkers, ci-cd.md, both workflows and the setup action. */
function repo(name, mutate = () => {}) {
  const dir = scratchDir(`a8-${name}`);
  initRepo(dir);
  installCheckers(dir);
  installFromRepo(dir, "docs/04-engineering/ci-cd.md");
  installFromRepo(dir, ".github/workflows/ci-fast.yml");
  installFromRepo(dir, ".github/workflows/ci-full.yml");
  installFromRepo(dir, ".github/actions/setup/action.yml");
  mutate(dir);
  return dir;
}

/** Replace the gate step's `run:` with `replacement`, preserving indentation. */
function withGateRun(source, replacement) {
  const lines = source.split("\n");
  const i = lines.findIndex((line) => line.includes(GATE_STEP));
  assert.notEqual(i, -1, "the harness could not find the gate step");
  const pad = " ".repeat(lines[i].length - lines[i].trimStart().length);
  return [
    ...lines.slice(0, i),
    ...replacement.split("\n").map((line) => (line === "" ? "" : pad + line)),
    ...lines.slice(i + 1),
  ].join("\n");
}

/** Replace the gate job's `runs-on:` value. */
function withRunsOn(source, value) {
  const lines = source.split("\n");
  const step = lines.findIndex((line) => line.includes(GATE_STEP));
  let job = step;
  while (job >= 0 && !/^ {2}[a-z0-9_-]+:\s*$/.test(lines[job])) job -= 1;
  for (let i = job; i < step; i += 1) {
    if (/^ {4}runs-on:/.test(lines[i])) {
      lines[i] = `    runs-on: ${value}`;
      return lines.join("\n");
    }
  }
  assert.fail("no runs-on found in the gate job");
}

/**
 * **A7d's predicate, verbatim.** The non-vacuity control: it split a `run:` on newlines and
 * `;`, then accepted any logical line that was a simple command or an `&&` chain of them.
 * It had no idea whether the line ever executed.
 */
function preA8CountedAsExecuting(runValue) {
  const SIMPLE =
    /^[A-Za-z0-9_@./:+-]+(?:\s+(?:[A-Za-z0-9_@./:=+,~^-]+|'[^']*'|"[^"]*"))*$/;
  const KEYWORDS = new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "exit",
    "echo",
    "cd",
    "set",
    "export",
    "true",
    "false",
  ]);
  const joined = runValue.replace(/\\\n/g, " ");
  const disablesErrexit = /(^|\s)set\s+(\+e\b|\+o\s+errexit\b)/m.test(joined);
  if (disablesErrexit) return false;
  for (const logical of joined.split(/\n|;/)) {
    if (!/(?:^|\s)pnpm\s/.test(logical)) continue;
    const parts = logical.split("&&").map((part) => part.trim());
    const ok = parts.every((part) => {
      if (part === "") return false;
      const head = /^([A-Za-z][\w.-]*)/.exec(part)?.[1];
      if (head !== undefined && KEYWORDS.has(head)) return false;
      return SIMPLE.test(part);
    });
    if (ok) return true; // A7d would have called this occurrence proven
  }
  return false;
}

// ── F1 · shell options the old `set +e` regex never matched ────────────────────────────
describe("F1 — shell-option shapes that disabled errexit and were not noticed", () => {
  for (const [name, prelude] of [
    ["set +ex", "set +ex"],
    ["set +eu", "set +eu"],
    ["set +o pipefail +o errexit", "set +o pipefail +o errexit"],
    ["shopt -uo errexit", "shopt -uo errexit"],
  ]) {
    it(`RED — ${name}`, () => {
      const run = `run: |\n  ${prelude}\n  pnpm check:overrides`;
      // NON-VACUITY: A7d's regex anchored on `\+e\b` / `\+o\s+errexit`, so `+ex`, `+eu` and
      // a `+o pipefail` written first all slipped past it, and `shopt` was never considered.
      assert.equal(
        preA8CountedAsExecuting(run.replace(/^run: \|\n/, "")),
        true,
        "the pre-A8 predicate must have accepted this, or F1 is not the defect",
      );
      const dir = repo(`f1-${name.replace(/[^a-z]+/gi, "-")}`, (d) => {
        write(
          d,
          ".github/workflows/ci-fast.yml",
          withGateRun(readWorkflow(d), run),
        );
      });
      const result = runChecker(dir, "test-all.mjs", ["--list"]);
      assert.equal(result.status, 1, result.output);
      assert.match(
        result.output,
        /not an atomic gate invocation|NO workflow executes it/,
      );
    });
  }
});

// ── F2 · the gate is present, and never runs ───────────────────────────────────────────
describe("F2 — a gate that is textually present but is dead code or data", () => {
  for (const [name, body] of [
    ["inside an uncalled function", "gate() {\n    pnpm check:overrides\n  }"],
    ["inside heredoc DATA", "cat <<'EOF'\n  pnpm check:overrides\n  EOF"],
    ["after an unconditional exit 0", "exit 0\n  pnpm check:overrides"],
    [
      "inside a zero-iteration loop",
      "for shard in ; do\n    pnpm check:overrides\n  done",
    ],
    [
      "inside a quoted multiline string",
      "MESSAGE='\n  pnpm check:overrides\n  '",
    ],
  ]) {
    it(`RED — a gate ${name}`, () => {
      const run = `run: |\n  ${body}`;
      // NON-VACUITY: A7d looked at each logical line in isolation. The gate's own line is a
      // perfectly simple command, so A7d proved it — while the surrounding program meant it
      // never executed at all.
      assert.equal(
        preA8CountedAsExecuting(run.replace(/^run: \|\n/, "")),
        true,
        "the pre-A8 predicate must have accepted this, or F2 is not the defect",
      );
      const dir = repo(
        `f2-${name.replace(/[^a-z]+/gi, "-").slice(0, 22)}`,
        (d) => {
          write(
            d,
            ".github/workflows/ci-fast.yml",
            withGateRun(readWorkflow(d), run),
          );
        },
      );
      const result = runChecker(dir, "test-all.mjs", ["--list"]);
      assert.equal(result.status, 1, result.output);
      assert.match(
        result.output,
        /not an atomic gate invocation|NO workflow executes it/,
      );
    });
  }

  /**
   * A case branch, asserted as BEHAVIOUR rather than as a bypass.
   *
   * It was written as an F2 case and the non-vacuity control rejected it: A7d's grammar
   * saw `impossible) pnpm check:overrides` and refused it too, because of the `)`. So the
   * old predicate did NOT accept this shape, and keeping it in the controlled list would
   * have made one of six cases decorative. It must still be refused, so it is asserted
   * here — the same correction two of the A7 cases needed.
   */
  it("RED — a gate inside a case branch that cannot match (behaviour, not a pre-A8 bypass)", () => {
    const dir = repo("f2-case", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        withGateRun(
          readWorkflow(d),
          "run: |\n  case nothing in\n    impossible) pnpm check:overrides ;;\n  esac",
        ),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /not an atomic gate invocation|NO workflow executes it/,
    );
  });
});

// ── F3 / F7 · YAML scalar forms, which must never be silently discarded ────────────────
describe("F3 and F7 — unsupported YAML forms fail CLOSED, never silently", () => {
  for (const [name, run] of [
    ["a folded `run: >`", "run: >\n  pnpm check:overrides"],
    ["a strip-chomped `run: |-`", "run: |-\n  pnpm check:overrides"],
    ["a keep-chomped `run: |+`", "run: |+\n  pnpm check:overrides"],
    ["an explicit-indent `run: |2`", "run: |2\n  pnpm check:overrides"],
    ["a folded strip `run: >-`", "run: >-\n  pnpm check:overrides"],
    [
      "a plain multiline continuation",
      "run: pnpm check:overrides\n  --unexpected-flag",
    ],
  ]) {
    it(`throws WorkflowGatesUnavailableError for ${name}`, () => {
      const dir = repo(
        `f3-${name.replace(/[^a-z]+/gi, "-").slice(0, 22)}`,
        (d) => {
          write(
            d,
            ".github/workflows/ci-fast.yml",
            withGateRun(readWorkflow(d), run),
          );
        },
      );
      const result = runChecker(dir, "test-all.mjs", ["--list"]);
      assert.equal(result.status, 1, result.output);
      // The point is the ERROR, not a quiet zero. Silence is what F7 was.
      assert.match(
        result.output,
        /does not deliberately implement|continues a plain `run:` scalar/,
      );
    });
  }

  it("throws for a `steps:` sequence written FLUSH with its key", () => {
    const dir = repo("f7-flush", (d) => {
      const source = readWorkflow(d).split("\n");
      // Re-indent one job's steps flush with the `steps:` key.
      const at = source.findIndex((line) => line.includes(GATE_STEP));
      let stepsAt = at;
      while (stepsAt >= 0 && !/^ {4}steps:\s*$/.test(source[stepsAt]))
        stepsAt -= 1;
      for (let i = stepsAt + 1; i < source.length; i += 1) {
        if (/^ {2}[a-z0-9_-]+:\s*$/.test(source[i])) break;
        if (source[i].startsWith("      ")) source[i] = source[i].slice(2);
      }
      write(d, ".github/workflows/ci-fast.yml", source.join("\n"));
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FLUSH with its key|cannot attribute/);
  });
});

// ── F4 / GEMINI-A8a · which shell actually runs it ─────────────────────────────────────
describe("F4 and GEMINI-A8a — the shell must be proven, not assumed bash", () => {
  for (const shell of ["pwsh", "powershell", "python"]) {
    it(`RED — an explicit \`shell: ${shell}\``, () => {
      const dir = repo(`f4-${shell}`, (d) => {
        write(
          d,
          ".github/workflows/ci-fast.yml",
          withGateRun(
            readWorkflow(d),
            `shell: ${shell}\nrun: pnpm check:overrides`,
          ),
        );
      });
      const result = runChecker(dir, "test-all.mjs", ["--list"]);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /not a proven shell/);
    });
  }

  it("RED — `pnpm <gate>; exit 0`", () => {
    // Refused as non-atomic. NOT claimed as a demonstrated false green: under GitHub's
    // default `bash -e` the failing gate aborts before `exit 0` runs. It is refused because
    // it is not one command — which is the point of proving a shape instead of an exploit.
    const dir = repo("f4-exit0", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        withGateRun(readWorkflow(d), "run: pnpm check:overrides; exit 0"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /not an atomic gate invocation|NO workflow executes it/,
    );
  });

  it("RED — a failing gate followed by a successful command", () => {
    const dir = repo("f4-then-success", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        withGateRun(
          readWorkflow(d),
          "run: |\n  pnpm check:overrides\n  echo recovered",
        ),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /not an atomic gate invocation|NO workflow executes it/,
    );
  });
});

// ── F5 · the runner decides the default shell ──────────────────────────────────────────
describe("F5 — the runner is not inert", () => {
  it("RED — `runs-on: windows-latest` with no explicit shell", () => {
    // PowerShell is the Windows default, and a failing NATIVE command there sets
    // $LASTEXITCODE without terminating the script — so the gate fails and the step passes.
    const dir = repo("f5-windows", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        withRunsOn(readWorkflow(d), "windows-latest"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /default shell is not proven|Windows defaults to PowerShell/,
    );
  });

  it("RED — a windows runner, no shell, and a successful command after the gate", () => {
    const dir = repo("f5-windows-then-success", (d) => {
      let source = withRunsOn(readWorkflow(d), "windows-latest");
      source = withGateRun(
        source,
        "run: |\n  pnpm check:overrides\n  echo recovered",
      );
      write(d, ".github/workflows/ci-fast.yml", source);
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
  });

  for (const [name, value] of [
    ["a matrix expression", "${{ matrix.os }}"],
    ["a self-hosted label", "self-hosted"],
  ]) {
    it(`RED — ${name} as the runner`, () => {
      const dir = repo(`f5-${name.replace(/[^a-z]+/gi, "-")}`, (d) => {
        write(
          d,
          ".github/workflows/ci-fast.yml",
          withRunsOn(readWorkflow(d), value),
        );
      });
      const result = runChecker(dir, "test-all.mjs", ["--list"]);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /default shell is not proven/);
    });
  }

  it("GREEN — the Linux positive control: ubuntu-latest, no explicit shell", () => {
    const dir = repo("f5-linux-control");
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(
      result.status,
      0,
      `the shipped Linux runners must stay proven:\n${result.output}`,
    );
  });

  it("GREEN — a non-proven runner is rescued by an explicit `shell: bash`", () => {
    // The second of the two proof routes: name the shell instead of the image.
    // The gate's job (`registers`) carries FIVE gates, so rescuing one is not enough —
    // the other four would still run on an unproven runner with no shell. That is the
    // check behaving correctly, and it is why every gate step in the job gets the shell.
    const dir = repo("f5-shell-rescue", (d) => {
      const source = withRunsOn(readWorkflow(d), "self-hosted")
        .split("\n")
        .flatMap((line) => {
          const gate = /^(\s*)run: (pnpm .*)$/.exec(line);
          if (!gate) return [line];
          return [`${gate[1]}shell: bash`, line];
        })
        .join("\n");
      write(d, ".github/workflows/ci-fast.yml", source);
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 0, result.output);
  });

  it("the runner predicate itself", () => {
    assert.equal(runnerDefaultShellProven("ubuntu-latest"), true);
    assert.equal(runnerDefaultShellProven("macos-14"), true);
    assert.equal(runnerDefaultShellProven("windows-latest"), false);
    assert.equal(runnerDefaultShellProven("self-hosted"), false);
    assert.equal(runnerDefaultShellProven("${{ matrix.os }}"), false);
    assert.equal(runnerDefaultShellProven(""), false);
  });
});

// ── F6 · stage authority ───────────────────────────────────────────────────────────────
describe("F6 — only the authorized workflow satisfies a stage", () => {
  it("RED — the gate is moved out of ci-fast.yml into an unauthorized PR workflow", () => {
    const dir = repo("f6-substituted", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        readWorkflow(d)
          .split("\n")
          .filter((line) => !line.includes("check:overrides"))
          .join("\n"),
      );
      write(
        d,
        ".github/workflows/sneaky.yml",
        [
          "name: sneaky",
          "on:",
          "  pull_request:",
          "jobs:",
          "  overrides:",
          "    name: overrides",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - name: pnpm check:overrides",
          "        run: pnpm check:overrides",
          "",
        ].join("\n"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /must be satisfied by its authorized workflow/);
  });

  it("RED — a FAST gate appearing only in ci-full.yml", () => {
    const dir = repo("f6-full-rescue", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        readWorkflow(d)
          .split("\n")
          .filter((line) => !line.includes("check:overrides"))
          .join("\n"),
      );
      const full = readFileSync(
        path.join(d, ".github/workflows/ci-full.yml"),
        "utf8",
      );
      write(
        d,
        ".github/workflows/ci-full.yml",
        `${full}\n  overrides:\n    name: overrides\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/setup\n      - name: pnpm check:overrides\n        run: pnpm check:overrides\n`,
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /ci-full\.yml can never rescue|authorized workflow/,
    );
  });

  it("GREEN — the shipped stage bindings", () => {
    const dir = repo("f6-shipped");
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 0, result.output);
  });
});

// ── Invariant 7 · trigger coverage ─────────────────────────────────────────────────────
describe("A8 invariant 7 — an authorized workflow must run where its stage is required", () => {
  it("RED — ci-fast.yml narrows pull_request.types below the defaults", () => {
    const dir = repo("t7-narrowed", (d) => {
      write(
        d,
        ".github/workflows/ci-fast.yml",
        readWorkflow(d).replace(/^ {4}types:.*$/m, "    types: [labeled]"),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      /narrows `pull_request.types`|does not trigger on/,
    );
  });

  it("RED — ci-full.yml loses merge_group, so its own narrowing stops being defensible", () => {
    const dir = repo("t7-no-merge-group", (d) => {
      const full = readFileSync(
        path.join(d, ".github/workflows/ci-full.yml"),
        "utf8",
      );
      write(
        d,
        ".github/workflows/ci-full.yml",
        full.replace(/^ {2}merge_group:\s*$/m, ""),
      );
    });
    const result = runChecker(dir, "test-all.mjs", ["--list"]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /does not trigger on `merge_group`/);
  });
});

// ── The atomic predicate, directly ─────────────────────────────────────────────────────
describe("atomicGateInvocation — the one supported shape", () => {
  for (const value of [
    "pnpm check:overrides",
    "pnpm audit --audit-level=high",
    "pnpm --filter @taskdesk/api build",
    "helm lint charts/taskdesk",
  ]) {
    it(`atomic: ${value}`, () => {
      assert.equal(atomicGateInvocation(value, { plain: true }).atomic, true);
    });
  }

  for (const [name, value] of [
    ["a pipeline", "pnpm check:overrides | tee log"],
    ["an or-else", "pnpm check:overrides || true"],
    ["an and-then", "pnpm check:overrides && echo ok"],
    ["a semicolon chain", "pnpm check:overrides; echo ok"],
    ["a background job", "pnpm check:overrides &"],
    ["a substitution", "$(pnpm check:overrides)"],
    ["an inversion", "! pnpm check:overrides"],
    ["a redirection", "pnpm check:overrides > /dev/null"],
    ["a shell keyword head", "if pnpm check:overrides"],
    ["a set builtin", "set -e"],
    ["a shopt builtin", "shopt -uo errexit"],
    ["an empty value", "   "],
  ]) {
    it(`not atomic: ${name}`, () => {
      assert.equal(atomicGateInvocation(value, { plain: true }).atomic, false);
    });
  }

  it("a block scalar is never atomic, whatever it contains", () => {
    const verdict = atomicGateInvocation("pnpm check:overrides\n", {
      plain: false,
    });
    assert.equal(verdict.atomic, false);
    assert.match(verdict.why, /single-line plain scalar/);
  });

  it("the error type is the fail-closed one", () => {
    assert.ok(
      new WorkflowGatesUnavailableError("x") instanceof Error,
      "the fail-closed error must be a real Error",
    );
  });
});
