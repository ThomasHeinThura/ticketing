import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const referencePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function fsyncDirectory(directory) {
  const dir = openSync(directory, "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}

function saveJournalState(file, state, create = false) {
  const next = `${file}.next`;
  const fd = openSync(next, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (create && existsSync(file)) {
    try {
      unlinkSync(next);
    } catch {}
    throw new Error("A recovery journal already exists.");
  }
  renameSync(next, file);
  fsyncDirectory(dirname(file));
}

// A started operation is deliberately distinguishable from a completed one:
// after a crash its outcome must be inspected, never assumed or repeated.
export function openFreshJournal(file, initial) {
  if (existsSync(file) || existsSync(`${file}.next`))
    throw new Error("Existing recovery journal requires operator recovery.");
  const state = { version: 1, ...initial, steps: [] };
  saveJournalState(file, state, true);
  return {
    snapshot: () => structuredClone(state),
    step(name, action) {
      if (state.steps.some((step) => step.state !== "done"))
        throw new Error("Prior journal step requires reconciliation.");
      const entry = { name, state: "started" };
      state.steps.push(entry);
      saveJournalState(file, state);
      let result;
      try {
        result = action();
      } catch (error) {
        entry.state = "failed";
        saveJournalState(file, state);
        throw error;
      }
      entry.state = "done";
      saveJournalState(file, state);
      return result;
    },
  };
}

export function readFreshJournal(file) {
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (
    value.version !== 1 ||
    !Array.isArray(value.steps) ||
    value.steps.some(
      (s) =>
        typeof s.name !== "string" ||
        !["started", "failed", "done"].includes(s.state),
    )
  )
    throw new Error("Invalid recovery journal.");
  return value;
}

// An adapter must independently inspect the postcondition for every recorded
// operation. A failed command may have changed Docker before the client failed,
// so unknown or contradictory results cannot be retried automatically.
export function reconcileFreshJournal(journal, inspect) {
  if (!Array.isArray(journal.steps))
    throw new Error("Invalid recovery journal.");
  const pending = [];
  for (const step of journal.steps) {
    const observed = inspect(step.name);
    if (!["applied", "not-applied"].includes(observed))
      throw new Error(`Cannot determine outcome of ${step.name}.`);
    if (step.state === "done" && observed !== "applied")
      throw new Error(`Docker state disagrees with ${step.name}.`);
    if (step.state !== "done" && observed === "not-applied")
      pending.push(step.name);
  }
  return pending;
}

export function resumeFreshJournal(file, inspect) {
  if (existsSync(`${file}.next`))
    throw new Error("Incomplete recovery journal write requires inspection.");
  const state = readFreshJournal(file);
  if (state.restoreStarted)
    throw new Error(
      "Backup restoration is already in progress; finish with --restore-from-backup.",
    );
  if (
    state.steps.some(
      (step) => step.name === "complete" && step.state === "done",
    )
  )
    throw new Error("Recovery journal is already complete.");
  const pending = reconcileFreshJournal(state, (name) => inspect(name, state));
  const pendingSet = new Set(pending);
  let updated = false;
  for (const step of state.steps) {
    if (step.state !== "done" && !pendingSet.has(step.name)) {
      step.state = "done";
      updated = true;
    }
  }
  if (updated) saveJournalState(file, state);
  return {
    journal: structuredClone(state),
    pending,
    snapshot: () => structuredClone(state),
    step(name, action, fallbackResult) {
      const existing = state.steps.find((step) => step.name === name);
      if (existing && existing.state === "done") {
        return typeof fallbackResult === "function"
          ? fallbackResult()
          : fallbackResult;
      }
      if (
        state.steps.some((step) => step !== existing && step.state !== "done")
      )
        throw new Error("Prior journal step requires reconciliation.");
      const entry = existing ?? { name, state: "started" };
      entry.state = "started";
      if (!existing) state.steps.push(entry);
      saveJournalState(file, state);
      let result;
      try {
        result = action();
      } catch (error) {
        entry.state = "failed";
        saveJournalState(file, state);
        throw error;
      }
      entry.state = "done";
      saveJournalState(file, state);
      return result;
    },
  };
}

export function markFreshJournalRestoreStarted(file) {
  if (existsSync(`${file}.next`))
    throw new Error("Incomplete recovery journal write requires inspection.");
  const state = readFreshJournal(file);
  if (
    state.steps.some(
      (step) => step.name === "complete" && step.state === "done",
    )
  )
    throw new Error("Completed journal cannot be overwritten by recovery.");
  if (!state.restoreStarted) {
    state.restoreStarted = true;
    saveJournalState(file, state);
  }
  return structuredClone(state);
}

export function clearFreshJournalAfterRestore(file, restoredAt) {
  if (existsSync(`${file}.next`))
    throw new Error("Incomplete recovery journal write requires inspection.");
  const state = readFreshJournal(file);
  const archive = `${file.slice(0, -".json".length)}.restored.json`;
  const archived = {
    ...state,
    restoredAt,
    steps: [...state.steps, { name: "restored", state: "done" }],
  };
  const fd = openSync(archive, "wx", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(archived, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  unlinkSync(file);
  fsyncDirectory(dirname(file));
}

export function findUnfinishedFreshJournal(privateDir, requestedReference) {
  if (
    requestedReference !== undefined &&
    !referencePattern.test(requestedReference)
  )
    throw new Error("Invalid recovery reference.");
  const root = join(realpathSync(privateDir), "fresh-backups");
  if (!existsSync(root) || !lstatSync(root).isDirectory())
    throw new Error("No unfinished recovery journal exists.");
  const unfinished = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error("Backup inventory contains a symbolic link.");
    if (!entry.isDirectory()) continue;
    const backupDir = join(root, entry.name);
    if (existsSync(join(backupDir, "proof-uncertain")))
      throw new Error(
        `Uncertain restore-proof cleanup requires manual inspection (${entry.name}).`,
      );
    const journalFile = join(backupDir, "journal.json");
    if (existsSync(`${journalFile}.next`))
      throw new Error(
        `Incomplete recovery journal write requires manual inspection (${entry.name}).`,
      );
    if (!existsSync(journalFile)) continue;
    const stat = lstatSync(journalFile);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("Recovery journal is not a regular file.");
    const journal = readFreshJournal(journalFile);
    if (journal.reference !== entry.name)
      throw new Error("Recovery journal reference does not match directory.");
    const complete = journal.steps.some(
      (step) => step.name === "complete" && step.state === "done",
    );
    if (!complete) {
      unfinished.push({
        reference: entry.name,
        backupDir,
        journalFile,
        journal,
      });
    }
  }
  if (requestedReference !== undefined) {
    const match = unfinished.find(
      (item) => item.reference === requestedReference,
    );
    if (!match)
      throw new Error(
        "Requested recovery reference has no unfinished journal.",
      );
    if (unfinished.length > 1)
      throw new Error(
        "Multiple unfinished recovery journals exist; inspect manually.",
      );
    return match;
  }
  if (unfinished.length !== 1)
    throw new Error(
      unfinished.length === 0
        ? "No unfinished recovery journal exists."
        : "Multiple unfinished recovery journals exist; specify a reference.",
    );
  return unfinished[0];
}
