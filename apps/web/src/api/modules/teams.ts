import type { AgentTeam, AgentTeamMember, Conversation, ConversationMessage } from '@ateam/shared'
import { HttpClient } from '../http/client'

interface TeamListResponse {
  teams: AgentTeam[]
}

interface ConversationListResponse {
  conversations: Conversation[]
}

interface MessageListResponse {
  messages: ConversationMessage[]
}

export interface SendMessageResult {
  message: ConversationMessage
  replyMessageId: string
  routing: ConversationMessage['routing']
}

export class TeamApi {
  static async list(): Promise<AgentTeam[]> {
    const response = await HttpClient.get<TeamListResponse>('/agent-teams')
    return response.teams
  }

  static get(id: string): Promise<AgentTeam> {
    return HttpClient.get<AgentTeam>(`/agent-teams/${id}`)
  }

  static create(input: { name: string; description?: string; memberAgentIds: string[] }): Promise<AgentTeam> {
    return HttpClient.post<AgentTeam>('/agent-teams', input)
  }

  static archive(id: string): Promise<AgentTeam> {
    return HttpClient.post<AgentTeam>(`/agent-teams/${id}/archive`)
  }

  static addMember(id: string, input: { agentId: string; roleOverride?: string }): Promise<{ members: AgentTeamMember[] }> {
    return HttpClient.post<{ members: AgentTeamMember[] }>(`/agent-teams/${id}/members`, input)
  }

  static removeMember(id: string, agentId: string): Promise<void> {
    return HttpClient.delete<void>(`/agent-teams/${id}/members/${agentId}`)
  }
}

export class ConversationApi {
  static async list(teamId: string): Promise<Conversation[]> {
    const response = await HttpClient.get<ConversationListResponse>(`/agent-teams/${teamId}/conversations`)
    return response.conversations
  }

  static create(teamId: string, title: string): Promise<Conversation> {
    return HttpClient.post<Conversation>(`/agent-teams/${teamId}/conversations`, { title })
  }

  static async messages(conversationId: string, afterSeq = 0): Promise<ConversationMessage[]> {
    const response = await HttpClient.get<MessageListResponse>(
      `/conversations/${conversationId}/messages?afterSeq=${afterSeq}&limit=200`,
    )
    return response.messages
  }

  static send(conversationId: string, content: string, mentions: string[] = []): Promise<SendMessageResult> {
    return HttpClient.post<SendMessageResult>(`/conversations/${conversationId}/messages`, { content, mentions })
  }

  static cancel(conversationId: string, messageId: string): Promise<{ status: string }> {
    return HttpClient.post<{ status: string }>(`/conversations/${conversationId}/messages/${messageId}/cancel`)
  }

  static convertToTask(messageId: string): Promise<{ task: { id: string }; created: boolean }> {
    return HttpClient.post<{ task: { id: string }; created: boolean }>(`/messages/${messageId}/convert-to-task`, {})
  }
}
