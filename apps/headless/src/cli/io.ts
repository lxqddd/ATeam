/** Injectable process boundaries shared by the CLI command groups. */
export interface CliIo {
  cwd: string
  stdinIsTTY: boolean
  stdout(text: string): void
  stderr(text: string): void
  readStdin(): Promise<string>
}

export function createCliIo(overrides: Partial<CliIo> = {}): CliIo {
  return {
    cwd: process.cwd(),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: async () => {
      let text = ''
      for await (const chunk of process.stdin) text += String(chunk)
      return text
    },
    ...overrides
  }
}
