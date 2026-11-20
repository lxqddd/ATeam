import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** Append-only audit trail for permission requests and replies. */
export function audit(event: Record<string, unknown>) {
  try {
    const file = path.join(app.getPath('userData'), 'audit', 'permissions.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 })
  } catch (error) {
    console.warn('Failed to write permission audit entry:', error)
  }
}
