import { OpenApi } from "effect/http-api"
import { format } from "prettier"
import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "url"
import { ClientApi } from "../src/client.js"
import { stabilizeOpenApi } from "./openapi-stabilize.js"

const document = await format(JSON.stringify(stabilizeOpenApi(OpenApi.fromApi(ClientApi)), null, 2), {
  parser: "json",
  printWidth: 120,
})
const target = fileURLToPath(new URL("../openapi.json", import.meta.url))

if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== document) {
    console.error("Generated OpenAPI document is stale. Run `node --import tsx script/generate-openapi.ts` from packages/protocol.")
    process.exit(1)
  }
  process.exit(0)
}

await writeFile(target, document)
