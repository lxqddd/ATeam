// Kept as a named helper for callers that opted out of Bun's default fetch idle timeout.
// Node's fetch has no equivalent deadline, so this is a passthrough.
export const noTimeoutFetch: typeof fetch = fetch
