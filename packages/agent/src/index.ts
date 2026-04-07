import 'dotenv/config';
import WebSocket from 'ws';
import type { AgentInboundMessage, AgentOutboundMessage, CheckpointStatus } from '@runafk/shared';
import { handleList, handlePlan, handlePostPlan, handleImplement } from './tasks';

const RELAY_WS_URL = process.env.RELAY_WS_URL;
const AGENT_TOKEN = process.env.AGENT_TOKEN;

if (!RELAY_WS_URL || !AGENT_TOKEN) {
  console.error('[agent] Missing RELAY_WS_URL or AGENT_TOKEN');
  process.exit(1);
}

let reconnectDelay = 1_000;
const MAX_RECONNECT_MS = 60_000;

// Track abort controllers by taskId so /cancel can abort the active task
const activeControllers = new Map<string, AbortController>();

function connect(): void {
  console.log(`[agent] connecting to ${RELAY_WS_URL}...`);

  const ws = new WebSocket(RELAY_WS_URL as string, {
    headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
  });

  function send(msg: AgentOutboundMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  ws.on('open', () => {
    reconnectDelay = 1_000;
    console.log('[agent] connection established, awaiting registration...');
  });

  ws.on('message', (raw) => {
    let msg: AgentInboundMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      console.error('[agent] received unparseable message');
      return;
    }

    if (msg.type === 'connected') {
      console.log(`[agent] registered: ${msg.message}`);
      return;
    }

    const { taskId } = msg;
    console.log(`[agent] task received: type=${msg.type} taskId=${taskId}`);

    const sendCheckpoint = (status: CheckpointStatus, text: string) => {
      console.log(`[agent] checkpoint: ${status} — ${text}`);
      send({ type: 'checkpoint', taskId, status, text });
    };

    const sendResult = (text: string) => {
      console.log(`[agent] result for ${taskId}`);
      send({ type: 'result', taskId, text });
    };

    const sendError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      activeControllers.delete(taskId);
      if (message === 'cancelled') {
        console.log(`[agent] task ${taskId} cancelled`);
        send({ type: 'result', taskId, text: 'Task cancelled.' });
        return;
      }
      console.error(`[agent] error on task ${taskId} (${msg.type}):\n${stack ?? message}`);
      send({ type: 'result', taskId, text: `Error: ${message}`, error: true });
    };

    if (msg.type === 'cancel') {
      // Abort whatever task is currently running for this user
      for (const [tid, ctrl] of activeControllers) {
        ctrl.abort();
        activeControllers.delete(tid);
      }
      return;
    }

    const controller = new AbortController();
    activeControllers.set(taskId, controller);
    const { signal } = controller;

    const wrapTask = (p: Promise<void>) =>
      p.then(() => activeControllers.delete(taskId)).catch(sendError);

    switch (msg.type) {
      case 'list':
        wrapTask(handleList(sendResult));
        break;

      case 'plan':
        wrapTask(handlePlan(msg.issueNumber, sendCheckpoint, sendResult, signal));
        break;

      case 'post_plan':
        wrapTask(handlePostPlan(msg.issueNumber, msg.planText, sendResult));
        break;

      case 'implement':
        wrapTask(handleImplement(msg.issueNumber, sendCheckpoint, sendResult, signal));
        break;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[agent] disconnected (${code}: ${reason.toString() || 'no reason'}). Reconnecting in ${reconnectDelay / 1000}s...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS);
  });

  ws.on('error', (err) => {
    console.error('[agent] error:', err.message);
  });
}

connect();
