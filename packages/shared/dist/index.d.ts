export interface RelayToAgentMessage {
    type: 'task';
    slackUserId: string;
    text: string;
}
export interface AgentToRelayMessage {
    type: 'response';
    text: string;
}
export interface AgentConnectedMessage {
    type: 'connected';
    message: string;
}
export type AgentInboundMessage = RelayToAgentMessage | AgentConnectedMessage;
export type AgentOutboundMessage = AgentToRelayMessage;
//# sourceMappingURL=index.d.ts.map