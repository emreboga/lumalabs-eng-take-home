import 'dotenv/config';
import WebSocket from 'ws';
import type { AgentInboundMessage, AgentOutboundMessage } from '@runafk/shared';

const RELAY_WS_URL = process.env.RELAY_WS_URL;
const AGENT_TOKEN = process.env.AGENT_TOKEN;

if (!RELAY_WS_URL || !AGENT_TOKEN) {
  console.error('[agent] Missing RELAY_WS_URL or AGENT_TOKEN');
  process.exit(1);
}

const RECONNECT_DELAY_MS = 5000;

function connect(): void {
  console.log(`[agent] connecting to ${RELAY_WS_URL}...`);

  const ws = new WebSocket(RELAY_WS_URL as string, {
    headers: { Authorization: `Bearer ${AGENT_TOKEN}` },
  });

  ws.on('open', () => {
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

    if (msg.type === 'task') {
      console.log(`[agent] task received from ${msg.slackUserId}: "${msg.text}"`);

      // Checkpoint 2: stub response — full implementation handles real tasks here
      const response: AgentOutboundMessage = {
        type: 'response',
        text: `[agent stub] received: "${msg.text}"`,
      };
      ws.send(JSON.stringify(response));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[agent] disconnected (${code}: ${reason.toString() || 'no reason'}). Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on('error', (err) => {
    console.error('[agent] error:', err.message);
  });
}

connect();
