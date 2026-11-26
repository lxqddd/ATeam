import type {
  AgentConfigDocument,
  AgentEnvironmentConfig,
  AgentReference,
  CommandConfigInput,
  ConfigDiagnostic,
  FormatterConfigInput,
  LspServerConfigInput,
  McpServerInput,
  PermissionEffect,
  PermissionRuleAction,
  PermissionRuleInput,
  ProviderConfigInput,
  ProviderModelConfigInput,
  ProviderType,
  RetryConfigInput,
  ToolOutputConfigInput,
  ToolOutputLimits
} from '@ateam/shared'

const RULE_ACTIONS: readonly PermissionRuleAction[] = [
  'read',
  'list',
  'glob',
  'grep',
  'write',
  'edit',
  'shell',
  'external_directory',
  'mcp',
  'webfetch',
  'websearch',
  'lsp',
  'skill',
  'subagent',
  'plugin',
  '*'
]
const RULE_EFFECTS: readonly PermissionEffect[] = ['allow', 'ask', 'deny']
const PROVIDER_TYPES: readonly ProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'openai-compatible'
]
const REFERENCE_ALIAS = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const CONFIG_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const MAX_LIST = 200

function diagnostic(
  diagnostics: ConfigDiagnostic[],
  source: string,
  path: string,
  message: string,
  severity: ConfigDiagnostic['severity'] = 'warning'
): void {
  diagnostics.push({ source, path, message, severity })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function boundedInteger(
  value: unknown,
  path: string,
  source: string,
  diagnostics: ConfigDiagnostic[],
  min: number,
  max: number
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
    return value
  }
  diagnostic(
    diagnostics,
    source,
    path,
    `${path} must be an integer between ${min} and ${max}`,
    'warning'
  )
  return undefined
}

function normalizeEnvironment(
  value: unknown,
  source: string,
  diagnostics: ConfigDiagnostic[]
): AgentEnvironmentConfig | undefined {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, '$.environment', 'environment must be an object')
    return undefined
  }
  const environment: AgentEnvironmentConfig = {}
  if (typeof value.timezone === 'string' && value.timezone.trim()) {
    const timezone = value.timezone.trim()
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone })
      environment.timezone = timezone
    } catch {
      diagnostic(diagnostics, source, '$.environment.timezone', 'unknown timezone')
    }
  } else if (value.timezone !== undefined) {
    diagnostic(diagnostics, source, '$.environment.timezone', 'timezone must be a string')
  }
  if (typeof value.notes === 'string' && value.notes.trim()) {
    environment.notes = value.notes.trim().slice(0, 4_000)
  } else if (value.notes !== undefined) {
    diagnostic(diagnostics, source, '$.environment.notes', 'notes must be a string')
  }
  return Object.keys(environment).length > 0 ? environment : undefined
}

function normalizeRetry(
  value: unknown,
  source: string,
  diagnostics: ConfigDiagnostic[]
): RetryConfigInput | undefined {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, '$.retry', 'retry must be an object')
    return undefined
  }
  const retry: RetryConfigInput = {}
  const maxRetries = boundedInteger(
    value.maxRetries,
    '$.retry.maxRetries',
    source,
    diagnostics,
    0,
    10
  )
  const maxDelayMs = boundedInteger(
    value.maxDelayMs,
    '$.retry.maxDelayMs',
    source,
    diagnostics,
    0,
    600_000
  )
  const timeoutMs = boundedInteger(
    value.timeoutMs,
    '$.retry.timeoutMs',
    source,
    diagnostics,
    0,
    3_600_000
  )
  if (maxRetries !== undefined) retry.maxRetries = maxRetries
  if (maxDelayMs !== undefined) retry.maxDelayMs = maxDelayMs
  if (timeoutMs !== undefined) retry.timeoutMs = timeoutMs
  return Object.keys(retry).length > 0 ? retry : undefined
}

const MAX_TOOL_OUTPUT_LINES = 100_000
const MAX_TOOL_OUTPUT_BYTES = 10 * 1024 * 1024
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/

function normalizeToolOutputLimits(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): ToolOutputLimits {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, path, `${path} must be an object`)
    return {}
  }
  const limits: ToolOutputLimits = {}
  const maxLines = boundedInteger(
    value.maxLines,
    `${path}.maxLines`,
    source,
    diagnostics,
    1,
    MAX_TOOL_OUTPUT_LINES
  )
  const maxBytes = boundedInteger(
    value.maxBytes,
    `${path}.maxBytes`,
    source,
    diagnostics,
    1,
    MAX_TOOL_OUTPUT_BYTES
  )
  if (maxLines !== undefined) limits.maxLines = maxLines
  if (maxBytes !== undefined) limits.maxBytes = maxBytes
  if (value.mode === 'head' || value.mode === 'tail') limits.mode = value.mode
  else if (value.mode !== undefined) {
    diagnostic(diagnostics, source, `${path}.mode`, `${path}.mode must be "head" or "tail"`)
  }
  return limits
}

function normalizeToolOutput(
  value: unknown,
  source: string,
  diagnostics: ConfigDiagnostic[]
): ToolOutputConfigInput | undefined {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, '$.toolOutput', 'toolOutput must be an object')
    return undefined
  }
  const config: ToolOutputConfigInput = normalizeToolOutputLimits(
    value,
    source,
    '$.toolOutput',
    diagnostics
  )
  if (isRecord(value.tools)) {
    const tools: Record<string, ToolOutputLimits> = {}
    for (const [name, entry] of Object.entries(value.tools).slice(0, 50)) {
      if (!TOOL_NAME.test(name)) continue
      const limits = normalizeToolOutputLimits(
        entry,
        source,
        `$.toolOutput.tools.${name}`,
        diagnostics
      )
      if (Object.keys(limits).length > 0) tools[name] = limits
    }
    if (Object.keys(tools).length > 0) config.tools = tools
  } else if (value.tools !== undefined) {
    diagnostic(diagnostics, source, '$.toolOutput.tools', 'toolOutput.tools must be an object')
  }
  return Object.keys(config).length > 0 ? config : undefined
}

export function normalizeFormatterOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const overrides: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(overrides).length >= 50) break
    if (typeof rawValue !== 'string') continue
    const trimmedKey = rawKey.trim().toLowerCase()
    const extension = trimmedKey.startsWith('.') ? trimmedKey : `.${trimmedKey}`
    if (!/^\.[a-z0-9+]{1,15}$/.test(extension)) continue
    const formatter = rawValue.trim().toLowerCase()
    if (formatter !== 'none' && !/^[a-z0-9_-]{1,40}$/.test(formatter)) continue
    overrides[extension] = formatter
  }
  return overrides
}

export function normalizeReferences(value: unknown): AgentReference[] {
  if (!value) return []
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((entry) => [
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { alias?: unknown }).alias === 'string'
          ? String((entry as { alias: string }).alias)
          : '',
        entry
      ])
    : typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>)
      : []
  const byAlias = new Map<string, AgentReference>()
  for (const [key, raw] of entries) {
    if (byAlias.size >= 50) break
    const entry =
      typeof raw === 'string'
        ? /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw.trim()) && !raw.trim().startsWith('.')
          ? { repository: raw.trim() }
          : { path: raw }
        : raw && typeof raw === 'object'
          ? raw
          : null
    if (!entry) continue
    const rawEntry = entry as Record<string, unknown>
    const alias = String(rawEntry.alias ?? key).trim()
    if (!REFERENCE_ALIAS.test(alias)) continue
    const pathValue =
      typeof rawEntry.path === 'string' && rawEntry.path.trim() ? rawEntry.path.trim() : null
    const repository =
      typeof rawEntry.repository === 'string' && rawEntry.repository.trim()
        ? rawEntry.repository.trim()
        : null
    if (Boolean(pathValue) === Boolean(repository)) continue
    const branch =
      repository && typeof rawEntry.branch === 'string' && rawEntry.branch.trim()
        ? rawEntry.branch.trim().slice(0, 200)
        : null
    const description =
      typeof rawEntry.description === 'string' && rawEntry.description.trim()
        ? rawEntry.description.trim().slice(0, 500)
        : null
    byAlias.set(alias, {
      alias,
      ...(pathValue ? { path: pathValue.slice(0, 1_000) } : {}),
      ...(repository ? { repository: repository.slice(0, 500) } : {}),
      ...(branch ? { branch } : {}),
      ...(description ? { description } : {}),
      ...(rawEntry.hidden === true ? { hidden: true } : {})
    })
  }
  return [...byAlias.values()]
}

export function normalizeInstructions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ]
}

function normalizeRuleList(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): PermissionRuleInput[] {
  if (!Array.isArray(value)) return []
  const rules: PermissionRuleInput[] = []
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostic(diagnostics, source, `${path}[${index}]`, 'permission rule must be an object')
      return
    }
    if (
      typeof entry.action !== 'string' ||
      !RULE_ACTIONS.includes(entry.action as PermissionRuleAction) ||
      typeof entry.resource !== 'string' ||
      !entry.resource.trim() ||
      typeof entry.effect !== 'string' ||
      !RULE_EFFECTS.includes(entry.effect as PermissionEffect)
    ) {
      diagnostic(
        diagnostics,
        source,
        `${path}[${index}]`,
        'permission rule needs a valid action, resource and effect'
      )
      return
    }
    rules.push({
      action: entry.action as PermissionRuleAction,
      resource: entry.resource.trim(),
      effect: entry.effect as PermissionEffect,
      sessionId: null
    })
  })
  return rules
}

function normalizeMcpServers(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): McpServerInput[] {
  if (!Array.isArray(value)) return []
  const servers: McpServerInput[] = []
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      diagnostic(diagnostics, source, `${path}[${index}]`, 'MCP server must be an object')
      return
    }
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      diagnostic(diagnostics, source, `${path}[${index}].name`, 'MCP server name is required')
      return
    }
    const type = entry.type === 'remote' ? 'remote' : entry.type === 'local' ? 'local' : null
    if (!type) {
      diagnostic(
        diagnostics,
        source,
        `${path}[${index}].type`,
        'MCP server type must be "local" or "remote"'
      )
      return
    }
    if (type === 'local' && typeof entry.command !== 'string') {
      diagnostic(
        diagnostics,
        source,
        `${path}[${index}].command`,
        'local MCP server requires command'
      )
      return
    }
    if (type === 'remote' && typeof entry.url !== 'string') {
      diagnostic(diagnostics, source, `${path}[${index}].url`, 'remote MCP server requires url')
      return
    }
    const headers = stringRecord(entry.headers)
    const env = stringRecord(entry.env)
    const timeout =
      typeof entry.timeout === 'number' &&
      Number.isInteger(entry.timeout) &&
      entry.timeout >= 100 &&
      entry.timeout <= 600_000
        ? entry.timeout
        : undefined
    if (entry.timeout !== undefined && timeout === undefined) {
      diagnostic(
        diagnostics,
        source,
        `${path}[${index}].timeout`,
        'MCP timeout must be an integer between 100 and 600000 milliseconds'
      )
    }
    if (type === 'remote' && entry.cwd !== undefined) {
      diagnostic(
        diagnostics,
        source,
        `${path}[${index}].cwd`,
        'MCP working directory is only supported for local servers'
      )
    }
    const cwdCandidate =
      type === 'local' && typeof entry.cwd === 'string' ? entry.cwd.trim() : undefined
    const validCwd =
      cwdCandidate !== undefined &&
      cwdCandidate.length > 0 &&
      cwdCandidate.length <= 2_000 &&
      !cwdCandidate.includes('\u0000') &&
      !cwdCandidate.includes('\r') &&
      !cwdCandidate.includes('\n')
    if (cwdCandidate !== undefined && !validCwd) {
      diagnostic(diagnostics, source, `${path}[${index}].cwd`, 'MCP working directory is invalid')
    }
    servers.push({
      name: entry.name.trim(),
      type,
      ...(typeof entry.command === 'string' ? { command: entry.command } : {}),
      ...(strings(entry.args).length > 0 ? { args: strings(entry.args) } : {}),
      ...(typeof entry.url === 'string' ? { url: entry.url } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(typeof entry.enabled === 'boolean' ? { enabled: entry.enabled } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
      ...(validCwd && cwdCandidate !== undefined ? { cwd: cwdCandidate } : {}),
      ...(typeof entry.oauthClientId === 'string' ? { oauthClientId: entry.oauthClientId } : {}),
      ...(typeof entry.oauthScope === 'string' ? { oauthScope: entry.oauthScope } : {}),
      ...(typeof entry.oauthRedirectUri === 'string'
        ? { oauthRedirectUri: entry.oauthRedirectUri }
        : {})
    })
  })
  return servers
}

function normalizeLspServers(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): Record<string, LspServerConfigInput> | undefined {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, path, 'lsp must be a boolean or an object')
    return undefined
  }
  const servers: Record<string, LspServerConfigInput> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (Object.keys(servers).length >= MAX_LIST) break
    if (!CONFIG_KEY.test(id) || !isRecord(raw)) {
      diagnostic(diagnostics, source, `${path}.${id}`, 'invalid LSP server definition')
      continue
    }
    const command = strings(raw.command)
    const extensions = strings(raw.extensions)
      .map((entry) => (entry.startsWith('.') ? entry.toLowerCase() : `.${entry.toLowerCase()}`))
      .filter((entry) => /^\.[a-z0-9+]{1,20}$/.test(entry))
    const disabled = raw.disabled === true
    const env = stringRecord(raw.env)
    const rootMarkers = strings(raw.rootMarkers)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0 && entry.length <= 100 && !/[/\\]/.test(entry))
    const npmPackages = strings(raw.npmPackages)
      .map((entry) => entry.trim())
      .filter((entry) => /^(@[a-z0-9-_.]+\/)?[a-z0-9-_.]+$/i.test(entry))
    servers[id] = {
      ...(command.length > 0 ? { command } : {}),
      ...(extensions.length > 0 ? { extensions } : {}),
      ...(rootMarkers.length > 0 ? { rootMarkers } : {}),
      ...(npmPackages.length > 0 ? { npmPackages } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      ...(isRecord(raw.initialization) ? { initialization: raw.initialization } : {})
    }
  }
  return Object.keys(servers).length > 0 ? servers : undefined
}

function normalizeFormatterServers(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): Record<string, FormatterConfigInput> | undefined {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, path, 'formatters must be a boolean or an object')
    return undefined
  }
  const formatters: Record<string, FormatterConfigInput> = {}
  for (const [id, raw] of Object.entries(value)) {
    if (Object.keys(formatters).length >= MAX_LIST) break
    if (!CONFIG_KEY.test(id) || !isRecord(raw)) {
      diagnostic(diagnostics, source, `${path}.${id}`, 'invalid formatter definition')
      continue
    }
    const command = strings(raw.command)
    const disabled = raw.disabled === true
    const extensions = strings(raw.extensions)
      .map((entry) => (entry.startsWith('.') ? entry.toLowerCase() : `.${entry.toLowerCase()}`))
      .filter((entry) => /^\.[a-z0-9+]{1,20}$/.test(entry))
    const configFiles = strings(raw.configFiles)
    const environment = stringRecord(raw.environment)
    formatters[id] = {
      ...(command.length > 0 ? { command } : {}),
      ...(extensions.length > 0 ? { extensions } : {}),
      ...(configFiles.length > 0 ? { configFiles } : {}),
      ...(disabled ? { disabled: true } : {}),
      ...(Object.keys(environment).length > 0 ? { environment } : {})
    }
  }
  return Object.keys(formatters).length > 0 ? formatters : undefined
}

function normalizeProviderModel(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): ProviderModelConfigInput | null {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, path, 'provider model must be an object')
    return null
  }
  const model: ProviderModelConfigInput = {}
  if (typeof value.name === 'string' && value.name.trim()) model.name = value.name.trim()
  for (const key of ['contextWindow', 'maxOutputTokens', 'costInput', 'costOutput'] as const) {
    if (value[key] === undefined) continue
    const number = finiteNumber(value[key])
    if (number === undefined || number < 0) {
      diagnostic(diagnostics, source, `${path}.${key}`, 'invalid numeric value')
      continue
    }
    model[key] = number
  }
  for (const key of ['reasoning', 'attachment', 'applyPatch', 'compaction'] as const) {
    if (typeof value[key] === 'boolean') model[key] = value[key]
  }
  if (Array.isArray(value.variants)) {
    model.variants = value.variants
      .filter(isRecord)
      .slice(0, 10)
      .map((variant) => ({
        name: typeof variant.name === 'string' ? variant.name : '',
        settings: isRecord(variant.settings) ? (variant.settings as never) : {}
      }))
      .filter((variant) => variant.name)
  }
  return model
}

function normalizeProviders(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): Record<string, ProviderConfigInput> | undefined {
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((entry) => [isRecord(entry) && typeof entry.id === 'string' ? entry.id : '', entry])
    : isRecord(value)
      ? Object.entries(value)
      : []
  if (entries.length === 0 && !isRecord(value) && !Array.isArray(value)) {
    diagnostic(diagnostics, source, path, 'providers must be an object or array')
    return undefined
  }
  const providers: Record<string, ProviderConfigInput> = {}
  for (const [key, raw] of entries) {
    if (Object.keys(providers).length >= MAX_LIST) break
    if (!isRecord(raw)) {
      diagnostic(diagnostics, source, `${path}.${key}`, 'provider must be an object')
      continue
    }
    const id = key.trim()
    if (!CONFIG_KEY.test(id)) {
      diagnostic(diagnostics, source, `${path}.${key || 'id'}`, 'invalid provider id')
      continue
    }
    if ('apiKey' in raw) {
      diagnostic(
        diagnostics,
        source,
        `${path}.${id}.apiKey`,
        'literal apiKey is not allowed in config; use apiKeyEnv'
      )
    }
    const provider: ProviderConfigInput = {}
    if (typeof raw.name === 'string' && raw.name.trim()) provider.name = raw.name.trim()
    if (typeof raw.type === 'string' && PROVIDER_TYPES.includes(raw.type as ProviderType)) {
      provider.type = raw.type as ProviderType
    }
    if (typeof raw.baseURL === 'string' && raw.baseURL.trim()) provider.baseURL = raw.baseURL.trim()
    if (typeof raw.apiKeyEnv === 'string' && ENV_NAME.test(raw.apiKeyEnv.trim())) {
      provider.apiKeyEnv = raw.apiKeyEnv.trim()
    } else if (raw.apiKeyEnv !== undefined) {
      diagnostic(diagnostics, source, `${path}.${id}.apiKeyEnv`, 'invalid environment name')
    }
    const rawModels = raw.models
    const modelEntries: Array<[string, unknown]> = Array.isArray(rawModels)
      ? rawModels.map((entry) => [
          isRecord(entry) && typeof entry.id === 'string' ? entry.id : '',
          entry
        ])
      : isRecord(rawModels)
        ? Object.entries(rawModels)
        : []
    if (modelEntries.length > 0) {
      const models: Record<string, ProviderModelConfigInput> = {}
      for (const [modelKey, modelRaw] of modelEntries.slice(0, MAX_LIST)) {
        const modelId = modelKey.trim()
        if (!modelId || !MODEL_KEY.test(modelId)) {
          diagnostic(diagnostics, source, `${path}.${id}.models`, 'invalid model id')
          continue
        }
        const model = normalizeProviderModel(
          modelRaw,
          source,
          `${path}.${id}.models.${modelId}`,
          diagnostics
        )
        if (model) models[modelId] = model
      }
      if (Object.keys(models).length > 0) provider.models = models
    }
    providers[id] = provider
  }
  return Object.keys(providers).length > 0 ? providers : undefined
}

function normalizeCommands(
  value: unknown,
  source: string,
  path: string,
  diagnostics: ConfigDiagnostic[]
): Record<string, CommandConfigInput> | undefined {
  const entries: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((entry) => [
        isRecord(entry) && typeof entry.name === 'string' ? entry.name : '',
        entry
      ])
    : isRecord(value)
      ? Object.entries(value)
      : []
  if (entries.length === 0 && !isRecord(value) && !Array.isArray(value)) {
    diagnostic(diagnostics, source, path, 'commands must be an object or array')
    return undefined
  }
  const commands: Record<string, CommandConfigInput> = {}
  for (const [key, raw] of entries) {
    if (Object.keys(commands).length >= MAX_LIST) break
    if (!isRecord(raw)) {
      diagnostic(diagnostics, source, `${path}.${key}`, 'command must be an object')
      continue
    }
    const name = key.trim()
    if (!name || !CONFIG_KEY.test(name)) {
      diagnostic(diagnostics, source, `${path}.${key || 'name'}`, 'invalid command name')
      continue
    }
    if (typeof raw.template !== 'string' || !raw.template.trim()) {
      diagnostic(diagnostics, source, `${path}.${name}.template`, 'command template is required')
      continue
    }
    commands[name] = {
      template: raw.template.trim(),
      ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
      ...(typeof raw.agent === 'string' && raw.agent.trim() ? { agent: raw.agent.trim() } : {}),
      ...(typeof raw.model === 'string' && raw.model.trim() ? { model: raw.model.trim() } : {}),
      ...(typeof raw.subtask === 'boolean' ? { subtask: raw.subtask } : {})
    }
  }
  return Object.keys(commands).length > 0 ? commands : undefined
}

export interface ParsedConfigDocument {
  document: AgentConfigDocument
  diagnostics: ConfigDiagnostic[]
}

export function normalizeAgentConfigDocument(
  value: unknown,
  source: string,
  diagnostics: ConfigDiagnostic[] = []
): ParsedConfigDocument {
  if (!isRecord(value)) {
    diagnostic(diagnostics, source, '$', 'config document must be an object', 'error')
    return { document: {}, diagnostics }
  }
  const document: AgentConfigDocument = {}
  if (typeof value.snapshots === 'boolean') document.snapshots = value.snapshots
  if (value.instructions !== undefined) {
    const instructions = normalizeInstructions(value.instructions)
    if (instructions.length > 0) document.instructions = instructions
    else if (!Array.isArray(value.instructions)) {
      diagnostic(diagnostics, source, '$.instructions', 'instructions must be a string array')
    }
  }
  if (typeof value.lspEnabled === 'boolean') document.lspEnabled = value.lspEnabled
  if (typeof value.lspInstall === 'boolean') document.lspInstall = value.lspInstall
  if (typeof value.lsp === 'boolean') document.lsp = value.lsp
  else if (isRecord(value.lsp)) {
    const servers = normalizeLspServers(value.lsp, source, '$.lsp', diagnostics)
    if (servers) document.lsp = servers
  } else if (value.lsp !== undefined) {
    diagnostic(diagnostics, source, '$.lsp', 'lsp must be a boolean or object')
  }
  if (typeof value.formattersEnabled === 'boolean') {
    document.formattersEnabled = value.formattersEnabled
  }
  if (typeof value.formatters === 'boolean') document.formatters = value.formatters
  else if (isRecord(value.formatters)) {
    const formatters = normalizeFormatterServers(
      value.formatters,
      source,
      '$.formatters',
      diagnostics
    )
    if (formatters) document.formatters = formatters
  } else if (value.formatters !== undefined) {
    diagnostic(diagnostics, source, '$.formatters', 'formatters must be a boolean or object')
  }
  if (value.formatterOverrides !== undefined) {
    const overrides = normalizeFormatterOverrides(value.formatterOverrides)
    if (Object.keys(overrides).length > 0) document.formatterOverrides = overrides
  }
  if (value.references !== undefined) {
    const references = normalizeReferences(value.references)
    if (references.length > 0) document.references = references
  }
  const permissions = [
    ...normalizeRuleList(value.permissions, source, '$.permissions', diagnostics),
    ...normalizeRuleList(value.permissionRules, source, '$.permissionRules', diagnostics)
  ]
  if (permissions.length > 0) document.permissions = permissions
  const mcp = [
    ...normalizeMcpServers(value.mcpServers, source, '$.mcpServers', diagnostics),
    ...normalizeMcpServers(value.mcp, source, '$.mcp', diagnostics)
  ]
  if (mcp.length > 0) document.mcp = mcp
  if (Array.isArray(value.agents)) document.agents = value.agents
  if (value.providers !== undefined) {
    const providers = normalizeProviders(value.providers, source, '$.providers', diagnostics)
    if (providers) document.providers = providers
  }
  if (Array.isArray(value.plugins)) {
    const plugins = strings(value.plugins)
      .map((entry) => entry.trim())
      .filter(Boolean)
    if (plugins.length > 0) document.plugins = plugins
  }
  if (value.commands !== undefined) {
    const commands = normalizeCommands(value.commands, source, '$.commands', diagnostics)
    if (commands) document.commands = commands
  }
  if (Array.isArray(value.skills)) {
    const skills: string[] = []
    for (const entry of strings(value.skills)) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      if (/^https?:\/\//i.test(trimmed)) {
        diagnostic(diagnostics, source, '$.skills', 'URL-based skills are not supported', 'warning')
        continue
      }
      skills.push(trimmed)
    }
    if (skills.length > 0) document.skills = [...new Set(skills)]
  }
  if (value.retry !== undefined) {
    const retry = normalizeRetry(value.retry, source, diagnostics)
    if (retry) document.retry = retry
  }
  if (value.toolOutput !== undefined) {
    const toolOutput = normalizeToolOutput(value.toolOutput, source, diagnostics)
    if (toolOutput) document.toolOutput = toolOutput
  }
  if (value.subagentDepth !== undefined) {
    const depth = value.subagentDepth
    if (typeof depth === 'number' && Number.isInteger(depth) && depth >= 0 && depth <= 5) {
      document.subagentDepth = depth
    } else {
      diagnostic(
        diagnostics,
        source,
        '$.subagentDepth',
        'subagentDepth must be an integer between 0 and 5',
        'warning'
      )
    }
  }
  if (value.environment !== undefined) {
    const environment = normalizeEnvironment(value.environment, source, diagnostics)
    if (environment) document.environment = environment
  }
  if (typeof value.systemPrompt === 'string' && value.systemPrompt.trim()) {
    document.systemPrompt = value.systemPrompt.trim().slice(0, 20_000)
  } else if (value.systemPrompt !== undefined) {
    diagnostic(diagnostics, source, '$.systemPrompt', 'systemPrompt must be a string')
  }
  return { document, diagnostics }
}
