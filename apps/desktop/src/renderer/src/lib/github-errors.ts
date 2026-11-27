import { errorMessage } from './errors'

// Electron IPC drops custom error properties, so the main process prefixes the
// message with a stable GITHUB_* code; map that code back to a translated hint.
const GITHUB_ERROR_KEYS: Record<string, string> = {
  GITHUB_TOKEN_MISSING: 'chat.githubErrorTokenMissing',
  GITHUB_UNAUTHORIZED: 'chat.githubErrorUnauthorized',
  GITHUB_FORBIDDEN: 'chat.githubErrorForbidden',
  GITHUB_RATE_LIMITED: 'chat.githubErrorRateLimited',
  GITHUB_NOT_FOUND: 'chat.githubErrorNotFound',
  GITHUB_UNPROCESSABLE: 'chat.githubErrorUnprocessable',
  GITHUB_NETWORK_ERROR: 'chat.githubErrorNetwork',
  GITHUB_INVALID_RESPONSE: 'chat.githubErrorInvalidResponse',
  GITHUB_INVALID_REF: 'chat.githubErrorInvalidRef',
  GITHUB_API_ERROR: 'chat.githubErrorApi'
}

/** Stable GITHUB_* code embedded in an IPC error message, if any. */
export function githubErrorCode(error: unknown): string | null {
  const match = errorMessage(error).match(/\b(GITHUB_[A-Z_]+)\b/)
  return match ? match[1] : null
}

/** Translation key for a GitHub IPC error, or null when it is another failure. */
export function githubErrorKey(error: unknown): string | null {
  const code = githubErrorCode(error)
  return code ? (GITHUB_ERROR_KEYS[code] ?? null) : null
}

/** Localized GitHub error text; falls back to the raw message. */
export function githubErrorMessage(error: unknown, translate: (key: string) => string): string {
  const key = githubErrorKey(error)
  return key ? translate(key) : errorMessage(error)
}
