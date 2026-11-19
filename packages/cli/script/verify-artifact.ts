import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { collectFiles } from "./files"

const forbidden = [
  "@napi-rs/canvas",
  "@fontsource/commit-mono",
  "@fontsource/noto-sans",
  "SimulationPng",
  "frontend/png",
  "Failed to register screenshot font",
  "commit-mono-latin-400-normal",
  "noto-sans-symbols-symbols-400-normal",
  "noto-sans-math-math-400-normal",
  "CommitMono-400-Regular.otf",
  "NotoSansSymbols.ttf",
  "src/frontend/png.ts",
  "skia.darwin-",
  "skia.linux-",
  "skia.win32-",
]
const overlap = Math.max(...forbidden.map((value) => value.length)) - 1

export async function verifyArtifact(target: string) {
  const files = await artifactFiles(target)
  if (files.length === 0) throw new Error(`Artifact contains no published files: ${target}`)
  for (const file of files) await scan(file)
}

export function verifySimulationGraph(inputs: Iterable<string>) {
  const modules = Array.from(inputs, (input) => input.replaceAll("\\", "/"))
  const required = ["/simulation/src/control-server.ts"]
  const missing = required.filter((input) => !modules.some((module) => module.endsWith(input)))
  if (missing.length > 0) throw new Error(`Build graph is missing simulation bridge inputs: ${missing.join(", ")}`)
}

async function artifactFiles(target: string): Promise<string[]> {
  if ((await stat(target)).isFile()) return [target]
  return (await collectFiles(target)).map((file) => path.join(target, file))
}

async function scan(file: string) {
  let trailing = ""
  for await (const chunk of createReadStream(file)) {
    const text = trailing + Buffer.from(chunk as Buffer).toString("latin1")
    const leaked = forbidden.find((marker) => text.includes(marker))
    if (leaked) throw new Error(`Artifact file ${file} contains forbidden simulation payload: ${leaked}`)
    trailing = text.slice(-overlap)
  }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const target = process.argv[2]
  if (!target) throw new Error("Usage: node script/verify-artifact.ts <file-or-directory>")
  await verifyArtifact(target)
}
