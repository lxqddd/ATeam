import fs from 'node:fs/promises'
import path from 'node:path'

export async function restoreLegacySessionBackups(userDataPath: string): Promise<number> {
  const sessionsDirectory = path.join(userDataPath, 'agent', 'sessions')
  let restored = 0
  let files: string[] = []
  try {
    files = await fs.readdir(sessionsDirectory)
  } catch {
    return 0
  }
  for (const file of files) {
    if (!file.endsWith('.json.migrated')) continue
    const source = path.join(sessionsDirectory, file)
    const target = path.join(sessionsDirectory, file.slice(0, -'.migrated'.length))
    const existing = await fs.stat(target).catch(() => null)
    if (existing) continue
    await fs.rename(source, target).catch(() => undefined)
    restored += 1
  }

  const databaseFile = path.join(userDataPath, 'agent', 'sessions.db')
  const existingDatabase = await fs.stat(databaseFile).catch(() => null)
  if (existingDatabase) {
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(databaseFile)
    try {
      database.prepare("DELETE FROM meta WHERE key = 'legacy_imported'").run()
    } finally {
      database.close()
    }
  }
  return restored
}
