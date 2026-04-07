import type { BlockAction, ButtonAction } from '@slack/bolt';
import { boltApp, postToDM } from './slack';
import { forwardToAgent, isAgentOnline, getPendingPlan, removePendingPlan, registerPendingTask } from './ws-server';
import { createTask } from './db';

boltApp.action<BlockAction<ButtonAction>>('approve_plan', async ({ action, ack, body }) => {
  await ack();
  const userId = body.user.id;
  const planTaskId = action.value ?? '';

  const plan = getPendingPlan(planTaskId);
  if (!plan) {
    await postToDM(userId, 'Plan not found — it may have expired.');
    return;
  }

  if (!isAgentOnline(userId)) {
    await postToDM(userId, 'Agent is offline.');
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
    await postToDM(userId, 'Agent is offline.');
    return;
  }

  removePendingPlan(planTaskId);
  registerPendingTask(taskId, { slackUserId: userId, type: 'post_plan', issueNumber: plan.issueNumber, dbTaskId });
  await postToDM(userId, `Plan approved. Posting to GitHub issue #${plan.issueNumber}...`);
});

boltApp.action<BlockAction<ButtonAction>>('reject_plan', async ({ action, ack, body }) => {
  await ack();
  removePendingPlan(action.value ?? '');
  await postToDM(body.user.id, 'Plan rejected.');
});
