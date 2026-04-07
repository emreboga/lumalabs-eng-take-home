import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import crypto from 'crypto';
import type { AgentToRelayMessage, RelayToAgentMessage } from '@runafk/shared';
import { registerAgent, resolveAgent, updateTask } from './db';

// ─── Agent connections ────────────────────────────────────────────────────────

const agentsByUser = new Map<string, WebSocket>();

// ─── Pending task registry (in-memory, short-lived) ──────────────────────────

export interface PendingTask {
  slackUserId: string;
  type: 'list' | 'plan' | 'post_plan' | 'implement';
  issueNumber?: number;
  dbTaskId: number;
}

const pendingTasks = new Map<string, PendingTask>(); // taskId → task

export function registerPendingTask(taskId: string, task: PendingTask): void {
  pendingTasks.set(taskId, task);
}

// ─── Pending plan registry (survives after plan result is received) ───────────

export interface PendingPlan {
  slackUserId: string;
  issueNumber: number;
  planText: string;
}

const pendingPlans = new Map<string, PendingPlan>(); // taskId → plan

export function storePendingPlan(taskId: string, plan: PendingPlan): void {
  pendingPlans.set(taskId, plan);
}

export function getPendingPlan(taskId: string): PendingPlan | undefined {
  return pendingPlans.get(taskId);
}

export function removePendingPlan(taskId: string): void {
  pendingPlans.delete(taskId);
}

// ─── Slack notifier callbacks ─────────────────────────────────────────────────

type TextNotifier = (slackUserId: string, text: string) => Promise<void>;
type PlanNotifier = (slackUserId: string, taskId: string, issueNumber: number, planText: string) => Promise<void>;

let textNotifier: TextNotifier | null = null;
let planNotifier: PlanNotifier | null = null;

export function setTextNotifier(fn: TextNotifier): void {
  textNotifier = fn;
}

export function setPlanNotifier(fn: PlanNotifier): void {
  planNotifier = fn;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function registerToken(slackUserId: string, token: string): Promise<void> {
  await registerAgent(slackUserId, hashToken(token));
  console.log(`[ws] token registered for user ${slackUserId}`);
}

// ─── WebSocket server ─────────────────────────────────────────────────────────

export function createAgentServer(httpServer: Server): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/agent' });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const auth = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) {
      ws.close(4001, 'Missing authorization header');
      return;
    }

    const tokenHash = hashToken(auth.slice(7));
    const slackUserId = await resolveAgent(tokenHash);
    if (!slackUserId) {
      ws.close(4001, 'Invalid token — run /register <token> in Slack first');
      return;
    }

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
        const task = pendingTasks.get(msg.taskId);

        if (msg.type === 'checkpoint') {
          if (task) await updateTask(task.dbTaskId, { status: msg.status });
          if (textNotifier) await textNotifier(slackUserId, msg.text);
          return;
        }

        // result
        if (!task) {
          console.error(`[ws] received result for unknown taskId ${msg.taskId}`);
          return;
        }

        pendingTasks.delete(msg.taskId);
        await updateTask(task.dbTaskId, { status: 'completed' });

        if (task.type === 'plan' && planNotifier) {
          storePendingPlan(msg.taskId, {
            slackUserId,
            issueNumber: task.issueNumber!,
            planText: msg.text,
          });
          await planNotifier(slackUserId, msg.taskId, task.issueNumber!, msg.text);
        } else if (textNotifier) {
          await textNotifier(slackUserId, msg.text);
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
