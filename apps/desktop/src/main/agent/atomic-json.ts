import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode = 0o600
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), { mode })
  await fs.rename(tempPath, filePath)
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}
