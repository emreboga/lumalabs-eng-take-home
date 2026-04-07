# Approach

## What I built and why

I picked problem #2 — coding while away from your desk.

The framing I kept coming back to: the bottleneck isn't the LLM's ability to write code. It's the approval loop. Engineers need to see a plan before they're comfortable letting an agent touch their codebase. That review step is high-leverage, quick, and can happen from anywhere — a phone, a meeting, a commute. The implementation that follows is low-leverage, slow, and doesn't need a human.

RunAFK is built around that insight. You approve a plan from Slack with one tap. The agent does the rest while you move on. When it's done, you have a PR.

**Why Slack**: engineers are already there, it's async-native, and it works on mobile without a special app. The interface requirements are minimal — slash commands in, DMs out.

**Why a local agent, not a hosted one**: your GitHub token and repo access stay on your machine. No third-party service holds credentials. This also sidesteps a trust problem — you're letting an agent push to your repo, and you want to control where it runs.

**Why Claude Code CLI over the Anthropic API directly**: Claude Code already has file tools, git awareness, and multi-step reasoning. Using it as a subprocess means I'm not rebuilding a coding agent; I'm orchestrating one that already works.

---

## Architecture

See README.md for the full breakdown. Short version: relay (Railway) ↔ agent (local Docker) over WSS. The agent connects outbound — no inbound ports or tunnels. Relay owns Slack; agent owns Claude Code and GitHub.

---

## Key decisions

### UX

**Plan approval gate before implementation.** The agent never writes code without an explicit human sign-off. This keeps the human in the loop at the only point that matters — the plan — and removes them from everything else.

**Slack as the only interface.** No web UI, no CLI, no browser tab to leave open. The whole product lives in the tool engineers already have on their phone during a meeting.

**Block Kit buttons for approve/reject.** The plan arrives as a formatted DM with action buttons. No typing, no copy-pasting — one tap to approve. This is the moment that has to feel effortless or the whole product feels like overhead.

**Color-coded checkpoint DMs.** Each stage of implementation fires a distinct DM with a colored sidebar (Slack legacy attachments): yellow for in-progress, green for success, red for failure. You can scan your DMs and know where the agent is without reading the text.

**Ephemeral ack on every command.** Slack gives slash command handlers 3 seconds before showing an error to the user. Every command immediately sends an ephemeral acknowledgment ("Received — your agent is on it") so there's no ambiguity, even when the agent takes a minute to respond.

### Technical

**GIT_ASKPASS over token-in-URL.** Git credential handling is tricky in subprocesses — each `spawnSync` has no shared credential cache, and embedding the token in the clone URL exposes it in process listings and git reflog. GIT_ASKPASS is a temp shell script that reads from an env var; it's written to disk with `0700` permissions and deleted immediately after use.

**Plan stored at approval, not re-fetched at implement.** When the user approves a plan, it's written to the DB immediately and passed directly in the relay→agent message at implement time. The agent never re-reads the GitHub issue after approval. This means a tampered issue body can't influence what gets implemented — the plan the user approved is exactly what the agent acts on. The DB column is cleared after the agent reads it (clear-after-read).

**Prompt injection defense.** Issue titles, bodies, and plan text are wrapped in XML boundary tags (`<issue_content>`, `<plan_content>`) and preceded by an explicit instruction to treat the enclosed content as untrusted external data. Simple, but it addresses the primary threat model for a tool that processes user-supplied GitHub content.

**Self-correcting test failure.** If Claude's first implementation fails the test suite, the agent feeds the failure output back to Claude with a fix prompt, commits any changes, and re-runs the tests. If they still fail, the output is surfaced to the user with a message to retry. One automated fix pass catches the majority of straightforward failures without requiring a human retry.

**SHA-256 token hashing.** Agent tokens are hashed before storage. The relay never holds a raw token — it only stores the hash and compares on registration. Same model as password storage.

---

## What I intentionally left out

**Streaming output.** Claude Code doesn't expose a streaming API. The discrete checkpoints (started / coding / testing / PR opened) cover the wait adequately for v1. Real streaming is the highest-priority v2 item.

**Plan editing in Slack.** The approve step is a binary gate — if the plan needs changes, the user rejects it and runs `/plan` again to get a fresh one. Inline editing adds significant UI complexity (modals, state management) for a flow that already works with a re-plan.

**Multi-repo support.** `AGENT_REPO` is a single env var. The relay→agent protocol already carries task context as JSON; adding a `repo` field is a small change for v2 once the use case is validated.

**Parallel task execution.** One task at a time per user. This is safe, operationally simple, and avoids needing a queue, scheduler, or resource limits for v1.

**Web UI.** Slack is the interface. A dashboard is a v2 concern once there's enough history to make one worth visiting.

---

## What breaks first under pressure

**Relay restart drops unapproved plans.** The `pendingPlans` map is in-memory. The DB recovers in-progress tasks on restart, but a plan that's been generated and sent to Slack but not yet approved is lost. A relay restart mid-approval forces the user to `/plan` again. The 1-hour TTL evicts stale entries, but this is still a real gap.

**Serial agent blocks on long Claude Code runs.** One task at a time per user means a long implementation blocks all subsequent commands. The relay rejects new tasks while one is active, but if the agent crashes with an in-progress task in the DB, that user is stuck until the record is manually cleared or times out.

**No GitHub API retry or backoff.** Octokit calls use the PAT directly. Heavy use — many `/list` or `/plan` calls in quick succession — can hit GitHub's secondary rate limits, and there's no retry logic to recover gracefully.

**Branch collision on retry.** If `runafk/issue-N` already exists on the remote from a prior run, the push fails. The error is descriptive ("delete or merge the existing PR before retrying"), but it requires manual intervention.

---

## What I'd build next

1. **Real-time streaming** — biggest UX gap. Pipe Claude Code stdout through the WebSocket as chunked messages so you can watch the agent work in near-real-time.
2. **PR review loop** — `/review <pr>` reads the PR's review comments and re-invokes the implement flow. Closes the feedback loop without leaving Slack.
3. **Encrypted plan text at rest** — `plan_text` is currently plaintext in PostgreSQL. App-managed key encryption is a straightforward addition.
4. **Multi-repo support** — pass a `repo` override per task; the agent already receives task context as JSON, so the protocol change is minimal.
5. **Web dashboard** — task history, logs, and PR links in a browser UI. Replaces Slack DMs as the audit trail for async work.

---

## Live deployment

- **Relay**: https://runafk-relay-production.up.railway.app
- **Slack workspace**: https://ebgz.slack.com — request an invite to try RunAFK live

---

## Loom walkthrough

[PLACEHOLDER — insert Loom URL here]

Planned coverage:
1. `/list` — browse assigned issues
2. `/plan <issue>` — wait for the plan DM, show Approve/Reject buttons
3. Approve — show the plan posted as a GitHub issue comment
4. `/implement <issue>` — walk through checkpoints live (started → coding → testing → PR opened)
5. Show the resulting PR on GitHub
6. Brief walkthrough of the relay+agent architecture and why the agent runs locally
