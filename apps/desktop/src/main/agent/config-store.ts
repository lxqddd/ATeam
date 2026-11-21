import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentConfig } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from './atomic-json'

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  snapshots: true,
  instructions: []
}

function configFile(userDataPath: string): string {
  return path.join(userDataPath, 'agent', 'config.json')
}

function normalizeInstructions(value: unknown): string[] {
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

function normalizeConfig(value: unknown): AgentConfig {
  if (!value || typeof value !== 'object') return { ...DEFAULT_AGENT_CONFIG }
  const config = value as Partial<AgentConfig>
  return {
    snapshots: typeof config.snapshots === 'boolean' ? config.snapshots : true,
    instructions: normalizeInstructions(config.instructions)
  }
}

export async function readAgentConfig(userDataPath: string): Promise<AgentConfig> {
  return normalizeConfig(await readJsonFile<unknown>(configFile(userDataPath)))
}

export class AgentConfigStore {
  private config: AgentConfig = { ...DEFAULT_AGENT_CONFIG }

  constructor(private readonly userDataPath: string) {}

  async init(): Promise<void> {
    this.config = await readAgentConfig(this.userDataPath)
  }

  get(): AgentConfig {
    return {
      snapshots: this.config.snapshots,
      instructions: [...this.config.instructions]
    }
  }

  async update(patch: Partial<AgentConfig>): Promise<AgentConfig> {
    this.config = normalizeConfig({ ...this.config, ...patch })
    await fs.mkdir(path.dirname(configFile(this.userDataPath)), { recursive: true })
    await writeJsonAtomic(configFile(this.userDataPath), this.config)
    return this.get()
  }
}
