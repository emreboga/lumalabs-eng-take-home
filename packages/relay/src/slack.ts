import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
import type { Application } from 'express';
import type { CheckpointStatus } from '@runafk/shared';
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

// ─── Styled message helpers ───────────────────────────────────────────────────

const STYLE_COLOR: Record<'info' | 'success' | 'error', string> = {
  info:    '#4A9EE0',
  success: '#36A64F',
  error:   '#D40E0D',
};

const CHECKPOINT_STYLE: Record<CheckpointStatus, { color: string; emoji: string }> = {
  started:        { color: '#4A9EE0', emoji: '⏳' },
  code_completed: { color: '#4A9EE0', emoji: '💻' },
  testing:        { color: '#F0A500', emoji: '🧪' },
  tests_passed:   { color: '#36A64F', emoji: '✅' },
  pr_opened:      { color: '#36A64F', emoji: '🚀' },
  error:          { color: '#D40E0D', emoji: '❌' },
};

async function postAttachmentDM(slackUserId: string, text: string, color: string): Promise<void> {
  await boltApp.client.chat.postMessage({
    channel: slackUserId,
    attachments: [{ color, mrkdwn_in: ['text'], text, fallback: text }],
  });
}

export async function postToDM(
  slackUserId: string,
  text: string,
  style?: 'info' | 'success' | 'error',
): Promise<void> {
  if (style) {
    await postAttachmentDM(slackUserId, text, STYLE_COLOR[style]);
  } else {
    await boltApp.client.chat.postMessage({ channel: slackUserId, text });
  }
}

export async function postCheckpointDM(
  slackUserId: string,
  status: CheckpointStatus,
  text: string,
): Promise<void> {
  const { color, emoji } = CHECKPOINT_STYLE[status] ?? { color: '#4A9EE0', emoji: '•' };
  await postAttachmentDM(slackUserId, `${emoji}  ${text}`, color);
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
    attachments: [
      {
        color: '#4A9EE0',
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
