// ─── Relay → Agent ───────────────────────────────────────────────────────────

export interface ListTask {
  type: 'list';
  taskId: string;
  slackUserId: string;
}

export interface PlanTask {
  type: 'plan';
  taskId: string;
  slackUserId: string;
  issueNumber: number;
}

export interface PostPlanTask {
  type: 'post_plan';
  taskId: string;
  slackUserId: string;
  issueNumber: number;
  planText: string;
}

export interface ImplementTask {
  type: 'implement';
  taskId: string;
  slackUserId: string;
  issueNumber: number;
}

export interface CancelTask {
  type: 'cancel';
  taskId: string;
  slackUserId: string;
}

export type RelayToAgentMessage = ListTask | PlanTask | PostPlanTask | ImplementTask | CancelTask;

// ─── Agent → Relay ───────────────────────────────────────────────────────────

export type CheckpointStatus =
  | 'started'
  | 'code_completed'
  | 'testing'
  | 'tests_passed'
  | 'pr_opened'
  | 'error';

export interface CheckpointMessage {
  type: 'checkpoint';
  taskId: string;
  status: CheckpointStatus;
  text: string; // human-readable message shown in Slack
}

export interface TaskResultMessage {
  type: 'result';
  taskId: string;
  text: string; // final message shown in Slack (plan text, issue list, PR URL, etc.)
  error?: boolean; // true when the result is an error — relay marks task 'failed'
}

export type AgentToRelayMessage = CheckpointMessage | TaskResultMessage;

// ─── Relay → Agent (connection confirmation) ─────────────────────────────────

export interface AgentConnectedMessage {
  type: 'connected';
  message: string;
}

export type AgentInboundMessage = RelayToAgentMessage | AgentConnectedMessage;
export type AgentOutboundMessage = AgentToRelayMessage;
