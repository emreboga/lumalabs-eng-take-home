import type { BlockAction, ButtonAction } from '@slack/bolt';
import { boltApp, postToDM } from './slack';
import { forwardToAgent, isAgentOnline, getPendingPlan, removePendingPlan, registerPendingTask } from './ws-server';
import { createTask } from './db';

async function disableButtons(
  body: BlockAction,
  label: string,
): Promise<void> {
  // blocks live inside the attachment (colored sidebar); fall back to top-level for safety
  const attachment = (body.message as any)?.attachments?.[0];
  const sectionBlock = attachment?.blocks?.[0] ?? body.message!.blocks?.[0];

  await boltApp.client.chat.update({
    channel: body.channel!.id,
    ts: body.message!.ts,
    text: body.message!.text ?? '',
    attachments: [
      {
        color: attachment?.color ?? '#4A9EE0',
        blocks: [
          sectionBlock,
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: label }],
          },
        ],
      },
    ],
  });
}

boltApp.action<BlockAction<ButtonAction>>('approve_plan', async ({ action, ack, body }) => {
  await ack();
  await disableButtons(body, '✅ *Approved*');

  const userId = body.user.id;
  const planTaskId = action.value ?? '';

  const plan = getPendingPlan(planTaskId);
  if (!plan) {
    await postToDM(userId, 'Plan not found — it may have expired.', 'error');
    return;
  }

  if (!isAgentOnline(userId)) {
    await postToDM(userId, 'Agent is offline.', 'error');
    return;
  }

  const dbTaskId = await createTask(userId, 'post_plan', plan.issueNumber);
  const taskId = String(dbTaskId);
  const sent = forwardToAgent(userId, {
    type: 'post_plan',
    taskId,
    slackUserId: userId,
    issueNumber: plan.issueNumber,
    planText: plan.planText,
  });

  if (!sent) {
    await postToDM(userId, 'Agent is offline.', 'error');
    return;
  }

  removePendingPlan(planTaskId);
  registerPendingTask(taskId, { slackUserId: userId, type: 'post_plan', issueNumber: plan.issueNumber, dbTaskId });
});

boltApp.action<BlockAction<ButtonAction>>('reject_plan', async ({ action, ack, body }) => {
  await ack();
  await disableButtons(body, '❌ *Rejected*');
  removePendingPlan(action.value ?? '');
  await postToDM(body.user.id, 'Plan rejected.', 'error');
});
