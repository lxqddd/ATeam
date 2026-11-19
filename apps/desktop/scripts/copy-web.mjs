import { cp, rm } from 'node:fs/promises'
import path from 'node:path'

const webDist = path.resolve(import.meta.dirname, '../../web/dist')
const target = path.resolve(import.meta.dirname, '../dist/renderer')

await rm(target, { recursive: true, force: true })
await cp(webDist, target, { recursive: true })
console.log(`Copied renderer: ${webDist} -> ${target}`)
