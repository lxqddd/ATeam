import fs from 'node:fs/promises'
import path from 'node:path'
import type { SessionMeta } from '@ateam/shared'
import { readJsonFile, writeJsonAtomic } from '../../atomic-json'
import { isRecord, renameCorruptFile, type SessionFile, type SessionIndex } from './io-types'
import type { SessionRecord, SessionStorage } from './types'

export class JsonSessionStorage implements SessionStorage {
  private readonly root: string
  private readonly indexFile: string
  private readonly metas = new Map<string, SessionMeta>()
  private readonly writeQueues = new Map<string, Promise<void>>()
  private indexQueue: Promise<void> | null = null

  constructor(root: string) {
    this.root = root
    this.indexFile = path.join(root, 'index.json')
  }

  async init(): Promise<SessionRecord[]> {
    await fs.mkdir(this.root, { recursive: true })
    const index = await readJsonFile<SessionIndex>(this.indexFile)
    const byId = new Map<string, SessionMeta>()
    for (const entry of index?.sessions ?? []) byId.set(entry.id, entry)
    for (const entry of await this.scanSessions()) byId.set(entry.id, entry)
    const entries = [...byId.values()]
    const records: SessionRecord[] = []
    for (const entry of entries) {
      const record = await this.loadRecord(entry.id)
      if (record) records.push(record)
    }
    for (const record of records) this.metas.set(record.session.id, record.session)
    await this.writeIndex()
    return records
  }

  persist(record: SessionRecord): Promise<void> {
    const id = record.session.id
    const previous = this.writeQueues.get(id) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const data: SessionFile = {
          version: 1,
          session: record.session,
          messages: record.messages,
          redo: record.redo,
          revert: record.revert,
          preparedCompaction: record.preparedCompaction
        }
        await writeJsonAtomic(path.join(this.root, `${id}.json`), data)
        this.metas.set(id, record.session)
        await this.writeIndex()
      })
    this.writeQueues.set(id, next)
    return next
  }

  async remove(id: string): Promise<void> {
    await this.flush()
    this.metas.delete(id)
    await this.writeIndex()
    await fs.rm(path.join(this.root, `${id}.json`), { force: true }).catch(() => undefined)
  }

  async flush(): Promise<void> {
    await Promise.all([...this.writeQueues.values(), this.indexQueue ?? Promise.resolve()])
  }

  async close(): Promise<void> {
    await this.flush()
  }

  private async scanSessions(): Promise<SessionMeta[]> {
    const sessions: SessionMeta[] = []
    let files: string[] = []
    try {
      files = await fs.readdir(this.root)
    } catch {
      return sessions
    }
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'index.json') continue
      const record = await this.loadRecord(file.slice(0, -5))
      if (record) sessions.push(record.session)
    }
    return sessions
  }

  private async loadRecord(id: string): Promise<SessionRecord | null> {
    const filePath = path.join(this.root, `${id}.json`)
    const data = await readJsonFile<SessionFile>(filePath)
    if (!data || !isRecord(data)) {
      await renameCorruptFile(filePath)
      return null
    }
    return {
      session: data.session,
      messages: data.messages,
      redo: data.redo,
      revert: data.revert,
      preparedCompaction: data.preparedCompaction
    }
  }

  private async writeIndex(): Promise<void> {
    const previous = this.indexQueue ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const data: SessionIndex = {
          version: 1,
          sessions: [...this.metas.values()]
        }
        await writeJsonAtomic(this.indexFile, data)
      })
    this.indexQueue = next
    await next
  }
}
