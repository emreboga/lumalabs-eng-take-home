import { Server } from 'http';
import type { RelayToAgentMessage } from '@runafk/shared';
type SlackNotifier = (slackUserId: string, text: string) => Promise<void>;
export declare function setSlackNotifier(fn: SlackNotifier): void;
export declare function hashToken(token: string): string;
/**
 * Register a token for a Slack user (called from /register slash command).
 * Full implementation: persist to Postgres.
 */
export declare function registerToken(slackUserId: string, token: string): void;
export declare function createAgentServer(httpServer: Server): void;
export declare function forwardToAgent(slackUserId: string, payload: RelayToAgentMessage): boolean;
export declare function isAgentOnline(slackUserId: string): boolean;
export {};
//# sourceMappingURL=ws-server.d.ts.map