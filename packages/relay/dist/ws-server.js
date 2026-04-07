"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSlackNotifier = setSlackNotifier;
exports.hashToken = hashToken;
exports.registerToken = registerToken;
exports.createAgentServer = createAgentServer;
exports.forwardToAgent = forwardToAgent;
exports.isAgentOnline = isAgentOnline;
const ws_1 = require("ws");
const crypto_1 = __importDefault(require("crypto"));
// slackUserId → active agent WebSocket
const agentsByUser = new Map();
// tokenHash → slackUserId — populated via /register command
// Checkpoint: in-memory. Full implementation: Postgres.
const tokenRegistry = new Map();
let slackNotifier = null;
function setSlackNotifier(fn) {
    slackNotifier = fn;
}
function hashToken(token) {
    return crypto_1.default.createHash('sha256').update(token).digest('hex');
}
/**
 * Register a token for a Slack user (called from /register slash command).
 * Full implementation: persist to Postgres.
 */
function registerToken(slackUserId, token) {
    tokenRegistry.set(hashToken(token), slackUserId);
    console.log(`[ws] token registered for user ${slackUserId}`);
}
function createAgentServer(httpServer) {
    const wss = new ws_1.WebSocketServer({ server: httpServer, path: '/agent' });
    wss.on('connection', (ws, req) => {
        const auth = req.headers['authorization'];
        if (!auth?.startsWith('Bearer ')) {
            ws.close(4001, 'Missing authorization header');
            return;
        }
        // Never log the token itself
        const tokenHash = hashToken(auth.slice(7));
        const slackUserId = tokenRegistry.get(tokenHash) ?? null;
        if (!slackUserId) {
            ws.close(4001, 'Invalid token — run /register <token> in Slack first');
            return;
        }
        // Enforce one connection per token
        const existing = agentsByUser.get(slackUserId);
        if (existing?.readyState === ws_1.WebSocket.OPEN) {
            existing.close(4000, 'Superseded by new connection');
        }
        agentsByUser.set(slackUserId, ws);
        console.log(`[ws] agent connected for user ${slackUserId}`);
        ws.send(JSON.stringify({ type: 'connected', message: 'runafk-relay: agent registered' }));
        ws.on('message', async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'response' && slackNotifier) {
                    await slackNotifier(slackUserId, msg.text);
                }
            }
            catch {
                console.error('[ws] failed to parse agent message');
            }
        });
        ws.on('close', () => {
            if (agentsByUser.get(slackUserId) === ws) {
                agentsByUser.delete(slackUserId);
                console.log(`[ws] agent disconnected for user ${slackUserId}`);
            }
        });
        ws.on('error', (err) => {
            console.error(`[ws] error for user ${slackUserId}:`, err.message);
        });
    });
}
function forwardToAgent(slackUserId, payload) {
    const ws = agentsByUser.get(slackUserId);
    if (!ws || ws.readyState !== ws_1.WebSocket.OPEN)
        return false;
    ws.send(JSON.stringify(payload));
    return true;
}
function isAgentOnline(slackUserId) {
    const ws = agentsByUser.get(slackUserId);
    return ws?.readyState === ws_1.WebSocket.OPEN;
}
//# sourceMappingURL=ws-server.js.map