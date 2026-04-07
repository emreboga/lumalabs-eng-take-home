// Messages sent from relay to agent
export interface RelayToAgentMessage {
  type: 'task';
  slackUserId: string;
  text: string;
}

// Messages sent from agent to relay
export interface AgentToRelayMessage {
  type: 'response';
  text: string;
}

// Confirmation sent by relay after agent connects
export interface AgentConnectedMessage {
  type: 'connected';
  message: string;
}

export type AgentInboundMessage = RelayToAgentMessage | AgentConnectedMessage;
export type AgentOutboundMessage = AgentToRelayMessage;
