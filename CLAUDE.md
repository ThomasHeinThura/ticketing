# CLAUDE.md

Read [AGENTS.md](AGENTS.md) and [`docs/07-planning/status.md`](docs/07-planning/status.md).
That is all the startup there is. The workflow is in
[`docs/04-engineering/workflow.md`](docs/04-engineering/workflow.md).

Claude Code notes:

- Work on your own branch in a worktree. Never touch another session's uncommitted files.
- Check live state with `gh pr list` before acting. Don't trust remembered SHAs.
- An independent reviewer is a fresh Agent-tool subagent with no fork, or another session. A
  forked subagent is not independent.
- Keep scratch output in the session scratchpad, not the repo.
- End commits and PR bodies with the attribution lines the harness supplies.
