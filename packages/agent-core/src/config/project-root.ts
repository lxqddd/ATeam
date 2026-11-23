import fs from 'node:fs/promises'
import path from 'node:path'

export async function findProjectRoot(workspacePath: string): Promise<string> {
  let directory = path.resolve(workspacePath)
  for (;;) {
    try {
      const stat = await fs.stat(path.join(directory, '.git'))
      if (stat.isDirectory() || stat.isFile()) return directory
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(directory)
    if (parent === directory) return path.resolve(workspacePath)
    directory = parent
  }
}
