export * as Provider from "./provider.js"

import { Context, Effect, Layer, Option, Schema, Stream, Struct } from "effect"
import { Provider } from "@ateam/schema/provider"
import { Model } from "@ateam/schema/model"
import { makeLocationNode } from "@ateam/util/effect/app-node"
import { HttpTimeout, type ProviderPackage } from "@ateam/ai/effect"
import { Npm } from "@ateam/util/npm"
import type { DeepMutable } from "./schema.js"
import { importModule, resolveModule } from "@ateam/util/runtime-import"
import { Bus } from "./bus.js"
import { Integration } from "./integration.js"
import { State } from "./state.js"
import { IntegrationConnection } from "./integration/connection.js"
import { Credential } from "@ateam/schema/credential"
import { Location } from "./location.js"
import { freeze } from "immer"
import { AISDKNative } from "./aisdk-native.js"

export { AISDK_PREFIX, aisdk, isAISDK, mergeHeaders, mergeOverlay, packageName } from "./aisdk-native.js"

export const ID = Provider.ID
export type ID = typeof ID.Type

export class LoadError extends Schema.TaggedError<LoadError>()("Provider.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@ateam/ai/providers/alibaba", () => import("@ateam/ai/providers/alibaba")],
  ["@ateam/ai/providers/alibaba/chat", () => import("@ateam/ai/providers/alibaba/chat")],
  ["@ateam/ai/providers/alibaba/messages", () => import("@ateam/ai/providers/alibaba/messages")],
  ["@ateam/ai/providers/alibaba/responses", () => import("@ateam/ai/providers/alibaba/responses")],
  ["@ateam/ai/providers/alibaba/images", () => import("@ateam/ai/providers/alibaba/images")],
  ["@ateam/ai/providers/alibaba/embeddings", () => import("@ateam/ai/providers/alibaba/embeddings")],
  ["@ateam/ai/providers/amazon-bedrock", () => import("@ateam/ai/providers/amazon-bedrock")],
  ["@ateam/ai/providers/amazon-bedrock/mantle", () => import("@ateam/ai/providers/amazon-bedrock/mantle")],
  [
    "@ateam/ai/providers/amazon-bedrock/mantle/chat",
    () => import("@ateam/ai/providers/amazon-bedrock/mantle/chat"),
  ],
  [
    "@ateam/ai/providers/amazon-bedrock/mantle/messages",
    () => import("@ateam/ai/providers/amazon-bedrock/mantle/messages"),
  ],
  [
    "@ateam/ai/providers/amazon-bedrock/mantle/responses",
    () => import("@ateam/ai/providers/amazon-bedrock/mantle/responses"),
  ],
  ["@ateam/ai/providers/anthropic", () => import("@ateam/ai/providers/anthropic")],
  ["@ateam/ai/providers/anthropic-compatible", () => import("@ateam/ai/providers/anthropic-compatible")],
  ["@ateam/ai/providers/azure", () => import("@ateam/ai/providers/azure")],
  ["@ateam/ai/providers/azure/chat", () => import("@ateam/ai/providers/azure/chat")],
  ["@ateam/ai/providers/azure/responses", () => import("@ateam/ai/providers/azure/responses")],
  ["@ateam/ai/providers/azure/images", () => import("@ateam/ai/providers/azure/images")],
  ["@ateam/ai/providers/azure/embeddings", () => import("@ateam/ai/providers/azure/embeddings")],
  ["@ateam/ai/providers/azure/messages", () => import("@ateam/ai/providers/azure/messages")],
  ["@ateam/ai/providers/baseten", () => import("@ateam/ai/providers/baseten")],
  ["@ateam/ai/providers/baseten/decisions", () => import("@ateam/ai/providers/baseten/decisions")],
  ["@ateam/ai/providers/byteplus/videos", () => import("@ateam/ai/providers/byteplus/videos")],
  ["@ateam/ai/providers/cerebras", () => import("@ateam/ai/providers/cerebras")],
  ["@ateam/ai/providers/cloudflare-ai-gateway", () => import("@ateam/ai/providers/cloudflare-ai-gateway")],
  [
    "@ateam/ai/providers/cloudflare-ai-gateway/decisions",
    () => import("@ateam/ai/providers/cloudflare-ai-gateway/decisions"),
  ],
  ["@ateam/ai/providers/cloudflare-workers-ai", () => import("@ateam/ai/providers/cloudflare-workers-ai")],
  [
    "@ateam/ai/providers/cloudflare-workers-ai/decisions",
    () => import("@ateam/ai/providers/cloudflare-workers-ai/decisions"),
  ],
  [
    "@ateam/ai/providers/cloudflare-workers-ai/images",
    () => import("@ateam/ai/providers/cloudflare-workers-ai/images"),
  ],
  ["@ateam/ai/providers/cohere", () => import("@ateam/ai/providers/cohere")],
  ["@ateam/ai/providers/cohere/chat", () => import("@ateam/ai/providers/cohere/chat")],
  ["@ateam/ai/providers/cohere/embeddings", () => import("@ateam/ai/providers/cohere/embeddings")],
  ["@ateam/ai/providers/deepinfra", () => import("@ateam/ai/providers/deepinfra")],
  ["@ateam/ai/providers/deepinfra/embeddings", () => import("@ateam/ai/providers/deepinfra/embeddings")],
  ["@ateam/ai/providers/deepseek", () => import("@ateam/ai/providers/deepseek")],
  ["@ateam/ai/providers/digitalocean", () => import("@ateam/ai/providers/digitalocean")],
  ["@ateam/ai/providers/digitalocean/decisions", () => import("@ateam/ai/providers/digitalocean/decisions")],
  ["@ateam/ai/providers/digitalocean/embeddings", () => import("@ateam/ai/providers/digitalocean/embeddings")],
  ["@ateam/ai/providers/digitalocean/images", () => import("@ateam/ai/providers/digitalocean/images")],
  ["@ateam/ai/providers/digitalocean/responses", () => import("@ateam/ai/providers/digitalocean/responses")],
  ["@ateam/ai/providers/fireworks", () => import("@ateam/ai/providers/fireworks")],
  ["@ateam/ai/providers/fireworks/embeddings", () => import("@ateam/ai/providers/fireworks/embeddings")],
  ["@ateam/ai/providers/google", () => import("@ateam/ai/providers/google")],
  ["@ateam/ai/providers/google/decisions", () => import("@ateam/ai/providers/google/decisions")],
  ["@ateam/ai/providers/google/interactions", () => import("@ateam/ai/providers/google/interactions")],
  ["@ateam/ai/providers/google/embeddings", () => import("@ateam/ai/providers/google/embeddings")],
  ["@ateam/ai/providers/google/images", () => import("@ateam/ai/providers/google/images")],
  ["@ateam/ai/providers/google/videos", () => import("@ateam/ai/providers/google/videos")],
  ["@ateam/ai/providers/google-vertex", () => import("@ateam/ai/providers/google-vertex")],
  ["@ateam/ai/providers/google-vertex/chat", () => import("@ateam/ai/providers/google-vertex/chat")],
  ["@ateam/ai/providers/google-vertex/gemini", () => import("@ateam/ai/providers/google-vertex/gemini")],
  [
    "@ateam/ai/providers/google-vertex/interactions",
    () => import("@ateam/ai/providers/google-vertex/interactions"),
  ],
  ["@ateam/ai/providers/google-vertex/messages", () => import("@ateam/ai/providers/google-vertex/messages")],
  ["@ateam/ai/providers/google-vertex/mistral", () => import("@ateam/ai/providers/google-vertex/mistral")],
  ["@ateam/ai/providers/google-vertex/responses", () => import("@ateam/ai/providers/google-vertex/responses")],
  ["@ateam/ai/providers/google-vertex/embeddings", () => import("@ateam/ai/providers/google-vertex/embeddings")],
  ["@ateam/ai/providers/google-vertex/images", () => import("@ateam/ai/providers/google-vertex/images")],
  ["@ateam/ai/providers/google-vertex-messages", () => import("@ateam/ai/providers/google-vertex-messages")],
  ["@ateam/ai/providers/groq", () => import("@ateam/ai/providers/groq")],
  ["@ateam/ai/providers/meta", () => import("@ateam/ai/providers/meta")],
  ["@ateam/ai/providers/meta/chat", () => import("@ateam/ai/providers/meta/chat")],
  ["@ateam/ai/providers/meta/images", () => import("@ateam/ai/providers/meta/images")],
  ["@ateam/ai/providers/meta/messages", () => import("@ateam/ai/providers/meta/messages")],
  ["@ateam/ai/providers/meta/responses", () => import("@ateam/ai/providers/meta/responses")],
  ["@ateam/ai/providers/minimax", () => import("@ateam/ai/providers/minimax")],
  ["@ateam/ai/providers/minimax/chat", () => import("@ateam/ai/providers/minimax/chat")],
  ["@ateam/ai/providers/minimax/images", () => import("@ateam/ai/providers/minimax/images")],
  ["@ateam/ai/providers/minimax/messages", () => import("@ateam/ai/providers/minimax/messages")],
  ["@ateam/ai/providers/minimax/responses", () => import("@ateam/ai/providers/minimax/responses")],
  ["@ateam/ai/providers/minimax/videos", () => import("@ateam/ai/providers/minimax/videos")],
  ["@ateam/ai/providers/mistral", () => import("@ateam/ai/providers/mistral")],
  ["@ateam/ai/providers/moonshot", () => import("@ateam/ai/providers/moonshot")],
  ["@ateam/ai/providers/moonshot/chat", () => import("@ateam/ai/providers/moonshot/chat")],
  ["@ateam/ai/providers/moonshot/messages", () => import("@ateam/ai/providers/moonshot/messages")],
  ["@ateam/ai/providers/moonshot/responses", () => import("@ateam/ai/providers/moonshot/responses")],
  ["@ateam/ai/providers/openai", () => import("@ateam/ai/providers/openai")],
  ["@ateam/ai/providers/openai/chat", () => import("@ateam/ai/providers/openai/chat")],
  ["@ateam/ai/providers/openai/responses", () => import("@ateam/ai/providers/openai/responses")],
  ["@ateam/ai/providers/openai/images", () => import("@ateam/ai/providers/openai/images")],
  ["@ateam/ai/providers/openai/embeddings", () => import("@ateam/ai/providers/openai/embeddings")],
  ["@ateam/ai/providers/openai-compatible", () => import("@ateam/ai/providers/openai-compatible")],
  [
    "@ateam/ai/providers/openai-compatible/responses",
    () => import("@ateam/ai/providers/openai-compatible/responses"),
  ],
  ["@ateam/ai/providers/openai-compatible/images", () => import("@ateam/ai/providers/openai-compatible/images")],
  [
    "@ateam/ai/providers/openai-compatible/decisions",
    () => import("@ateam/ai/providers/openai-compatible/decisions"),
  ],
  [
    "@ateam/ai/providers/openai-compatible/embeddings",
    () => import("@ateam/ai/providers/openai-compatible/embeddings"),
  ],
  [
    "@ateam/ai/providers/openai-compatible-responses",
    () => import("@ateam/ai/providers/openai-compatible-responses"),
  ],
  ["@ateam/ai/providers/opencode/decisions", () => import("@ateam/ai/providers/opencode/decisions")],
  ["@ateam/ai/providers/openrouter", () => import("@ateam/ai/providers/openrouter")],
  ["@ateam/ai/providers/openrouter/decisions", () => import("@ateam/ai/providers/openrouter/decisions")],
  ["@ateam/ai/providers/openrouter/embeddings", () => import("@ateam/ai/providers/openrouter/embeddings")],
  ["@ateam/ai/providers/openrouter/images", () => import("@ateam/ai/providers/openrouter/images")],
  ["@ateam/ai/providers/openrouter/videos", () => import("@ateam/ai/providers/openrouter/videos")],
  ["@ateam/ai/providers/openrouter/responses", () => import("@ateam/ai/providers/openrouter/responses")],
  ["@ateam/ai/providers/togetherai", () => import("@ateam/ai/providers/togetherai")],
  ["@ateam/ai/providers/typesafe-ai/decisions", () => import("@ateam/ai/providers/typesafe-ai/decisions")],
  ["@ateam/ai/providers/venice", () => import("@ateam/ai/providers/venice")],
  ["@ateam/ai/providers/venice/responses", () => import("@ateam/ai/providers/venice/responses")],
  ["@ateam/ai/providers/volcengine/videos", () => import("@ateam/ai/providers/volcengine/videos")],
  ["@ateam/ai/providers/vercel-ai-gateway", () => import("@ateam/ai/providers/vercel-ai-gateway")],
  ["@ateam/ai/providers/vercel-ai-gateway/chat", () => import("@ateam/ai/providers/vercel-ai-gateway/chat")],
  [
    "@ateam/ai/providers/vercel-ai-gateway/messages",
    () => import("@ateam/ai/providers/vercel-ai-gateway/messages"),
  ],
  [
    "@ateam/ai/providers/vercel-ai-gateway/responses",
    () => import("@ateam/ai/providers/vercel-ai-gateway/responses"),
  ],
  [
    "@ateam/ai/providers/vercel-ai-gateway/decisions",
    () => import("@ateam/ai/providers/vercel-ai-gateway/decisions"),
  ],
  ["@ateam/ai/providers/vercel-ai-gateway/images", () => import("@ateam/ai/providers/vercel-ai-gateway/images")],
  [
    "@ateam/ai/providers/vercel-ai-gateway/embeddings",
    () => import("@ateam/ai/providers/vercel-ai-gateway/embeddings"),
  ],
  ["@ateam/ai/providers/xai", () => import("@ateam/ai/providers/xai")],
  ["@ateam/ai/providers/xai/images", () => import("@ateam/ai/providers/xai/images")],
  ["@ateam/ai/providers/xai/videos", () => import("@ateam/ai/providers/xai/videos")],
  ["@ateam/ai/providers/zai", () => import("@ateam/ai/providers/zai")],
  ["@ateam/ai/providers/zai/chat", () => import("@ateam/ai/providers/zai/chat")],
  ["@ateam/ai/providers/zai/images", () => import("@ateam/ai/providers/zai/images")],
  ["@ateam/ai/providers/zai-coding-plan", () => import("@ateam/ai/providers/zai-coding-plan")],
  ["@ateam/ai/providers/zai-coding-plan/chat", () => import("@ateam/ai/providers/zai-coding-plan/chat")],
  ["@ateam/ai/providers/zai-coding-plan/messages", () => import("@ateam/ai/providers/zai-coding-plan/messages")],
  [
    "@ateam/ai/providers/zai-coding-plan/responses",
    () => import("@ateam/ai/providers/zai-coding-plan/responses"),
  ],
])

/** Native `@ateam/ai/providers/*` entrypoints bundled with Core and loadable by name from config. */
export const builtinPackages: ReadonlySet<string> = new Set(builtins.keys())

export const loadPackage = Effect.fn("Provider.loadPackage")(function* (input: string, npm?: Npm.Interface) {
  const specifier = AISDKNative.packageName(input)
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@ateam/ai/")) return specifier
    try {
      // Node SEA exposes a reduced `import.meta`; resolve only where it exists.
      if (typeof import.meta.resolve !== "function") return undefined
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () => resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

const settingsKeys = Struct.keys(Provider.Settings.schema.fields)
const providerOnlyKeys = settingsKeys.filter((key) => !(key in Model.Settings.schema.fields))

/** The provider options: every settings key OpenCode doesn't read itself. */
export function nativeSettings(settings: Settings) {
  return Struct.omit(settings, settingsKeys)
}

/** Settings a model inherits from its provider. */
export function modelSettings(settings: Settings | undefined) {
  return settings && Struct.omit(settings, providerOnlyKeys)
}

const decodeTimeout = Schema.decodeUnknownOption(HttpTimeout)

/** Applied to `headerTimeout` when provider settings leave it unset or invalid. */
export const DEFAULT_TIMEOUT_MS = 300_000

/**
 * Applied to `chunkTimeout` when provider settings leave it unset or invalid. Some providers, such as DeepSeek, have
 * specifically asked clients to allow at least 15 minutes, because their models can stream nothing for minutes while
 * they reason.
 */
export const DEFAULT_CHUNK_TIMEOUT_MS = 900_000

/** One timeout setting without a default; invalid values are dropped. */
export function timeout(value: unknown) {
  return Option.getOrUndefined(decodeTimeout(value))
}

/** Request timeouts from provider settings, resolved for every route. `timeout` has no default. */
export function timeouts(settings: Readonly<Record<string, unknown>>) {
  return {
    timeout: timeout(settings.timeout),
    headerTimeout: timeout(settings.headerTimeout) ?? DEFAULT_TIMEOUT_MS,
    chunkTimeout: timeout(settings.chunkTimeout) ?? DEFAULT_CHUNK_TIMEOUT_MS,
  }
}

const decodeEncoding = Schema.decodeUnknownOption(Provider.Encoding)

/** Request body encoding from provider or model settings; invalid values are dropped. */
export function encoding(settings: Readonly<Record<string, unknown>>) {
  return Option.getOrUndefined(decodeEncoding(settings.encoding))
}

const decodeTls = Schema.decodeUnknownOption(Provider.Tls)

/** Client certificate from provider settings. An empty `cert` or `key`, such as a missing `{file:}`, leaves it unset. */
export function tls(settings: Readonly<Record<string, unknown>>) {
  const value = Option.getOrUndefined(decodeTls(settings.tls))
  return value?.cert && value.key ? value : undefined
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Compaction = Provider.Compaction
export type Compaction = Provider.Compaction

export const Cache = Provider.Cache
export type Cache = Provider.Cache

export const Transport = Provider.Transport
export type Transport = Provider.Transport

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

export { Event } from "@ateam/schema/provider"

/** Provider metadata owns its drafts; model definitions remain immutable inputs. */
export type Definition = {
  readonly provider: Info
  readonly models: ReadonlyMap<Model.ID, Model.Info>
  readonly sourceConnection?: IntegrationConnection.Info
}

export interface Editor {
  readonly list: () => readonly Definition[]
  readonly get: (providerID: ID) => Definition | undefined
  readonly add: (definition: {
    readonly info: Info
    readonly models: readonly Model.Info[]
    readonly sourceConnection?: IntegrationConnection.Info
  }) => void
  readonly update: (providerID: ID, update: (provider: MutableInfo) => void) => void
  readonly remove: (providerID: ID) => void
  readonly models: {
    readonly set: (providerID: ID, models: readonly Model.Info[]) => void
    readonly update: (providerID: ID, modelID: Model.ID, update: (model: DeepMutable<Model.Info>) => void) => void
    readonly remove: (providerID: ID, modelID: Model.ID) => void
  }
}

export interface Snapshot {
  readonly records: ReadonlyMap<ID, Definition>
  readonly available: readonly Definition[]
  readonly providers: readonly Info[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (providerID: ID) => Effect.Effect<Info | undefined>
  readonly all: () => Effect.Effect<readonly Info[]>
  readonly available: () => Effect.Effect<readonly Info[]>
  /** Internal definition/access snapshot; raw model inventories never cross the HTTP API. */
  readonly snapshot: () => Effect.Effect<Snapshot>
}

export class Service extends Context.Service<Service, Interface>()("@ateam/Provider") {}

// Every location references the same index for a shared immutable definition array.
const definitions = new WeakMap<readonly Model.Info[], Map<ID, ReadonlyMap<Model.ID, Model.Info>>>()
function index(providerID: ID, models: readonly Model.Info[]) {
  const indexes = definitions.get(models) ?? new Map<ID, ReadonlyMap<Model.ID, Model.Info>>()
  const cached = indexes.get(providerID)
  if (cached) return cached
  // Model shares these definitions without copying, so a foreign definition takes this provider's identity here.
  const result = freeze(
    new Map(models.map((model) => [model.id, model.providerID === providerID ? model : { ...model, providerID }])),
    true,
  )
  indexes.set(providerID, result)
  definitions.set(models, indexes)
  return result
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const integrations = yield* Integration.Service
    const location = yield* Location.Service
    const state = State.create<
      Map<
        ID,
        {
          provider: MutableInfo
          models: ReadonlyMap<Model.ID, Model.Info>
          sourceConnection?: IntegrationConnection.Info
        }
      >,
      Editor
    >({
      name: "provider",
      initial: () => new Map(),
      editor: (records) => {
        const maps = new WeakSet<ReadonlyMap<Model.ID, Model.Info>>()
        const models = new WeakSet<Model.Info>()
        const entry = (id: ID) => {
          const current = records.get(id)
          if (current) return current
          const added = { provider: Info.empty(id) as MutableInfo, models: new Map<Model.ID, Model.Info>() }
          records.set(id, added)
          maps.add(added.models)
          return added
        }
        const writable = (id: ID) => {
          const record = entry(id)
          if (maps.has(record.models)) return record.models as Map<Model.ID, Model.Info>
          const owned = new Map(record.models)
          record.models = owned
          maps.add(owned)
          return owned
        }
        return {
          list: () => Array.from(records.values()),
          get: (id) => records.get(id),
          add: (definition) => {
            records.set(definition.info.id, {
              provider: structuredClone(definition.info) as MutableInfo,
              models: index(definition.info.id, definition.models),
              sourceConnection: definition.sourceConnection,
            })
          },
          update: (id, update) => {
            const record = entry(id)
            update(record.provider)
            record.provider.id = id
            AISDKNative.rewrite(record.provider, {
              builtins: builtinPackages,
              specifier: record.provider.package,
              providerID: id,
              canonical: record.provider.canonical,
            })
          },
          remove: (id) => {
            records.delete(id)
          },
          models: {
            set: (id, values) => {
              entry(id).models = index(id, values)
            },
            update: (providerID, modelID, update) => {
              const record = entry(providerID)
              const target = writable(providerID)
              const current = target.get(modelID)
              const model = // An earlier add/set can publish and freeze an owned model within this fold.
                (
                  current && models.has(current) && !Object.isFrozen(current)
                    ? current
                    : current
                      ? structuredClone(current)
                      : Model.Info.default(providerID, modelID)
                ) as DeepMutable<Model.Info>
              update(model)
              model.id = modelID
              model.providerID = providerID
              AISDKNative.rewrite(model, {
                builtins: builtinPackages,
                specifier: model.package ?? record.provider.package,
                providerID,
                canonical: model.canonical ?? record.provider.canonical,
                modelID: model.modelID ?? modelID,
              })
              models.add(model)
              target.set(modelID, model)
            },
            remove: (providerID, modelID) => {
              if (!records.has(providerID)) return
              writable(providerID).delete(modelID)
            },
          },
        }
      },
      notify: () => notify,
    })
    // Registrations may outlive a borrowed service layer; their later disposal must
    // not query dependencies that have already closed.
    yield* Effect.addFinalizer(() => State.shutdown(state.reload()))
    let cached: { records: Snapshot["records"]; value: Snapshot } | undefined
    const snapshot = Effect.fn("Provider.snapshot")(function* () {
      while (true) {
        const revision = integrations.revision()
        const records = state.get()
        // Connection presence decides availability; resolving OAuth tokens belongs to execution.
        const connections = yield* integrations.list()
        // Either fold can disable a plugin that also contributed to the other domain.
        if (revision !== integrations.revision() || records !== state.get()) continue
        const byID = new Map(connections.map((integration) => [integration.id, integration]))
        const available = Array.from(records.values()).filter((record) => {
          if (record.provider.activation === "disabled") return false
          const integration = byID.get(record.provider.integrationID ?? Integration.ID.make(record.provider.id))
          // Never combine the previous account's discovered endpoints/models with a new connection.
          if (
            record.sourceConnection &&
            IntegrationConnection.key(record.sourceConnection) !==
              IntegrationConnection.key(integration?.connections[0])
          )
            return false
          if (record.provider.activation === "enabled") return true
          if (integration?.connections.length) return true
          return record.provider.integrationID === undefined && !integration
        })
        // A credential change that leaves the same definitions available is not a catalog change.
        if (
          cached?.records === records &&
          cached.value.available.length === available.length &&
          cached.value.available.every((record, index) => record === available[index])
        )
          return cached.value
        const value = freeze({ records, available, providers: available.map((record) => record.provider) }, true)
        cached = { records, value }
        return value
      }
    })
    let published: Snapshot | undefined
    const notify: Effect.Effect<void> = Effect.gen(function* () {
      const value = yield* snapshot()
      if (value === published) return
      published = value
      yield* bus.publish(
        Provider.Event.Updated,
        {},
        {
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
      )
    })
    yield* bus.subscribe([Integration.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.runForEach(() => notify),
      Effect.forkScoped({ startImmediately: true }),
    )
    return Service.of({
      transform: state.transform,
      reload: state.reload,
      get: Effect.fn("Provider.get")((id) => Effect.sync(() => freeze(state.get().get(id)?.provider, true))),
      all: Effect.fn("Provider.all")(() =>
        Effect.sync(() => Array.from(state.get().values(), (record) => freeze(record.provider, true))),
      ),
      available: Effect.fn("Provider.available")(() => snapshot().pipe(Effect.map((value) => value.providers))),
      snapshot,
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Bus.node, Integration.node, Location.node] })

const importPackage = Effect.fn("Provider.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackage.Definition
})
