export * as CodeModeFs from "./fs.js"

import { Extension } from "@opencode/codemode"
import { Glob } from "@opencode/util/glob"
import { isUtf8 } from "buffer"
import { Context, Effect, Option } from "effect"
import { constants } from "os"
import path from "path"
import { fileURLToPath } from "url"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { FileMutation } from "../file-mutation.js"
import { FileWrite } from "../file-write.js"
import { Permission } from "../permission.js"
import { fileDiff } from "../tool/plugin/file-diff.js"
import { CodeModeExecution } from "./execution.js"

/** The session's file services, which the `Bun` global reads and writes through. */
export type Services = FileAccess.Service | FileWrite.Service | FileMutation.Service

type Host = {
  readonly context: FileAccess.Invocation
  readonly access: FileAccess.Interface
  readonly fileWrite: FileWrite.Interface
  readonly fileMutation: FileMutation.Interface
  readonly permission: Permission.Interface
}
type Range = { readonly offset: number; readonly length: number }

// What a BunFile names: the path as the program wrote it, where it resolved to when `Bun.file` asked to read it, and
// the part of the file a slice covers.
type Handle = { readonly name: string; readonly target: FileAccess.Target; readonly range?: Range }

// A run gets `Bun` only with the session's file services (see `CodeModeTool.create`).
const service = <I, S>(key: Context.Key<I, S>) =>
  Effect.flatMap(Effect.serviceOption(key), (found) =>
    Option.isSome(found) ? Effect.succeed(found.value) : Effect.die("Code Mode fs needs the session's file services."),
  )

// One file operation, acting for the execute call as a tool does. A permission error reaches the program as core
// reports it; any other failure carries Node's `code`, `syscall` and `path`, so `e.code === "ENOENT"` works.
const call = <A, E>(syscall: string, name: string, body: (host: Host) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* body({
      context: yield* CodeModeExecution.Service,
      access: yield* service(FileAccess.Service),
      fileWrite: yield* service(FileWrite.Service),
      fileMutation: yield* service(FileMutation.Service),
      permission: yield* Permission.Service,
    })
  }).pipe(Effect.mapError((error) => nodeError(error, syscall, name)))

// `fs.readFile` and `fs.stat` ask read permission, and external-directory approval outside the project, once: the
// file's own reads don't ask again, and its writes ask only edit. Size and modification time are read here because a
// program's copy of the file can't ask later. A missing file has the values one reports.
const resolve = (input: string | URL, options?: { readonly type?: string }) => {
  supports("fs.readFile", options, ["type"])
  const name = toPath(input)
  return call("stat", name, (host) =>
    Effect.gen(function* () {
      const target = yield* host.access.authorizeRead(name, host.context)
      const info = yield* followed(target.environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () => Effect.undefined),
      )
      return { handle: { name, target } as Handle, info, type: options?.type ?? mime(name) }
    }),
  )
}

const read = (handle: Handle) =>
  call("open", handle.name, () =>
    Effect.map(
      handle.target.environment.files.read(handle.target.absolute, handle.range),
      // A plain Uint8Array over the same memory: a driver may give a Buffer, which Bun's `bytes()` never does.
      (result) => new Uint8Array(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength),
    ),
  )

// As in Bun, only a file exists: a directory doesn't.
const exists = (handle: Handle) =>
  call("access", handle.name, () =>
    Environment.typeFollowing(handle.target.environment.files, handle.target.absolute).pipe(
      Effect.map((type) => type === "file"),
      Effect.catchTag("Environment.NotFound", () => Effect.succeed(false)),
    ),
  )

// The part of Node's Stats that the file's environment can tell.
const stat = (handle: Handle) =>
  call("stat", handle.name, () =>
    Effect.map(followed(handle.target.environment.files, handle.target.absolute), (info) => ({
      size: info.size,
      mtimeMs: info.mtimeMs,
      mtime: new Date(info.mtimeMs),
      isFile: () => info.type === "file",
      isDirectory: () => info.type === "directory",
      isSymbolicLink: () => info.type === "symlink",
    })),
  )

// What a path leads to, through a symlink: reading zero bytes resolves one. A directory behind a link keeps the
// link's own size.
const followed = (files: Environment.Files, absolute: string) =>
  Effect.flatMap(files.stat(absolute), (own) =>
    own.type !== "symlink"
      ? Effect.succeed(own)
      : files.read(absolute, { offset: 0, length: 0 }).pipe(
          Effect.map((result) => result.info),
          Effect.catchTag("Environment.WrongKind", (error) => Effect.succeed({ ...own, type: error.actual })),
        ),
  )

// `fs.writeFile`: the bytes written. The destination is a path; the data is text, bytes, or a file handle to copy.
// Like Node with `recursive: true`, it creates missing parent directories unless `createPath` is false.
const writeTo = (destination: unknown, data: unknown, options?: { readonly createPath?: boolean }) => {
  supports("fs.writeFile", options, ["createPath"])
  if (typeof destination !== "string" && !(destination instanceof URL))
    throw new TypeError("fs.writeFile expects a path to write to.")
  return write(toPath(destination), data, options?.createPath !== false)
}

const write = (to: string, data: unknown, parents = true) =>
  contents(data).pipe(Effect.flatMap((bytes) => put(to, bytes, { parents, diff: true })))

// Writes exactly these bytes, with no formatting and no BOM handling, after asking edit permission. The request shows
// the change as a diff when both sides are text, like the write tool's. An append never reads the file: its diff
// shows only what it adds. Like an edit, it holds the file's mutation lock from reading the file to writing it, and
// writes through `FileMutation`.
const put = (
  to: string,
  bytes: Uint8Array,
  options: { readonly parents?: boolean; readonly diff?: boolean; readonly append?: boolean },
) =>
  call("open", to, (host) =>
    Effect.gen(function* () {
      const target = yield* host.fileWrite.target(to, host.context)
      return yield* Effect.gen(function* () {
        const type = yield* typeOf(target.environment.files, target.absolute)
        if (type === "directory") return yield* new Environment.WrongKind({ path: target.absolute, actual: type })
        if (
          type === undefined &&
          !options.parents &&
          (yield* typeOf(target.environment.files, path.dirname(target.absolute))) === undefined
        )
          return yield* new Environment.NotFound({ path: target.absolute })
        const after = options.diff ? text(bytes) : undefined
        const before =
          after === undefined || options.append || type === undefined
            ? ""
            : text((yield* target.environment.files.read(target.absolute)).bytes)
        yield* host.fileWrite.authorize(
          target,
          host.context,
          after !== undefined && before !== undefined
            ? fileDiff(target.resource, before, after, type === undefined ? "added" : "modified")
            : undefined,
        )
        yield* options.append
          ? host.fileMutation.append({ target, content: bytes })
          : host.fileMutation.write({ target, content: bytes })
        return bytes.byteLength
      }).pipe(host.fileMutation.withLock([target.absolute]))
    }),
  )

const typeOf = (files: Environment.Files, absolute: string) =>
  files.stat(absolute).pipe(
    Effect.map((info) => info.type),
    Effect.catchTag("Environment.NotFound", () => Effect.undefined),
  )

// Bytes as text when they are valid UTF-8.
const text = (bytes: Uint8Array) =>
  isUtf8(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString() : undefined

const contents = (data: unknown) => {
  const given = toBytes(data)
  if (given) return Effect.succeed(given)
  const body = method(data, "bytes") ?? method(data, "arrayBuffer") ?? method(data, "text")
  if (!body) return Effect.fail(unwritable())
  return Effect.tryPromise({ try: async (): Promise<unknown> => body(), catch: (error) => error }).pipe(
    Effect.flatMap((result) => {
      const bytes = toBytes(result)
      return bytes ? Effect.succeed(bytes) : Effect.fail(unwritable())
    }),
  )
}

const unwritable = () =>
  new TypeError("Bun.write expects a string, a Uint8Array, a BunFile, or a Response as the data to write.")

// A value from a program is a plain copy, so its functions are among its own entries.
const method = (value: unknown, key: string) => {
  if (typeof value !== "object" || value === null) return undefined
  const found: unknown = Object.entries(value).find(([name]) => name === key)?.[1]
  return typeof found === "function" ? found : undefined
}

// Like Bun, a number or a boolean is written as its text.
const toBytes = (value: unknown) => {
  if (typeof value === "string") return Buffer.from(value)
  if (typeof value === "number" || typeof value === "boolean") return Buffer.from(String(value))
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
}

// As `text()` does in Bun: UTF-8 without a leading byte order mark.
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// A subset of Bun's FileSink. Chunks collect here until a flush: the first replaces the file and later ones append to
// it, so a long write asks edit once per flush, with what that flush adds, not once per chunk. Bun's own sink writes
// over the start of an existing file without truncating it; this one replaces the file. As in Bun, a missing parent
// directory fails the flush.
type ScanOptions = {
  readonly cwd?: string
  readonly dot?: boolean
  readonly absolute?: boolean
  readonly onlyFiles?: boolean
}

// `scan` and `scanSync` both give an array, which `for` and `for await` both take. As in Bun without `followSymlinks`, a symlink is neither a file nor a directory to
// look inside: only `onlyFiles: false` lists one.
const scan = (pattern: string, input?: string | ScanOptions) => {
  const options = typeof input === "string" ? { cwd: input } : input
  supports("fs.glob", options, ["cwd", "dot", "absolute", "onlyFiles"])
  const cwd = options?.cwd ?? "."
  return call("scandir", cwd, (host) =>
    Effect.gen(function* () {
      const entries = (yield* glob(host, pattern, cwd, options?.dot === true)).filter(
        (entry) => options?.onlyFiles === false || entry.type === "file",
      )
      if (options?.absolute !== true) return entries.map((entry) => entry.path)
      const root = (yield* host.access.resolve({ path: cwd })).absolute
      return entries.map((entry) => path.resolve(root, entry.path))
    }),
  )
}

// The entries under `cwd` that a pattern matches, each by its path as the pattern names it, without a leading `./`.
const glob = (host: Host, given: string, cwd: string, dot: boolean) =>
  Effect.gen(function* () {
    const pattern = given.replace(/^(\.\/)+/, "")
    const segments = pattern.split("/")
    const wild = segments.findIndex((segment) => /[*?[\]{}()!+@]/.test(segment))
    // The fixed part of the pattern is where listing starts. An absolute pattern keeps its root and gives absolute
    // paths. Like the glob tool, a scan asks glob permission for the pattern, and external-directory approval for
    // where it lists outside the project.
    const fixed = (wild < 0 ? segments : segments.slice(0, wild)).join("/") || (path.isAbsolute(pattern) ? "/" : ".")
    const base = path.isAbsolute(pattern) ? fixed : path.join(cwd, fixed)
    const target = yield* host.access.resolve({ path: base, kind: "directory" })
    yield* host.access.authorizeExternal([target], host.context)
    yield* host.permission.assert({
      action: "glob",
      resources: [given],
      save: ["*"],
      metadata: { root: cwd },
      ...Permission.invocation(host.context),
    })
    const root = target.absolute
    if (wild < 0) {
      const type = yield* typeOf(target.environment.files, root)
      return type === undefined ? [] : [{ path: pattern, type }]
    }
    const entries = yield* walk(target.environment.files, root, {
      // Deep enough for every segment after the fixed part; `**` can match any depth.
      depth: pattern.includes("**") ? Infinity : segments.length - wild,
      // Without `dot`, only a segment that names a leading dot itself matches inside a hidden directory.
      hidden: dot || segments.slice(wild).some((segment) => /(^|[{,(|])\./.test(segment)),
    }).pipe(
      // As in Bun, a fixed part that isn't a directory matches nothing, while a `cwd` that isn't one fails.
      Effect.catchIf(
        (error) => wild > 0 && error._tag !== "Environment.Failed",
        () => Effect.succeed([]),
      ),
    )
    return entries
      .map((entry) => ({
        path: path.isAbsolute(pattern) ? path.join(base, entry.path) : path.join(path.relative(cwd, base), entry.path),
        type: entry.type,
      }))
      .filter((entry) => Glob.match(pattern, entry.path, { dot }))
  })

type Entry = { readonly path: string; readonly type: Environment.FileType }

// Lists `depth` levels below `directory`: 1 is its own entries, Infinity everything. It goes into a directory whose
// name starts with a dot only when `hidden` is set.
const walk = (
  files: Environment.Files,
  directory: string,
  options: { readonly depth: number; readonly hidden: boolean },
  prefix = "",
): Effect.Effect<Array<Entry>, Environment.NotFound | Environment.WrongKind | Environment.Failed> =>
  files.list(path.join(directory, prefix)).pipe(
    Effect.flatMap((entries) =>
      Effect.forEach(entries, (entry) => {
        const item = { path: path.join(prefix, entry.name), type: entry.type }
        if (options.depth <= 1 || entry.type !== "directory" || (!options.hidden && entry.name.startsWith(".")))
          return Effect.succeed([item])
        return walk(files, directory, { ...options, depth: options.depth - 1 }, item.path).pipe(
          Effect.map((inside) => [item, ...inside]),
        )
      }),
    ),
    Effect.map((items) => items.flat()),
  )

// Only part of Bun's options are implemented. Naming another fails, since ignoring it would give a wrong result.
const supports = (api: string, options: object | undefined, supported: ReadonlyArray<string>) => {
  const unsupported = Object.keys(options ?? {}).find((key) => !supported.includes(key))
  if (unsupported === undefined) return
  throw new TypeError(
    `${api} does not support the "${unsupported}" option in Code Mode. Supported options: ${supported.join(", ")}.`,
  )
}

const toPath = (input: string | URL) =>
  typeof input === "string" && !input.startsWith("file:") ? input : fileURLToPath(input)

const messages = {
  ENOENT: "no such file or directory",
  EISDIR: "illegal operation on a directory",
  ENOTDIR: "not a directory",
}

const nodeError = (error: unknown, syscall: string, file: string) => {
  const code = codeOf(error)
  if (code)
    return Object.assign(new Error(`${code}: ${messages[code]}, ${syscall} '${file}'`), {
      code,
      errno: -constants.errno[code],
      syscall,
      path: file,
    })
  if (error instanceof Environment.Failed && error.cause instanceof Error) return error.cause
  return error
}

const codeOf = (error: unknown) => {
  if (error instanceof Environment.NotFound) return "ENOENT"
  if (error instanceof Environment.WrongKind) return error.actual === "directory" ? "EISDIR" : "ENOTDIR"
}

// Bun's MIME types for common extensions, with the charset Bun adds to some text types.
const types = Object.fromEntries(
  Object.entries({
    "text/plain;charset=utf-8": ["txt", "log", "ini"],
    "text/javascript;charset=utf-8": ["js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx"],
    "application/json;charset=utf-8": ["json", "map"],
    "text/html;charset=utf-8": ["html", "htm"],
    "text/css;charset=utf-8": ["css"],
    "text/markdown": ["md"],
    "text/csv": ["csv"],
    "text/yaml": ["yaml", "yml"],
    "application/toml": ["toml"],
    "application/xml": ["xml"],
    "application/pdf": ["pdf"],
    "application/zip": ["zip"],
    "application/gzip": ["gz"],
    "application/x-tar": ["tar"],
    "application/wasm": ["wasm"],
    "image/svg+xml": ["svg"],
    "image/png": ["png"],
    "image/jpeg": ["jpg", "jpeg"],
    "image/gif": ["gif"],
    "image/webp": ["webp"],
    "image/avif": ["avif"],
    "image/x-icon": ["ico"],
    "audio/mpeg": ["mp3"],
    "audio/x-wav": ["wav"],
    "video/mp4": ["mp4"],
    "video/webm": ["webm"],
    "font/woff": ["woff"],
    "font/woff2": ["woff2"],
    "font/ttf": ["ttf"],
    "font/otf": ["otf"],
  }).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type])),
)

const mime = (name: string) => types[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream"

// `fs.readFile`: text with an encoding, else the file's bytes.
const readFile = (input: string | URL, options?: { readonly encoding?: string; readonly type?: string }) => {
  supports("fs.readFile", options, ["encoding", "type"])
  return resolve(input, { type: options?.type }).pipe(
    Effect.flatMap(({ handle }) => read(handle)),
    Effect.map((bytes) => (options?.encoding ? decode(bytes) : bytes)),
  )
}

const statPath = (input: string | URL) => resolve(input).pipe(Effect.flatMap(({ handle }) => stat(handle)))
const existsPath = (input: string | URL) => resolve(input).pipe(Effect.flatMap(({ handle }) => exists(handle)))

/** A subset of Node's promise-based fs API, over the session's files and with the permissions the file tools ask. */
export const extension = Extension.make({
  name: "fs",
  globals: {
    fs: {
      readFile,
      writeFile: Extension.async(writeTo),
      stat: statPath,
      exists: existsPath,
      glob: scan,
    },
  },
})

/** What to show for an fs call: the function, its path or pattern, and the file a write copies. */
export const display = (name: string, args: ReadonlyArray<unknown>) => ({
  method: name.slice(name.lastIndexOf(".") + 1),
  path: String(args[0]),
})
