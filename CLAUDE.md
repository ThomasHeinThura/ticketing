# CLAUDE.md — provider adapter

This file holds **provider-specific invocation and tooling notes only**. It adds no policy and
cannot override any. Policy is [`AGENTS.md`](AGENTS.md); the execution procedure is
[`agent-workflow.md`](docs/04-engineering/agent-workflow.md); what is authorized now is the
[active mission](docs/07-planning/active-mission.md).

The filename is kept because Claude Code loads `CLAUDE.md` automatically and existing links,
`CODEOWNERS` and CI messages point at it. OpenAI Codex and other GPT agents load `AGENTS.md`
natively and need nothing here beyond the GPT section below.

Which model fills which review role is policy, defined once in
[agent-workflow.md § Model policy](docs/04-engineering/agent-workflow.md#model-policy).

---

## All providers

- Start every session from live state: `gh pr list --state open`, then
  `gh pr view <n> --json headRefName,headRefOid,mergeable,reviewDecision,statusCheckRollup`
  for anything you will touch. Never act on a SHA or PR list remembered from a previous
  conversation.
- Work in an isolated worktree on your own branch. Never commit, stash or discard someone
  else's uncommitted files in a shared checkout.
- Read large files in ranges. Re-verify any reviewer's or summary's claim against the source
  before acting on it.
- If `node` is not on the default `PATH`, use the host's configured Node or package-local
  binaries.
- `pal-mcp`, `pal-reviewer`, `clink` and 9Router are retired for TaskDesk work, **even when
  the MCP server is still configured on the host**. Do not call their tools.

## OpenAI Codex / GPT agents

- Select the model explicitly when spawning (`gpt-6-luna`, `gpt-6-sol`) and record the spawn
  arguments in the review note as provenance. Do not rely on an inherited or default label.
- An independent reviewer is spawned **without inherited conversation turns** (for example
  `fork_turns=none`). A fork that carries the author's turns is not independent.
- Long-running reviewers write findings incrementally to a file, so an interrupted run still
  leaves evidence.
- Transport reviewer output verbatim into the committed note or PR comment, with its
  provenance line. The transporter does not edit verdicts.

## Claude Code

- A Claude session acts in whatever role its assignment or the active mission gives it
  (for example the sampled auditor, or a policy maintainer Thomas named). It is not the
  reviewer of record for a role the model policy assigns to another model.
- Subagents started with the Agent tool get a fresh context and can serve as independent
  reviewers of work the parent authored. A forked subagent inherits the parent's context and
  cannot.
- Prefer the dedicated worktree and file tools; keep scratch output in the session
  scratchpad, never in the repository.
- End commit messages and PR descriptions with the attribution lines the harness supplies.
