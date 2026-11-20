function redact(message: string): string {
  return message
    .replace(/(server password\s+)\S+/gi, '$1[redacted]')
    .replace(/\b(?:sk|oc_sk)-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [redacted]')
    .slice(0, 1000)
}

export function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'Request interrupted'
    const message = redact(error.message)
    if (/NO_MODEL/.test(message)) return 'No model configured. Add a model in Settings → Models.'
    if (/MODEL_NOT_FOUND/.test(message)) return 'The selected model is no longer configured.'
    if (
      /401|403|forbidden|unauthorized|authentication|invalid.*api.?key|x-api-key/i.test(message)
    ) {
      return 'Model authentication failed. Check the provider API key.'
    }
    if (/429|rate limit|too many requests/i.test(message)) {
      return 'The provider is rate limiting requests. Try again shortly.'
    }
    if (/404|model.*not found/i.test(message)) {
      return 'The provider does not recognize this model ID.'
    }
    if (/context|too long|maximum context/i.test(message)) {
      return 'The conversation exceeds the model context window. Start a new chat or shorten the input.'
    }
    if (/fetch failed|ENOTFOUND|ECONN|network|socket/i.test(message)) {
      return 'Network error while contacting the model provider.'
    }
    if (/\b5\d\d\b|server error/i.test(message)) {
      return 'The model provider returned a server error.'
    }
    return message || 'The agent run failed.'
  }

  return redact(String(error)) || 'The agent run failed.'
}
