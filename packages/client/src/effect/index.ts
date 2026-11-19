// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { OpenCode } from "./client.js"

export * from "./generated/index"
export { OpenCode } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@ateam/schema/agent"
export { Command } from "@ateam/schema/command"
export { Config } from "@ateam/schema/config"
export { Credential } from "@ateam/schema/credential"
export { Event } from "@ateam/schema/event"
export { EventLog } from "@ateam/schema/event-log"
export { FileSystem } from "@ateam/schema/filesystem"
export { Form } from "@ateam/schema/form"
export { Integration } from "@ateam/schema/integration"
export { Location } from "@ateam/schema/location"
export { Model } from "@ateam/schema/model"
export { Permission } from "@ateam/schema/permission"
export { PermissionSaved } from "@ateam/schema/permission-saved"
export { Project } from "@ateam/schema/project"
export { Worktree } from "@ateam/schema/worktree"
export { Vcs } from "@ateam/schema/vcs"
export { Provider } from "@ateam/schema/provider"
export { Pty } from "@ateam/schema/pty"
export { Question } from "@ateam/schema/question"
export { Reference } from "@ateam/schema/reference"
export { WebSearch } from "@ateam/schema/websearch"
export { AbsolutePath, RelativePath } from "@ateam/schema/schema"
export { Session } from "@ateam/schema/session"
export { SessionInbox } from "@ateam/schema/session-inbox"
export { SessionMessage } from "@ateam/schema/session-message"
export { Skill } from "@ateam/schema/skill"
export { Prompt } from "@ateam/schema/prompt"
export { PromptInput } from "@ateam/schema/prompt-input"
export type { OpenCodeEvent } from "@ateam/protocol/groups/event"
export type OpenCodeClient = Effect.Success<ReturnType<typeof OpenCode.make>>
