/**
 * Sanitizers for the Server API configuration and extension resource routes.
 *
 * The runtime exposes live configuration objects that may hold credentials
 * (MCP env/headers, LSP env, formatter environment, provider keys). Every
 * value that leaves through these routes passes through this module first:
 * credentials are removed outright, and remaining text loses known token
 * shapes.
 */
import type {
  AgentConfig,
  EffectiveAgentConfig,
  McpServerConfig,
  McpServerStatus,
  ResourceConfigSnapshot,
  ResourceLspServer,
  ResourceMcpServer,
  ResourceProvider
} from '@ateam/shared'
import { redactSecrets, SESSION_EXPORT_REDACTED } from '@ateam/agent-core/sessions'

/** Structural subset of an LSP server definition needed by the API. */
export interface LspServerSource {
  id: string
  extensions: readonly string[]
  command: readonly string[]
  env?: Record<string, string>
  rootMarkers?: readonly string[]
  npmPackages?: readonly string[]
}

/** Flags whose following argument is a credential. */
const SECRET_FLAG =
  /(?:^|[-_])(?:api[-_]?key|access[-_]?key|secret[-_]?key|private[-_]?key|key|token|access[-_]?token|auth[-_]?token|refresh[-_]?token|secret|client[-_]?secret|password|passwd|credentials?)$/i

function isSecretFlag(flag: string): boolean {
  return SECRET_FLAG.test(flag)
}

/**
 * Redacts credential-carrying arguments in a command line.
 *
 * Handles `--token=value`, `--api-key value` and bare token shapes such as
 * `Authorization: Bearer …`.
 */
export function redactArguments(args: readonly string[]): string[] {
  const result: string[] = []
  let redactNext = false
  for (const argument of args) {
    if (redactNext) {
      result.push(SESSION_EXPORT_REDACTED)
      redactNext = false
      continue
    }
    const assignment = /^(--?[A-Za-z0-9_-]+)=(.*)$/.exec(argument)
    if (assignment) {
      result.push(
        isSecretFlag(assignment[1])
          ? `${assignment[1]}=${SESSION_EXPORT_REDACTED}`
          : redactSecrets(argument)
      )
      continue
    }
    if (/^--?[A-Za-z0-9_-]+$/.test(argument) && isSecretFlag(argument)) {
      result.push(argument)
      redactNext = true
      continue
    }
    result.push(redactSecrets(argument))
  }
  return result
}

/**
 * Drops userinfo, query string and fragment from a URL; query strings are a
 * common place for MCP access tokens.
 */
export function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return redactSecrets(parsed.toString())
  } catch {
    return redactSecrets(value)
  }
}

/** Replaces a URL or returns null, keeping the provider's other fields intact. */
export function sanitizeProviders(providers: readonly ResourceProvider[]): ResourceProvider[] {
  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    type: provider.type,
    ...(provider.baseURL ? { baseURL: sanitizeUrl(provider.baseURL) ?? undefined } : {}),
    hasApiKey: provider.hasApiKey,
    source: provider.source
  }))
}

/**
 * Shapes MCP servers for the wire: environment variable and header values are
 * dropped (only names remain), arguments are redacted, and URLs lose query
 * strings.
 */
export function sanitizeMcpServers(
  servers: readonly McpServerConfig[],
  statuses: readonly McpServerStatus[] = []
): ResourceMcpServer[] {
  const statusById = new Map(statuses.map((status) => [status.id, status]))
  return servers.map((server) => ({
    id: server.id,
    name: server.name,
    type: server.type,
    command: server.command,
    args: redactArguments(server.args ?? []),
    url: sanitizeUrl(server.url),
    headerNames: Object.keys(server.headers ?? {}).sort(),
    envNames: Object.keys(server.env ?? {}).sort(),
    enabled: server.enabled,
    timeout: server.timeout ?? null,
    cwd: server.cwd ?? null,
    hasOAuthClientId: Boolean(server.oauthClientId),
    oauthScope: server.oauthScope ?? null,
    ...(server.source ? { source: server.source } : {}),
    status: statusById.get(server.id) ?? null
  }))
}

/** Shapes LSP servers for the wire; environment values become names only. */
export function sanitizeLspServers(servers: readonly LspServerSource[]): ResourceLspServer[] {
  return servers.map((server) => ({
    id: server.id,
    extensions: [...server.extensions],
    command: redactArguments(server.command),
    envNames: Object.keys(server.env ?? {}).sort(),
    rootMarkers: [...(server.rootMarkers ?? [])],
    npmPackages: [...(server.npmPackages ?? [])]
  }))
}

function omitKeys<T extends Record<string, unknown>>(value: T, keys: readonly string[]): T {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key))
  ) as unknown as T
}

/**
 * Shapes the effective configuration for the wire.
 *
 * MCP `env`/`headers`, LSP `env` and formatter `environment` are removed
 * entirely; the rest of the document is passed through credential redaction so
 * a secret pasted into a prompt or command template does not leak.
 */
export function sanitizeConfig(
  workspace: string,
  effective: EffectiveAgentConfig
): ResourceConfigSnapshot {
  const config: AgentConfig = { ...effective.config }
  if (config.mcpServers) {
    config.mcpServers = config.mcpServers.map((server) =>
      omitKeys(server as unknown as Record<string, unknown>, ['env', 'headers'])
    ) as unknown as AgentConfig['mcpServers']
  }
  if (config.lspServers) {
    config.lspServers = Object.fromEntries(
      Object.entries(config.lspServers).map(([id, input]) => [
        id,
        omitKeys(input as unknown as Record<string, unknown>, ['env'])
      ])
    ) as unknown as AgentConfig['lspServers']
  }
  if (config.formatterServers) {
    config.formatterServers = Object.fromEntries(
      Object.entries(config.formatterServers).map(([id, input]) => [
        id,
        omitKeys(input as unknown as Record<string, unknown>, ['environment'])
      ])
    ) as unknown as AgentConfig['formatterServers']
  }
  return {
    workspace,
    config: redactSecrets(config),
    sources: redactSecrets(effective.sources),
    diagnostics: redactSecrets(effective.diagnostics),
    provenance: effective.provenance
  }
}

/** Applies credential redaction to a resource list without changing its shape. */
export function redactResource<T>(value: T): T {
  return redactSecrets(value)
}
