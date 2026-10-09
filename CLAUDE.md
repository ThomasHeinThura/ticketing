# CLAUDE.md — provider adapter

This file holds **provider-specific invocation and tooling notes only**. It adds no policy and
cannot override any. Policy is [`AGENTS.md`](AGENTS.md); the execution procedure is
[`agent-workflow.md`](docs/04-engineering/agent-workflow.md); what is authorized now is the
[active mission](docs/07-planning/active-mission.md).

The filename is kept because Claude Code loads `CLAUDE.md` automatically and existing links,
`CODEOWNERS` and CI messages point at it. OpenAI Codex and other GPT agents load `AGENTS.md`
natively and need nothing here beyond the GPT section below.

Which model fills which role is policy, defined once in
[agent-workflow.md § Model policy](docs/04-engineering/agent-workflow.md#model-policy).
Startup order is in [AGENTS.md § Read in this order](AGENTS.md#read-in-this-order); read the
accepted version on `main`.

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

- A Claude session fills whichever role the model policy and the active mission give it, one
  role per context per change. Record the model as the platform reports it (for example
  `Claude Opus 5.5 (claude-opus-5-5)`); never record it as a GPT model.
- Subagents started with the Agent tool without forking get a fresh context and can serve as
  independent reviewers of work the parent authored. A forked subagent inherits the parent's
  context and cannot. Record the agent ID and parent session as provenance.
- Publish a reviewer's report from its own final message without editing it. Extracting it
  mechanically from the subagent transcript keeps the bytes exact; do not publish other
  transcript content, and redact secrets only as a labelled, separately reviewed correction.
- Prefer the dedicated worktree and file tools; keep scratch output in the session
  scratchpad, never in the repository.
- End commit messages and PR descriptions with the attribution lines the harness supplies.
