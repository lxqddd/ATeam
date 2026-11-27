/**
 * Wire types for the Server API configuration and extension resource routes.
 *
 * Credential values are never part of these payloads: provider keys collapse to
 * `hasApiKey`, MCP/LSP environment variables to their names, and URLs lose
 * userinfo and query strings.
 */
import type {
  AgentConfig,
  ConfigDiagnostic,
  ConfigProvenance,
  ConfigSources,
  McpServerStatus,
  McpServerType
} from './agent-types'
import type { ProviderType } from './model-types'

/** A provider exposed by `GET /providers`; never includes the credential. */
export interface ResourceProvider {
  id: string
  name: string
  type: ProviderType
  /** Base URL with userinfo and query string removed. */
  baseURL?: string
  /** True when an API key or OAuth token is available for this provider. */
  hasApiKey: boolean
  source: 'runtime' | 'project'
}

/** A sanitized MCP server exposed by `GET /mcp`. */
export interface ResourceMcpServer {
  id: string
  name: string
  type: McpServerType
  command: string | null
  args: string[]
  /** URL without userinfo, query string or fragment; null for local servers. */
  url: string | null
  /** Header names only; values are never returned. */
  headerNames: string[]
  /** Environment variable names only; values are never returned. */
  envNames: string[]
  enabled: boolean
  timeout?: number | null
  cwd?: string | null
  hasOAuthClientId: boolean
  oauthScope?: string | null
  source?: 'user' | 'project' | 'transient'
  /** Last known connection status, when the runtime has one. */
  status: McpServerStatus | null
}

/** An LSP server definition exposed by `GET /lsp`. */
export interface ResourceLspServer {
  id: string
  extensions: string[]
  /** Command and arguments, with recognized credential flags redacted. */
  command: string[]
  /** Environment variable names only. */
  envNames: string[]
  rootMarkers: string[]
  npmPackages: string[]
}

/** Effective configuration exposed by `GET /config`. */
export interface ResourceConfigSnapshot {
  /** Absolute workspace the configuration was resolved for. */
  workspace: string
  /** Effective merged configuration; MCP/LSP credentials removed. */
  config: AgentConfig
  sources: ConfigSources
  diagnostics: ConfigDiagnostic[]
  provenance: ConfigProvenance
}
