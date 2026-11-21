import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function resolveExecutable(
  bin: string,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  const candidates: string[] = []
  if (bin.includes('/') || bin.includes('\\')) {
    candidates.push(path.isAbsolute(bin) ? bin : path.resolve(cwd, bin))
  } else {
    candidates.push(
      path.join(cwd, 'node_modules', '.bin', platform === 'win32' ? `${bin}.cmd` : bin)
    )
    const pathEntries = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
    for (const entry of pathEntries) {
      if (platform === 'win32') {
        candidates.push(
          path.join(entry, `${bin}.cmd`),
          path.join(entry, `${bin}.exe`),
          path.join(entry, bin)
        )
      } else {
        candidates.push(path.join(entry, bin))
      }
    }
  }

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return candidate
    } catch {
      /* keep looking */
    }
  }
  return null
}
