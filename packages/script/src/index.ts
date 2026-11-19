import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"

const env = {
  OPENCODE_CHANNEL: process.env["OPENCODE_CHANNEL"],
  OPENCODE_VERSION: process.env["OPENCODE_VERSION"],
}
const CHANNEL = (() => {
  if (env.OPENCODE_CHANNEL) return env.OPENCODE_CHANNEL
  if (env.OPENCODE_VERSION && !env.OPENCODE_VERSION.startsWith("0.0.0-")) return "latest"
  const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim()
  if (!branch) return "detached"
  const channel = branch.replace(/[^a-zA-Z0-9._-]/g, "-")
  if (/^[a-zA-Z0-9]/.test(channel)) return channel
  return `branch-${channel}`
})()
const IS_PREVIEW = CHANNEL !== "latest"

// The release workflow's plan job owns release versions; builds only read them.
const VERSION = (() => {
  if (env.OPENCODE_VERSION) return env.OPENCODE_VERSION
  if (!IS_PREVIEW) throw new Error("OPENCODE_VERSION is required for latest-channel builds")
  return `0.0.0-${CHANNEL}-${previewBuildNumber()}`
})()

function previewBuildNumber() {
  const runNumber = process.env["GITHUB_RUN_NUMBER"]
  if (!runNumber) return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  const runAttempt = process.env["GITHUB_RUN_ATTEMPT"]
  if (runAttempt && runAttempt !== "1") return `${runNumber}.${runAttempt}`
  return runNumber
}

const bot = ["actions-user", "opencode", "opencode-agent[bot]"]
const teamPath = path.resolve(import.meta.dirname, "../TEAM_MEMBERS")
const team = [
  ...(await readFile(teamPath, "utf8")).split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#")),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get team() {
    return team
  },
}
console.log(`opencode script`, JSON.stringify(Script, null, 2))
