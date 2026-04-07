# RunAFK

RunAFK is a Slack bot that delegates your GitHub issue backlog to Claude Code. You assign an issue, approve a plan, and the agent clones your repo, writes the code, runs your test suite, and opens a pull request — entirely unattended, while you focus on other things.

## Architecture

RunAFK is an npm workspaces monorepo with three packages:

| Package           | Role                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| `packages/shared` | Shared TypeScript types for the relay↔agent protocol                              |
| `packages/relay`  | Slack-facing server (Bolt SDK, ExpressReceiver, PostgreSQL) — deployed on Railway |
| `packages/agent`  | Claude Code runner — runs locally in Docker, connects outbound to the relay       |

```
Slack → Relay → Agent → Claude Code → GitHub → PR → Relay → Slack
```

The agent initiates the WebSocket connection to the relay (outbound from your network), so no inbound ports or tunnels are required. Each Slack user registers one agent instance.

**Relay** handles all Slack interaction: slash commands, Block Kit approval buttons, and DM notifications. It stores task history and a SHA-256-hashed token registry in PostgreSQL.

**Agent** receives task messages over WSS, spawns Claude Code CLI per task via `claude --print`, interacts with GitHub using Octokit, and streams status checkpoints back through the relay to your DM. The agent reconnects automatically on disconnect with exponential backoff (1 s → 2 s → … → 60 s cap).

### Security design

- **Token auth**: Bearer tokens are SHA-256 hashed before storage; the relay never stores raw tokens.
- **Git credentials**: GitHub PAT is passed to git via `GIT_ASKPASS` (a temp shell script that reads from an env var). The token never appears in a URL, command-line argument, or script file on disk; the script is deleted immediately after use.
- **Prompt injection**: Issue titles, bodies, and plan text are wrapped in XML boundary tags and preceded by an explicit instruction to treat the content as untrusted external data. Claude is instructed not to follow any instructions inside those tags.
- **Plan integrity**: Plans are stored in the DB at approval time and passed directly in the relay→agent message. The agent never re-fetches the plan from GitHub after approval, so a tampered issue body cannot influence the implementation.
- **Error sanitization**: Only the first line (≤200 chars) of internal errors is surfaced to Slack, preventing stack traces or file paths from leaking.

## Usage

### 1. Browse your issues

```
/list
```

Shows open GitHub issues assigned to you in your configured repo.

### 2. Generate a plan

```
/plan <issue-number>
```

The agent clones your repo and asks Claude to produce a detailed implementation plan. The plan arrives in your DM with **Approve** and **Reject** buttons.

### 3. Approve the plan

Click **Approve**. RunAFK posts the plan as a comment on the GitHub issue for team visibility.

### 4. Implement

```
/implement <issue-number>
```

The agent:

1. Clones the repo and creates a `runafk/issue-N` branch
2. Runs Claude Code with the issue + approved plan as context
3. Stages and commits all changes
4. Runs your test suite; if tests fail, asks Claude to self-correct and re-runs
5. Pushes the branch and opens a PR

### 5. Track progress

Color-coded DM messages fire at each stage: started → coding → testing → PR opened.

### 6. Cancel

```
/cancel
```

Sends an abort signal to the running task. Claude Code is interrupted and the working directory is cleaned up.

## Slash commands

| Command              | Description                                        |
| -------------------- | -------------------------------------------------- |
| `/register <token>`  | Connect your local agent to your Slack account     |
| `/plan <issue>`      | Generate an implementation plan for a GitHub issue |
| `/implement <issue>` | Implement an approved plan and open a PR           |
| `/cancel`            | Cancel the current running task                    |
| `/list`              | List your open GitHub issues                       |
| `/help`              | Show all commands                                  |

## Setup

### 1. Install the Slack app

RunAFK is not published to the Slack App Directory. Publishing requires a formal Slack review process (security questionnaire, privacy policy, support contact, etc.) that is out of scope for a v1 tool used within a single workspace. It is currently only available in the author's workspace (`ebgz.slack.com`). Request an invite to that workspace to use it.

### 2. Configure and run the agent

Copy `packages/agent/.env.example` to `packages/agent/.env` and fill in the values (see table below).

Register your token in Slack **before** starting the agent — the relay will reject connections from unregistered tokens:

```
/register <your-AGENT_TOKEN>
```

Then start the agent:

```bash
npm run agent   # pulls the latest image from Docker Hub and starts the container
```

## Agent configuration

| Variable            | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| `RELAY_WS_URL`      | WebSocket URL of the relay (e.g. `wss://your-relay.railway.app/agent`) |
| `AGENT_TOKEN`       | Secret token you choose; register it in Slack with `/register`         |
| `GITHUB_TOKEN`      | GitHub PAT with `repo` scope (clone, push, PR creation, issue reads)   |
| `AGENT_REPO`        | Target repository in `owner/repo` format                               |
| `ANTHROPIC_API_KEY` | Anthropic API key (used by Claude Code CLI)                            |

See `packages/agent/.env.example` for inline documentation on each variable.

## V1 design decisions

These are intentional scoping choices, not oversights.

- **Single agent per user** — each developer runs one Docker container. No scheduler, no queue. Simple to operate; parallelism is a v2 concern.
- **In-memory pending plans** — unapproved plans live in relay memory with a 1-hour TTL. A relay restart before approval drops them; the DB recovers in-progress tasks. Avoids over-engineering persistence for short-lived approval state.
- **Approve/reject only** — no inline plan editing in Slack. Keeps the happy path friction-free. Editing is a v2 concern; the plan is already posted to GitHub where it can be discussed.
- **Checkpoint-based progress, not streaming** — Claude Code doesn't expose a streaming output API. Discrete status checkpoints (started / coding / testing / PR opened) cover the wait without requiring protocol changes.
- **One repo per agent** — `AGENT_REPO` is a single env var. Multi-repo is a parameterization problem: the agent already receives task context as JSON, so adding a `repo` override field is straightforward in v2.
- **Heuristic test detection** — looks for `package.json` scripts (`test:ci`, `test`), `pytest.ini`, and `Makefile` targets. Covers the vast majority of projects; an explicit config override is a v2 concern.
- **No branch reuse** — if `runafk/issue-N` already exists on the remote, the push fails with a descriptive error. Delete or merge the existing PR before retrying.

## V2 roadmap

- **Real-time streaming** — biggest UX win. Pipe Claude Code output to Slack in chunked WebSocket messages so you can watch the agent work line by line.
- **Plan editing** — a Slack modal lets you edit the plan before approving it, reducing back-and-forth on the first pass.
- **Multi-repo support** — pass a `repo` override per task; the agent already receives task context as JSON, so the plumbing is minimal.
- **Encrypted plan text at rest** — the `plan_text` DB column is currently plaintext. App-managed key encryption at rest is straightforward to add.
- **PR review loop** — `/review <pr>` reads the PR's review comments and re-invokes the implement flow, closing the feedback loop without leaving Slack.
- **Web dashboard** — task history, logs, and PR links in a browser UI; replaces Slack DMs as the source of truth for async work.
- **Parallel tasks** — multiple concurrent Claude Code processes behind a semaphore, unblocking multi-issue workflows without unbounded resource usage.

## Development

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Build all packages (shared → relay → agent)
npm run build

# Run relay in dev mode (hot reload)
npm run dev:relay

# Run agent in dev mode
npm run dev:agent
```

CI runs `npm test` on every push and pull request. Docker images for `relay` and `agent` are built and pushed to Docker Hub only on pushes to `main`, after tests pass.
