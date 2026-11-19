import { readFile } from "node:fs/promises"
import { Schema } from "effect"

// A floor, not equality: guards against an error page or a truncated body
// that still parses as a small object.
const MINIMUM_PROVIDERS = 100
export const committedSnapshot = new URL("../src/models-dev/snapshot.txt", import.meta.url)

export async function fetchModelsSnapshot() {
  const { ModelsDev } = await import("../src/models-dev")
  const source = process.env.OPENCODE_MODELS_URL || "https://models.opencode.ai"
  const url = `${source}${ModelsDev.catalogPath}`
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${url} returned ${response.status} ${response.statusText}`)
  return validateModelsSnapshot(trim(await response.text()))
}

// Model fields opencode never reads. Dropping them keeps the bundled copy small; every
// other field, including ones models.dev adds later, is kept as published.
const UNUSED_MODEL_FIELDS = new Set([
  "description",
  "canonical_id",
  "knowledge",
  "last_updated",
  "deprecation_date",
  "open_weights",
  "metadata",
])

const Catalog = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.StructWithRest(
      Schema.Struct({ models: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown)) }),
      [Schema.Record(Schema.String, Schema.Unknown)],
    ),
  ),
)

function trim(text: string) {
  const catalog = Schema.decodeUnknownSync(Catalog)(text)
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(catalog).map(([id, provider]) => [
        id,
        {
          ...provider,
          models: Object.fromEntries(
            Object.entries(provider.models).map(([modelID, model]) => [
              modelID,
              Object.fromEntries(Object.entries(model).filter(([key]) => !UNUSED_MODEL_FIELDS.has(key))),
            ]),
          ),
        },
      ]),
    ),
  )
}

async function validateModelsSnapshot(text: string) {
  const providers = Object.keys(Schema.decodeUnknownSync(Catalog)(text)).length
  if (providers < MINIMUM_PROVIDERS)
    throw new Error(`models.dev catalog has ${providers} providers, expected at least ${MINIMUM_PROVIDERS}`)
  return { text, providers }
}

export async function bundledModelsSnapshot() {
  const file = process.env.OPENCODE_MODELS_SNAPSHOT
  if (!file) return readFile(committedSnapshot, "utf8")
  const snapshot = await validateModelsSnapshot(await readFile(file, "utf8"))
  console.log(`bundling models.dev catalog from ${file} (${snapshot.providers} providers)`)
  return snapshot.text
}
