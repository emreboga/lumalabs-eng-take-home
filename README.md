# RunAFK

RunAFK is a Slack bot that acts as your autonomous coding agent. Point it at a GitHub issue, approve its plan, and it writes the code, runs the tests, and opens a pull request — all while you're away from your desk.

## How it works

RunAFK has three packages: `shared` (types), `relay` (the Slack-facing server hosted on Railway), and `agent` (the Claude Code runner you run locally via Docker).

```
Slack → Relay → Agent → Claude Code → GitHub → PR → Relay → Slack
```

Your agent connects outbound to the relay over WSS, authenticated with a bearer token. The relay handles all Slack communication (slash commands, Block Kit approval buttons, DM notifications). When you invoke a command, the relay forwards it to your agent, which spawns Claude Code, interacts with GitHub, and streams status checkpoints back to your DM.

- **Relay**: runs on Railway with a PostgreSQL database for task history and token registry
- **Agent**: runs locally in a Docker container; uses your GitHub PAT for clone/push and Octokit for API calls

## Usage

### 1. Browse your issues

```
/list
```

Shows all open GitHub issues assigned to you in your configured repo.

### 2. Generate a plan

```
/plan <issue-number>
```

Claude reads your codebase and produces a detailed, step-by-step implementation plan. It arrives in your DM with **Approve** and **Reject** buttons.

### 3. Approve the plan

Click **Approve**. RunAFK posts the plan as a comment on the GitHub issue so it's visible to your team.

### 4. Implement

```
/implement <issue-number>
```

Claude writes the code, runs your test suite, and attempts to self-correct if tests fail. Once tests pass, it commits, pushes to a new branch (`runafk/issue-N`), and opens a pull request.

### 5. Track progress

Color-coded status messages appear in your DM at each stage: planning → coding → testing → PR opened.

### 6. Cancel anytime

```
/cancel
```

Aborts the running task immediately.

## Slash commands

| Command | Description |
|---|---|
| `/register <token>` | Connect your local agent to your Slack account |
| `/plan <issue>` | Generate an implementation plan for a GitHub issue |
| `/implement <issue>` | Implement an approved plan and open a PR |
| `/cancel` | Cancel the current running task |
| `/list` | List your open GitHub issues |
| `/help` | Show all commands |

## Setup

### 1. Install the Slack app

RunAFK is not published to the Slack App Directory — it is currently only available in the author's workspace (`ebgz.slack.com`). Request an invite to that workspace to use it.

### 2. Configure and run the agent

Copy `packages/agent/.env.example` to `packages/agent/.env` and fill in the values (see table below).

Register your token in Slack **before** starting the agent — the relay will reject connections from unregistered tokens:

```
/register <your-AGENT_TOKEN>
```

Then start the agent:

```bash
npm run agent
```

This pulls the latest image from Docker Hub and starts the container.

## Agent configuration

Set these in `packages/agent/.env`:

| Variable | Description |
|---|---|
| `RELAY_WS_URL` | WebSocket URL of the relay (e.g. `wss://your-relay.railway.app/agent`) |
| `AGENT_TOKEN` | Secret token you choose; register it in Slack with `/register` |
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope (for clone, push, PR creation, and issue reads) |
| `AGENT_REPO` | Target repository in `owner/repo` format |
| `ANTHROPIC_API_KEY` | Anthropic API key (used by Claude Code CLI) |

## V1 tradeoffs

- **Single agent per user**: each developer runs one Docker container; no parallelism across issues
- **In-memory pending state**: unapproved plans live in relay memory — a relay restart before approval drops them (DB fallback recovers in-progress tasks but not yet-approved plans)
- **Plan is approve/reject only**: no inline editing in Slack before posting to GitHub
- **No streaming**: Claude Code output is buffered; you see nothing until a checkpoint fires (started → coding → testing → PR opened)
- **One repo per agent**: `AGENT_REPO` is a single env var; switching repos requires restarting with a different value
- **Test detection is heuristic**: looks for `package.json` scripts, `pytest.ini`, and `Makefile`; may miss custom setups
- **No branch conflict handling**: if `runafk/issue-N` already exists, push fails

## V2 improvements

- **Streaming progress**: pipe Claude Code output to Slack in real time via chunked checkpoints
- **Plan editing**: inline text editing in Slack before approving (modal or threaded reply)
- **Multi-repo support**: agent accepts repo override per task
- **Encrypted plan text at rest**: encrypt the `plan_text` DB column (currently plaintext)
- **PR review loop**: `/review <pr>` command — agent reads review comments and re-implements
- **Web dashboard**: task history, logs, and PR links in a browser UI
- **Parallel tasks**: multiple concurrent Claude Code runs with resource limits
