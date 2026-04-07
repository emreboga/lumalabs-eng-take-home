import { boltApp, postToDM } from './slack';
import { forwardToAgent, isAgentOnline, registerPendingTask } from './ws-server';
import { createTask, updateTask, hasActiveTask, cancelActiveTask, getPlanText } from './db';

function parseIssueNumber(text: string): number | null {
  const n = parseInt(text.trim().replace(/^#/, ''));
  return isNaN(n) ? null : n;
}

function agentOfflineReply(respond: (msg: object) => Promise<void>) {
  return respond({ text: 'Agent is offline.', response_type: 'ephemeral' });
}

boltApp.command('/list', async ({ command, ack, respond }) => {
  await ack();
  if (!isAgentOnline(command.user_id)) {
    await agentOfflineReply(respond);
    return;
  }
  const dbTaskId = await createTask(command.user_id, 'list');
  const taskId = String(dbTaskId);
  const sent = forwardToAgent(command.user_id, {
    type: 'list',
    taskId,
    slackUserId: command.user_id,
  });
  if (!sent) {
    await agentOfflineReply(respond);
    return;
  }
  await updateTask(dbTaskId, { status: 'in_progress' });
  registerPendingTask(taskId, { slackUserId: command.user_id, type: 'list', dbTaskId });
  await postToDM(command.user_id, 'Working on it...', 'info');
});

boltApp.command('/plan', async ({ command, ack, respond }) => {
  await ack();
  const issueNumber = parseIssueNumber(command.text);
  if (!issueNumber) {
    await respond({ text: 'Usage: `/plan <issue-number>`', response_type: 'ephemeral' });
    return;
  }
  if (!isAgentOnline(command.user_id)) {
    await agentOfflineReply(respond);
    return;
  }
  if (await hasActiveTask(command.user_id)) {
    await respond({ text: 'You already have an active task. Use `/cancel` to stop it first.', response_type: 'ephemeral' });
    return;
  }
  if (await hasActiveTask(command.user_id, 'plan', issueNumber)) {
    await respond({ text: `Already planning issue #${issueNumber}.`, response_type: 'ephemeral' });
    return;
  }
  const dbTaskId = await createTask(command.user_id, 'plan', issueNumber);
  const taskId = String(dbTaskId);
  const sent = forwardToAgent(command.user_id, {
    type: 'plan',
    taskId,
    slackUserId: command.user_id,
    issueNumber,
  });
  if (!sent) {
    await agentOfflineReply(respond);
    return;
  }
  await updateTask(dbTaskId, { status: 'in_progress' });
  registerPendingTask(taskId, { slackUserId: command.user_id, type: 'plan', issueNumber, dbTaskId });
  await respond({ text: '⏳ Received — your agent is on it.', response_type: 'ephemeral' });
});

boltApp.command('/implement', async ({ command, ack, respond }) => {
  await ack();
  const issueNumber = parseIssueNumber(command.text);
  if (!issueNumber) {
    await respond({ text: 'Usage: `/implement <issue-number>`', response_type: 'ephemeral' });
    return;
  }
  if (!isAgentOnline(command.user_id)) {
    await agentOfflineReply(respond);
    return;
  }
  if (await hasActiveTask(command.user_id)) {
    await respond({ text: 'You already have an active task. Use `/cancel` to stop it first.', response_type: 'ephemeral' });
    return;
  }
  if (await hasActiveTask(command.user_id, 'implement', issueNumber)) {
    await respond({ text: `Already working on issue #${issueNumber}.`, response_type: 'ephemeral' });
    return;
  }
  const planText = await getPlanText(command.user_id, issueNumber) ?? undefined;
  const dbTaskId = await createTask(command.user_id, 'implement', issueNumber);
  const taskId = String(dbTaskId);
  const sent = forwardToAgent(command.user_id, {
    type: 'implement',
    taskId,
    slackUserId: command.user_id,
    issueNumber,
    planText,
  });
  if (!sent) {
    await agentOfflineReply(respond);
    return;
  }
  await updateTask(dbTaskId, { status: 'in_progress' });
  registerPendingTask(taskId, { slackUserId: command.user_id, type: 'implement', issueNumber, dbTaskId });
  await respond({ text: '⏳ Received — your agent is on it.', response_type: 'ephemeral' });
});

boltApp.command('/cancel', async ({ command, ack, respond }) => {
  await ack();
  if (!isAgentOnline(command.user_id)) {
    await agentOfflineReply(respond);
    return;
  }
  if (!(await hasActiveTask(command.user_id))) {
    await respond({ text: 'No active task to cancel.', response_type: 'ephemeral' });
    return;
  }
  await cancelActiveTask(command.user_id);
  forwardToAgent(command.user_id, {
    type: 'cancel',
    taskId: '',
    slackUserId: command.user_id,
  });
  await respond({ text: 'Cancelling current task...', response_type: 'ephemeral' });
});

boltApp.command('/help', async ({ ack, respond }) => {
  await ack();
  await respond({
    response_type: 'ephemeral',
    text: [
      '*RunAFK commands*',
      '`/list` — List your open GitHub issues',
      '`/plan <issue>` — Generate an implementation plan',
      '`/implement <issue>` — Implement an approved plan and open a PR',
      '`/cancel` — Cancel the current running task',
      '`/register <token>` — Connect your local agent',
    ].join('\n'),
  });
});
