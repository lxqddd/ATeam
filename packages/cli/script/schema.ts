import { Schema } from "effect"
import { readFile, writeFile } from "node:fs/promises"
import { format } from "prettier"
import { Info, SchemaURL } from "../src/config/schema"

const target = process.argv[2]
if (!target) throw new Error("A schema output path is required")

const document = Schema.toJsonSchemaDocument(Info, { onExcessProperty: "error" })
const content = await format(
  JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SchemaURL,
    ...document.schema,
    ...(Object.keys(document.definitions).length ? { $defs: document.definitions } : {}),
  }),
  { parser: "json", printWidth: 120 },
)

if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== content) {
    console.error("Generated CLI config schema is stale. Run `node --import tsx script/schema.ts` from packages/cli.")
    process.exit(1)
  }
  process.exit(0)
}

await writeFile(target, content)
