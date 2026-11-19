#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { parseArgs } from "util"

const root = path.resolve(import.meta.dirname, "../../..")
const snapshot = path.join(root, "packages/core/schema.json")
const tsDir = path.join(root, "packages/core/src/database/migration")
const registry = path.join(root, "packages/core/src/database/migration.gen.ts")
const schema = path.join(root, "packages/core/src/database/schema.gen.ts")
const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    check: { type: "boolean" },
    name: { type: "string" },
  },
})

if (args.values.check) {
  await check()
  process.exit(0)
}

await generate()

async function generate() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-migration-"))
  const incremental = path.join(temporary, "incremental")
  const full = path.join(temporary, "full")
  try {
    await fs.mkdir(incremental)
    await fs.mkdir(path.join(incremental, "baseline"))
    await fs.copyFile(snapshot, path.join(incremental, "baseline/snapshot.json"))
    await drizzle(temporary, incremental, args.values.name)

    const generated = await generatedMigrations(incremental)
    if (generated.length > 1) throw new Error(`Expected one generated migration, found ${generated.length}.`)
    const name = generated[0]
    if (name) {
      const target = path.join(tsDir, `${name}.ts`)
      if (existsSync(target)) throw new Error(`Database migration already exists: ${name}`)
      await fs.writeFile(
        target,
        await formatTypescript(
          renderMigration(name, await fs.readFile(path.join(incremental, name, "migration.sql"), "utf8")),
        ),
      )
      await fs.writeFile(
        snapshot,
        await formatJson(await fs.readFile(path.join(incremental, name, "snapshot.json"), "utf8")),
      )
    }

    await fs.mkdir(full)
    await drizzle(temporary, full, "schema")
    await fs.writeFile(schema, await formatTypescript(renderSchema(await generatedSql(full))))
    await fs.writeFile(registry, await formatTypescript(renderRegistry(await typescriptMigrations())))
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function check() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-core-migration-check-"))
  const incremental = path.join(temporary, "incremental")
  const full = path.join(temporary, "full")
  try {
    await fs.mkdir(incremental)
    await fs.mkdir(path.join(incremental, "baseline"))
    await fs.copyFile(snapshot, path.join(incremental, "baseline/snapshot.json"))
    await drizzle(temporary, incremental)
    if ((await generatedMigrations(incremental)).length > 0) {
      throw new Error(
        "Core schema has ungenerated database migrations. Run `node --import tsx script/migration.ts` from packages/core.",
      )
    }

    await fs.mkdir(full)
    await drizzle(temporary, full, "schema")
    if ((await fs.readFile(schema, "utf8")) !== (await formatTypescript(renderSchema(await generatedSql(full))))) {
      throw new Error("Current database schema is stale. Run `node --import tsx script/migration.ts` from packages/core.")
    }

    const migrations = await typescriptMigrations()
    if ((await fs.readFile(registry, "utf8")) !== (await formatTypescript(renderRegistry(migrations)))) {
      throw new Error("Database migration registry is stale. Run `node --import tsx script/migration.ts` from packages/core.")
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

async function drizzle(temporary: string, output: string, name?: string) {
  const config = path.join(temporary, `${path.basename(output)}.config.ts`)
  await fs.writeFile(
    config,
    `import config from ${JSON.stringify(pathToFileURL(path.join(root, "packages/core/drizzle.config.ts")).href)}

export default { ...config, out: ${JSON.stringify(output)} }
`,
  )
  const child = spawnSync(
    "pnpm",
    ["exec", "drizzle-kit", "generate", "--config", config, ...(name ? ["--name", name] : [])],
    {
      cwd: path.join(root, "packages/core"),
      stdio: "inherit",
    },
  )
  if (child.status !== 0) throw new Error(`Drizzle generation failed with exit code ${child.status}.`)
}

async function generatedMigrations(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const found: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (await fs.access(path.join(directory, entry.name, "migration.sql")).then(() => true, () => false))
      found.push(entry.name)
  }
  return found.sort()
}

async function generatedSql(directory: string) {
  const generated = await generatedMigrations(directory)
  if (generated.length !== 1) throw new Error(`Expected one full schema migration, found ${generated.length}.`)
  return fs.readFile(path.join(directory, generated[0]!, "migration.sql"), "utf8")
}

async function typescriptMigrations() {
  return (await fs.readdir(tsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => path.basename(entry.name, ".ts"))
    .sort()
}

function renderMigration(name: string, sql: string) {
  return `import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: ${JSON.stringify(name)},
  up(tx) {
    return Effect.gen(function* () {
${renderStatements(sql)}
    })
  },
}

export default migration
`
}

function renderSchema(sql: string) {
  return `import { Effect } from "effect"
import type { DatabaseMigration } from "./migration.js"

const schema: Omit<DatabaseMigration.Migration, "id"> = {
  up(tx) {
    return Effect.gen(function* () {
${renderStatements(sql)}
    })
  },
}

export default schema
`
}

function renderStatements(sql: string) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
    .map(renderRun)
    .join("\n")
}

function renderRun(statement: string) {
  const lines = statement.replaceAll("\t", "  ").split("\n")
  if (lines.length === 1) return `      yield* tx.run(\`${escapeTemplate(lines[0])}\`)`
  return `      yield* tx.run(\`\n${lines.map((line) => `        ${escapeTemplate(line)}`).join("\n")}\n      \`)`
}

function escapeTemplate(line: string) {
  return line.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
}

async function formatTypescript(input: string) {
  const prettier = await import("prettier")
  const typescript = await import("prettier/plugins/typescript")
  const estree = await import("prettier/plugins/estree")
  return prettier.format(input, {
    parser: "typescript",
    plugins: [typescript.default, estree.default],
    semi: false,
    printWidth: 120,
  })
}

// Drizzle emits every array multi-line; format the snapshot so regeneration
// diffs stay minimal against the prettier-styled checked-in copy.
async function formatJson(input: string) {
  const prettier = await import("prettier")
  const babel = await import("prettier/plugins/babel")
  const estree = await import("prettier/plugins/estree")
  return prettier.format(input, {
    parser: "json",
    plugins: [babel.default, estree.default],
    printWidth: 120,
  })
}

function renderRegistry(names: string[]) {
  return `import type { DatabaseMigration } from "./migration.js"
${names.map((name, index) => `import m${index.toString().padStart(2, "0")} from "./migration/${name}.js"`).join("\n")}

export const migrations = [
${names.map((_, index) => `  m${index.toString().padStart(2, "0")},`).join("\n")}
] satisfies DatabaseMigration.Migration[]
`
}
