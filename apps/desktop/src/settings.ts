import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ProviderConfig, ProviderKind } from '@ateam/shared' with { "resolution-mode": "import" }

interface StoredSettings {
  provider?: {
    kind: ProviderKind
    model: string
  }
  /** Base64 of the OS-keychain-encrypted API key. Never written in plaintext. */
  secret?: string
}

export interface ProviderInput {
  kind: ProviderKind
  model: string
  apiKey?: string
}

const file = () => path.join(app.getPath('userData'), 'settings.json')

function read(): StoredSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as StoredSettings
  } catch {
    return {}
  }
}

function write(settings: StoredSettings) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 })
}

export function providerConfig(): ProviderConfig | null {
  const { provider, secret } = read()
  if (!provider || !secret) return null
  return { kind: provider.kind, model: provider.model, hasApiKey: true }
}

export function saveProvider(input: ProviderInput): ProviderConfig {
  const current = read()
  let secret = current.secret
  if (input.apiKey !== undefined && input.apiKey !== '') {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统钥匙串不可用，无法安全保存 API Key')
    }
    secret = safeStorage.encryptString(input.apiKey).toString('base64')
  }
  if (!secret) throw new Error('请填写 API Key')
  write({ provider: { kind: input.kind, model: input.model }, secret })
  return { kind: input.kind, model: input.model, hasApiKey: true }
}

export function apiKey(): string | undefined {
  const { secret } = read()
  if (!secret) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(secret, 'base64'))
  } catch {
    return undefined
  }
}

/** Environment for the kernel process; the OpenCode provider reads its key from here. */
export function kernelEnv(): Record<string, string> {
  const key = apiKey()
  if (!key) return {}
  return { OPENCODE_API_KEY: key }
}

/** Kernel config for the default model, or undefined when no provider is configured. */
export function kernelConfig(): { model: string } | undefined {
  const provider = read().provider
  if (!provider) return undefined
  return { model: `${provider.kind}/${provider.model}` }
}
