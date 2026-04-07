import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import crypto from 'crypto';
import type { AgentToRelayMessage, RelayToAgentMessage } from '@runafk/shared';

// slackUserId → active agent WebSocket
const agentsByUser = new Map<string, WebSocket>();

// tokenHash → slackUserId — populated via /register command
// Checkpoint: in-memory. Full implementation: Postgres.
const tokenRegistry = new Map<string, string>();

type SlackNotifier = (slackUserId: string, text: string) => Promise<void>;
let slackNotifier: SlackNotifier | null = null;

export function setSlackNotifier(fn: SlackNotifier): void {
  slackNotifier = fn;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Register a token for a Slack user (called from /register slash command).
 * Full implementation: persist to Postgres.
 */
export function registerToken(slackUserId: string, token: string): void {
  tokenRegistry.set(hashToken(token), slackUserId);
  console.log(`[ws] token registered for user ${slackUserId}`);
}

export function createAgentServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/agent' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      ws.close(4001, 'Missing authorization header');
      return;
    }

    // Never log the token itself
    const tokenHash = hashToken(auth.slice(7));
    const slackUserId = tokenRegistry.get(tokenHash) ?? null;
    if (!slackUserId) {
      ws.close(4001, 'Invalid token — run /register <token> in Slack first');
      return;
    }

    // Enforce one connection per token
    const existing = agentsByUser.get(slackUserId);
    if (existing?.readyState === WebSocket.OPEN) {
      existing.close(4000, 'Superseded by new connection');
    }

    agentsByUser.set(slackUserId, ws);
    console.log(`[ws] agent connected for user ${slackUserId}`);
    ws.send(JSON.stringify({ type: 'connected', message: 'runafk-relay: agent registered' }));

    ws.on('message', async (raw) => {
      try {
        const msg: AgentToRelayMessage = JSON.parse(raw.toString());
        if (msg.type === 'response' && slackNotifier) {
          await slackNotifier(slackUserId, msg.text);
        }
      } catch {
        console.error('[ws] failed to parse agent message');
      }
    });

    ws.on('close', () => {
      if (agentsByUser.get(slackUserId) === ws) {
        agentsByUser.delete(slackUserId);
        console.log(`[ws] agent disconnected for user ${slackUserId}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`[ws] error for user ${slackUserId}:`, err.message);
    });
  });
}

export function forwardToAgent(slackUserId: string, payload: RelayToAgentMessage): boolean {
  const ws = agentsByUser.get(slackUserId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

export function isAgentOnline(slackUserId: string): boolean {
  const ws = agentsByUser.get(slackUserId);
  return ws?.readyState === WebSocket.OPEN;
}
