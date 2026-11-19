#!/usr/bin/env node

// Compiles the built-in sources (the prelude, the VM's internal helpers) ahead of time into src/language/prelude/bytecode.json,
// which a process loads instead of parsing and compiling them (see src/language/prelude/bytecode.ts). Run it after changing
// either source or the compiler; test/prelude-bytecode.test.ts fails until then.

import { writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { parse } from "acorn"
import { Source } from "../src/language/runtime/source.js"
import { saveCodes } from "../src/language/prelude/bytecode.js"
import { code } from "../src/language/prelude/source.js"
import { compileSource } from "../src/language/compiler/compile.js"
import { INTERNAL_SOURCE } from "../src/language/internal-prelude.js"

export const compileBuiltins = () =>
  Object.fromEntries(
    [
      ["@prelude", code],
      ["@vm-internal", INTERNAL_SOURCE],
    ].map(([id, text]) => {
      const source = new Source(id!, text!, parse(text!, { ecmaVersion: "latest", sourceType: "script" }))
      return [id, saveCodes(text!, compileSource(source, { internal: true }))]
    }),
  )

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(new URL("../src/language/prelude/bytecode.json", import.meta.url), `${JSON.stringify(compileBuiltins())}\n`)
}
