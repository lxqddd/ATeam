import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function writeTextAtomic(
  filePath: string,
  content: string,
  mode = 0o600
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
  try {
    await fs.writeFile(tempPath, content, { mode })
    await fs.rename(tempPath, filePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode = 0o600
): Promise<void> {
  await writeTextAtomic(filePath, JSON.stringify(value, null, 2), mode)
}

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}
