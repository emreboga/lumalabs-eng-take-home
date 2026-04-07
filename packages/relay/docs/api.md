# RunAFK Relay — Integration Reference

## Overview

The **relay** is the central hub of RunAFK. It:

- Receives commands from Slack (slash commands, button clicks)
- Maintains task state in PostgreSQL
- Forwards work to a connected **agent** process over WebSocket
- Delivers async updates back to the user via Slack DMs

```
Slack user
    │  slash commands / button clicks
    ▼
┌─────────────────────────────┐
│           Relay             │
│  Express + Slack Bolt       │
│  WebSocket server (/agent)  │
│  PostgreSQL (tasks, agents) │
└────────────┬────────────────┘
             │  JSON over WebSocket
             ▼
          Agent process
          (Claude Code + GitHub)
```

The relay is **Slack-native**: all user interactions happen through Slack commands and DMs. The OpenAPI spec (`../openapi.yaml`) documents the HTTP surface.

---

## Authentication & Registration

### Token model

Every user has a **secret token** that serves two purposes:

1. **Identifies the user** inside the relay — the relay maps `SHA-256(token) → slack_user_id` in the `agents` table.
2. **Authenticates the agent process** — the agent sends the token as a Bearer token when connecting via WebSocket.

Both the Slack client and the agent process share the same token for the same user.

### Registering a token

```
/register <token>
```

Run this slash command in any DM or channel where the RunAFK bot is present. The relay hashes the token and stores it against your Slack user ID.

- The token is a free-form secret string you generate (e.g., `openssl rand -hex 32`).
- Re-running `/register` with a new token replaces the old one.
- The ephemeral response confirms registration:
  > Agent token registered. Start your agent and it will connect automatically.

---

## Slack Slash Commands

All commands are synchronous to Slack (respond within 3 s) but **results arrive asynchronously** via DM.

### `/list`

Lists GitHub issues assigned to you in the configured repository.

**Arguments:** none

**Behavior:**
- Forwards a `list` task to the agent.
- Result delivered as a plain DM (plain text, no style).

**Error cases:**

| Condition | Ephemeral response |
|---|---|
| Agent offline | `Agent is offline.` |

---

### `/plan <issue-number>`

Generates an implementation plan for a GitHub issue using Claude Code (read-only analysis).

**Arguments:** `<issue-number>` — numeric issue ID, optionally prefixed with `#` (e.g., `42` or `#42`)

**Behavior:**
- Forwards a `plan` task to the agent.
- The agent clones the repo, runs Claude Code with read-only tools, and produces a plan.
- Result delivered as a DM with the plan text and **Approve / Reject** buttons (see [Plan Approval](#plan-approval)).

**Error cases:**

| Condition | Ephemeral response |
|---|---|
| No argument or non-numeric | `Usage: /plan <issue-number>` |
| Agent offline | `Agent is offline.` |
| Already planning this issue | `Already planning issue #<N>.` |

---

### `/implement <issue-number>`

Implements a GitHub issue end-to-end: writes code, runs tests, and opens a pull request.

**Arguments:** `<issue-number>` — same format as `/plan`

**Behavior:**
- Forwards an `implement` task to the agent.
- The agent clones the repo, creates a feature branch (`runafk/issue-<N>`), runs Claude Code with write tools, commits, pushes, and opens a PR.
- Progress delivered via checkpoint DMs throughout (see [Checkpoint DMs](#checkpoint-dms)).
- Final result delivered as a success DM (green) with the PR URL, or an error DM (red).

**Error cases:**

| Condition | Ephemeral response |
|---|---|
| No argument or non-numeric | `Usage: /implement <issue-number>` |
| Agent offline | `Agent is offline.` |
| Already implementing this issue | `Already working on issue #<N>.` |

---

### `/cancel`

Aborts the currently running task.

**Arguments:** none

**Behavior:**
- Marks all active tasks for the user as `cancelled` in the database.
- Sends a `cancel` message to the agent, which kills the Claude Code subprocess.

**Error cases:**

| Condition | Ephemeral response |
|---|---|
| Agent offline | `Agent is offline.` |
| No active task | `No active task to cancel.` |

---

## Plan Approval

After `/plan` completes, the relay sends a DM containing:
- The full plan text (truncated to 2800 characters if longer)
- An **Approve** button (action_id: `approve_plan`)
- A **Reject** button (action_id: `reject_plan`)

### Approving

Clicking **Approve**:
1. Disables both buttons and shows `✅ Approved` in the message.
2. Creates a `post_plan` task that instructs the agent to post the plan as a comment on the GitHub issue (with marker `<!-- runafk-approved-plan -->`).
3. DM confirmation: `Plan approved. Posting to GitHub issue #<N>...` (blue)

The approved plan comment is later retrieved by `/implement` so Claude Code has context.

### Rejecting

Clicking **Reject**:
1. Disables both buttons and shows `❌ Rejected`.
2. Discards the plan from the relay's memory.
3. DM: `Plan rejected.` (red)

---

## DM Notification Reference

The relay sends DMs to the Slack user as tasks progress. All styled messages are sent as Slack **attachments** with a colored sidebar.

### Checkpoint DMs

Sent as each stage of a task completes.

| `status` | Color | Emoji | Typical text |
|---|---|---|---|
| `started` | Blue `#4A9EE0` | ⏳ | Agent started… |
| `code_completed` | Blue `#4A9EE0` | 💻 | Code changes complete |
| `testing` | Amber `#F0A500` | 🧪 | Running tests… |
| `tests_passed` | Green `#36A64F` | ✅ | All tests passed |
| `pr_opened` | Green `#36A64F` | 🚀 | PR opened: https://github.com/… |
| `error` | Red `#D40E0D` | ❌ | Error message |

### Final result DMs

| Style | Color | When sent |
|---|---|---|
| `success` | Green `#36A64F` | `implement` completed successfully |
| `error` | Red `#D40E0D` | Any task fails (`error: true` in result) |
| `info` | Blue `#4A9EE0` | `post_plan` completed; `/list` result |
| plain | — | `/list` result text |

### Markdown conversion

Plan text is converted from Markdown to Slack mrkdwn before display:

| Markdown | Slack mrkdwn |
|---|---|
| `**bold**` | `*bold*` |
| `# Heading` | `*Heading*` |
| `---` | _(removed)_ |
| `[text](url)` | `<url\|text>` |

---

## Agent WebSocket Protocol

Agents connect to the relay at:

```
ws://<relay-host>/agent
```

### Connection

Include a `Authorization: Bearer <token>` header. The relay:
1. Hashes the token with SHA-256 and looks it up in the `agents` table.
2. On success, sends a confirmation and registers the connection.
3. On failure, closes with code **4001** (`Invalid token — run /register <token> in Slack first`).

If the user already has an open connection, the old socket is closed with code **4000** (`Superseded by new connection`) before the new one is registered.

**Confirmation message (Relay → Agent):**
```json
{
  "type": "connected",
  "message": "runafk-relay: agent registered"
}
```

---

### Relay → Agent messages

All messages are JSON-encoded strings.

#### `list`
```json
{
  "type": "list",
  "taskId": "17",
  "slackUserId": "U0123456789"
}
```

#### `plan`
```json
{
  "type": "plan",
  "taskId": "18",
  "slackUserId": "U0123456789",
  "issueNumber": 42
}
```

#### `post_plan`
```json
{
  "type": "post_plan",
  "taskId": "19",
  "slackUserId": "U0123456789",
  "issueNumber": 42,
  "planText": "## Plan\n\n1. ..."
}
```

#### `implement`
```json
{
  "type": "implement",
  "taskId": "20",
  "slackUserId": "U0123456789",
  "issueNumber": 42
}
```

#### `cancel`
```json
{
  "type": "cancel",
  "taskId": "",
  "slackUserId": "U0123456789"
}
```

---

### Agent → Relay messages

#### `checkpoint` — progress update

Send at each meaningful stage. The relay updates the task status in the database and forwards the message to the user as a DM.

```json
{
  "type": "checkpoint",
  "taskId": "20",
  "status": "testing",
  "text": "Running npm test..."
}
```

`status` values: `started` | `code_completed` | `testing` | `tests_passed` | `pr_opened` | `error`

#### `result` — final outcome

Send exactly once when the task is complete (success or failure).

```json
{
  "type": "result",
  "taskId": "20",
  "text": "PR opened: https://github.com/owner/repo/pull/7",
  "error": false
}
```

- `text` — shown to the user in Slack (plan markdown, issue list, PR URL, or error message)
- `error` — when `true`, the relay marks the task `failed` and sends a red DM; otherwise `completed` and the style depends on task type

---

### Task lifecycle

```
pending ──► in_progress ──► completed
                       └──► failed
                       └──► cancelled   (via /cancel)
```

The relay sets `in_progress` when the message is forwarded to the agent. The agent does **not** change the status directly; it signals completion via a `result` message.

---

### Task deduplication

The relay rejects a new task if an active task (`pending` or `in_progress`) already exists for the same user with the same `type` and `issueNumber`. The user sees an ephemeral error in Slack. An agent should not assume it will always receive a task after a command is issued.

---

## End-to-End Flow Examples

### Plan flow

```
User                    Slack           Relay                Agent            GitHub
 │                        │               │                    │                │
 │──/plan 42─────────────►│               │                    │                │
 │                        │──POST /slack/events──────────────► │                │
 │                        │               │                    │                │
 │                        │               │──WS: plan task────►│                │
 │                        │               │                    │──clone repo────►│
 │                        │               │                    │◄───────────────│
 │                        │               │◄──checkpoint:started│                │
 │◄── ⏳ DM ─────────────│               │                    │                │
 │                        │               │◄──checkpoint:code_completed         │
 │◄── 💻 DM ─────────────│               │                    │                │
 │                        │               │◄──result (plan text)│               │
 │◄── Plan DM + buttons ──│               │                    │                │
 │                        │               │                    │                │
 │──[Approve]────────────►│               │                    │                │
 │                        │──POST /slack/events──────────────► │                │
 │                        │               │──WS: post_plan────►│                │
 │                        │               │                    │──post comment──►│
 │                        │               │◄──result (success) │                │
 │◄── ✅ DM ─────────────│               │                    │                │
```

### Implement flow

```
User                    Slack           Relay                Agent            GitHub
 │                        │               │                    │                │
 │──/implement 42────────►│               │                    │                │
 │                        │──POST /slack/events──────────────► │                │
 │                        │               │──WS: implement────►│                │
 │                        │               │◄──checkpoint:started│                │
 │◄── ⏳ DM ─────────────│               │                    │                │
 │                        │               │◄──checkpoint:code_completed         │
 │◄── 💻 DM ─────────────│               │                    │                │
 │                        │               │◄──checkpoint:testing│               │
 │◄── 🧪 DM ─────────────│               │                    │                │
 │                        │               │◄──checkpoint:tests_passed           │
 │◄── ✅ DM ─────────────│               │                    │                │
 │                        │               │◄──checkpoint:pr_opened              │
 │◄── 🚀 DM ─────────────│               │                    │                │
 │                        │               │◄──result (PR URL)  │                │
 │◄── 🟢 PR DM ──────────│               │                    │                │
```

---

## Setup Checklist

### Environment variables

**Relay** (`packages/relay/.env`):

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (SSL required) |
| `PORT` | HTTP/WebSocket listen port (default: `3000`) |
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Used to verify inbound Slack requests |

**Agent** (`packages/agent/.env`):

| Variable | Description |
|---|---|
| `RELAY_WS_URL` | WebSocket URL of the relay (e.g., `ws://relay:3000/agent`) |
| `AGENT_TOKEN` | Bearer token — must match what was registered via `/register` |
| `GITHUB_TOKEN` | GitHub personal access token (repo + PR scopes) |
| `AGENT_REPO` | Repository to work on in `owner/repo` format |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code |

### Slack app configuration

1. **Create a Slack app** at https://api.slack.com/apps

2. **OAuth scopes** (Bot Token):
   - `chat:write` — send DMs and messages
   - `commands` — receive slash commands
   - `im:write` — open DM channels

3. **Slash commands** — set Request URL to `https://<relay-host>/slack/events`:

   | Command | Description |
   |---|---|
   | `/register` | Register agent token |
   | `/list` | List assigned issues |
   | `/plan` | Generate implementation plan |
   | `/implement` | Implement issue and open PR |
   | `/cancel` | Cancel current task |

4. **Interactivity & Shortcuts** — enable and set Request URL to `https://<relay-host>/slack/events`

5. Install the app to your workspace and copy the bot token and signing secret into the relay's `.env`.
