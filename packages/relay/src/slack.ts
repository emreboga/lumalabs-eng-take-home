import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import type { Application } from 'express';
import { registerToken } from './ws-server';

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
});

export const boltApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  logLevel: LogLevel.WARN,
});

export function getExpressApp(): Application {
  return receiver.app;
}

receiver.router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'runafk-relay' });
});

export async function postToDM(slackUserId: string, text: string): Promise<void> {
  await boltApp.client.chat.postMessage({ channel: slackUserId, text });
}

export async function postPlanWithButtons(
  slackUserId: string,
  taskId: string,
  issueNumber: number,
  planText: string,
): Promise<void> {
  const truncated = planText.length > 2800 ? planText.slice(0, 2800) + '\n...(truncated)' : planText;
  await boltApp.client.chat.postMessage({
    channel: slackUserId,
    text: `Plan for issue #${issueNumber}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Plan for issue #${issueNumber}:*\n\n${truncated}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Approve' },
            style: 'primary',
            action_id: 'approve_plan',
            value: taskId,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Reject' },
            style: 'danger',
            action_id: 'reject_plan',
            value: taskId,
          },
        ],
      },
    ],
  });
}

boltApp.command('/register', async ({ command, ack, respond }) => {
  await ack();
  const token = command.text.trim();
  if (!token) {
    await respond('Usage: `/register <token>`');
    return;
  }
  await registerToken(command.user_id, token);
  await respond({
    text: 'Agent token registered. Start your agent and it will connect automatically.',
    response_type: 'ephemeral',
  });
});

export function initSlack(): void {
  console.log('[slack] Bolt app initialized in HTTP mode');
}
