"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.boltApp = void 0;
exports.getExpressApp = getExpressApp;
exports.postToDM = postToDM;
exports.initSlack = initSlack;
const bolt_1 = require("@slack/bolt");
const ws_server_1 = require("./ws-server");
const receiver = new bolt_1.ExpressReceiver({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});
exports.boltApp = new bolt_1.App({
    token: process.env.SLACK_BOT_TOKEN,
    receiver,
    logLevel: bolt_1.LogLevel.WARN,
});
/**
 * Returns the Express app so index.ts can attach it to the shared HTTP server.
 * Bolt registers /slack/events (and /slack/actions) on this app automatically.
 */
function getExpressApp() {
    return receiver.app;
}
receiver.router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'runafk-relay' });
});
/**
 * Post a message to a user's DM channel.
 * Used by ws-server to deliver agent responses back to Slack.
 */
async function postToDM(slackUserId, text) {
    await exports.boltApp.client.chat.postMessage({ channel: slackUserId, text });
}
// Register an agent token for the calling user
exports.boltApp.command('/register', async ({ command, ack, respond }) => {
    await ack();
    const token = command.text.trim();
    if (!token) {
        await respond('Usage: `/register <token>`');
        return;
    }
    (0, ws_server_1.registerToken)(command.user_id, token);
    await respond({ text: 'Agent token registered. Start your agent and it will connect automatically.', response_type: 'ephemeral' });
});
// Handle incoming DMs
exports.boltApp.message(async ({ message, say }) => {
    const msg = message;
    if (msg.channel_type !== 'im' || !msg.text)
        return;
    const userId = msg.user;
    // Checkpoint 2: forward to agent if connected
    if ((0, ws_server_1.isAgentOnline)(userId)) {
        const sent = (0, ws_server_1.forwardToAgent)(userId, { type: 'task', slackUserId: userId, text: msg.text });
        if (!sent)
            await say('Agent is offline.');
        return;
    }
    // Checkpoint 1: echo back
    await say(`Echo: ${msg.text}`);
});
function initSlack() {
    (0, ws_server_1.setSlackNotifier)(postToDM);
    console.log('[slack] Bolt app initialized in HTTP mode');
}
//# sourceMappingURL=slack.js.map