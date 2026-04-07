import { App, ExpressReceiver, GenericMessageEvent, LogLevel } from '@slack/bolt';
import type { Application } from 'express';
import { forwardToAgent, isAgentOnline, registerToken, setSlackNotifier } from './ws-server';

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

export const boltApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  logLevel: LogLevel.WARN,
});

/**
 * Returns the Express app so index.ts can attach it to the shared HTTP server.
 * Bolt registers /slack/events (and /slack/actions) on this app automatically.
 */
export function getExpressApp(): Application {
  return receiver.app;
}

receiver.router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'runafk-relay' });
});

/**
 * Post a message to a user's DM channel.
 * Used by ws-server to deliver agent responses back to Slack.
 */
export async function postToDM(slackUserId: string, text: string): Promise<void> {
  await boltApp.client.chat.postMessage({ channel: slackUserId, text });
}

// Register an agent token for the calling user
boltApp.command('/register', async ({ command, ack, respond }) => {
  await ack();
  const token = command.text.trim();
  if (!token) {
    await respond('Usage: `/register <token>`');
    return;
  }
  registerToken(command.user_id, token);
  await respond({ text: 'Agent token registered. Start your agent and it will connect automatically.', response_type: 'ephemeral' });
});

// Handle incoming DMs
boltApp.message(async ({ message, say }) => {
  const msg = message as GenericMessageEvent;
  if (msg.channel_type !== 'im' || !msg.text) return;

  const userId = msg.user;

  // Checkpoint 2: forward to agent if connected
  if (isAgentOnline(userId)) {
    const sent = forwardToAgent(userId, { type: 'task', slackUserId: userId, text: msg.text });
    if (!sent) await say('Agent is offline.');
    return;
  }

  // Checkpoint 1: echo back
  await say(`Echo: ${msg.text}`);
});

export function initSlack(): void {
  setSlackNotifier(postToDM);
  console.log('[slack] Bolt app initialized in HTTP mode');
}
