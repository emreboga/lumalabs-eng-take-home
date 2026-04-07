import { boltApp, postToDM } from './slack';
import { forwardToAgent, isAgentOnline, registerPendingTask } from './ws-server';
import { createTask } from './db';

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
  registerPendingTask(taskId, { slackUserId: command.user_id, type: 'list', dbTaskId });
  await postToDM(command.user_id, 'Working on it...');
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
  registerPendingTask(taskId, { slackUserId: command.user_id, type: 'plan', issueNumber, dbTaskId });
  await postToDM(command.user_id, `Working on it...`);
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
  const dbTaskId = await createTask(command.user_id, 'implement', issueNumber);
  const taskId = String(dbTaskId);
  const sent = forwardToAgent(command.user_id, {
    type: 'implement',
    taskId,
    slackUserId: command.user_id,
    issueNumber,
  });
  if (!sent) {
    await agentOfflineReply(respond);
    return;
  }
  registerPendingTask(taskId, { slackUserId: command.user_id, type: 'implement', issueNumber, dbTaskId });
  await postToDM(command.user_id, `Working on it...`);
});
