# PR #535 — independent GPT-6 Sol security review

**Reviewed head:** `477b9b645dc88e78dc12563d42df77ce788fb763`  
**Comparison base:** `c891e9bcd4abf9b77b4916561d9bc5ca367065e5`  
**Verdict:** **CLEAR — no blocking or non-blocking security findings**

## Independence and scope

Fresh GPT-6 Sol review context. I did not materially author, direct, or remediate this candidate. The required strong ordinary review by an independent GPT-6 Luna context cleared this exact head first (`/private/tmp/pr535-477b-luna-storage.md`). This is a full security review because `apps/api/src/storage/**` is security scope and the change alters the path used for filesystem containment decisions.

I inspected both changed files (`apps/api/src/storage/filesystem.ts`, `tests/api/storage/filesystem.test.ts`), the exact base...head diff, all call sites of the root/path helpers within the driver, the storage architecture and attachments guidance, and the repository's review and CI scope rules.

## Security analysis

- The new helper obtains `realpath` of the configured storage root once per object operation. The candidate and the comparison root are then both canonical paths. This fixes the parent-alias mismatch (for example `/var` resolving to `/private/var`) without dropping lexical key validation, containment comparison, or the file/directory symlink escape checks.
- Both upload entry points verify their signed key-scoped token before path work, then check the destination directory before and after creation. Their temporary-file `O_EXCL`/`O_NOFOLLOW` write and atomic publish behavior is unchanged. Reads, size/header reads, attachment finalization (old and new paths), and deletion use the same canonical root. The final file's real path is checked before reads/deletion; a planted symlink under the root that points outside remains rejected.
- Canonicalizing the root once and using its returned absolute path throughout the operation means changing the configured alias afterward does not redirect that operation. An actor able to replace the configured root or mutate the storage volume concurrently can still cause race conditions between the existing checks and filesystem calls. This was a documented pre-existing trust/TOCTOU limit; HTTP uploads create regular files and do not grant the ability to make symlinks. No new remote path to cross the storage boundary was found.
- With an initialized root, missing object behavior remains `StorageNotFoundError` on read and no-op on delete (covered by the focused test). If the entire root is absent at object-operation time, the new `realpath` fails with raw `ENOENT` for read/delete; I reproduced this. Startup/configuration initializes and checks the root. Failing loudly if an initialized storage volume disappears is appropriate and does not widen access.

## Checks actually run and evidence

- `git diff --check c891e9b...477b9b...` — clean; worktree and live PR head both resolved to `477b9b645dc88e78dc12563d42df77ce788fb763` during review.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/storage/filesystem.test.ts` — **1 file, 19 tests passed**. The new test writes, reads, and deletes through a parent symlink alias and rejects a planted outward symlink. Existing tests exercise traversal keys, forged/expired tokens, and write/read/delete escapes.
- Ad hoc `tsx` probe with a deliberately absent configured root — read and delete each rejected with `Error ENOENT`; no silent success. The first attempt to run this probe failed at compilation because `tsx -e` emitted CJS and disallowed top-level `await`; wrapping it in an async function produced the stated result.
- The independent Luna reviewer ran the focused **1 file/19 tests** and full API unit **66 files/530 tests**, both passing. I inspected that report but did not rerun the full suite. The author reported Docker build/boot/readiness, focused storage and HTTP upload tests; I did not repeat those checks. Exact-head hosted CI was still running when I inspected it, and the PR-template/security-review check was red pending review metadata.

## Residuals and merge status

The existing TOCTOU limitation for a local actor already able to mutate the storage volume remains. The configured root/alias is operator-trusted configuration; if an untrusted local actor can replace it between requests, storage can be redirected within the API process's filesystem permissions. This is outside the remote upload capability and is not introduced as an exploitable HTTP bypass by this patch.

This review clears the security-review tier only. The orchestrator must bind the committed note to this exact reviewed head, fill the PR review metadata, and obtain green required checks at the candidate head before merge. I made no source edits, commit, push, or merge.


## Ordinary review record

Fresh independent GPT-6 Luna `/root/p0_535_luna_storage` cleared the same exact source head. Focused filesystem tests: 1 file/19 tests; full API unit suite: 66 files/530 tests. No source edits by the reviewer. This follow-on commit only records the review note.
