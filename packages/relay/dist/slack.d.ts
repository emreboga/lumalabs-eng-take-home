import { App } from '@slack/bolt';
import type { Application } from 'express';
export declare const boltApp: App<import("@slack/bolt/dist/types/helpers").StringIndexed>;
/**
 * Returns the Express app so index.ts can attach it to the shared HTTP server.
 * Bolt registers /slack/events (and /slack/actions) on this app automatically.
 */
export declare function getExpressApp(): Application;
/**
 * Post a message to a user's DM channel.
 * Used by ws-server to deliver agent responses back to Slack.
 */
export declare function postToDM(slackUserId: string, text: string): Promise<void>;
export declare function initSlack(): void;
//# sourceMappingURL=slack.d.ts.map