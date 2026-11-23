/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_NAME = process.platform === 'win32' ? 'ateam.exe' : 'ateam'

function fail(message) {
  throw new Error(message)
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function resolveExecutable(dist) {
  if (process.env.ATEAM_PACKAGED_APP) return process.env.ATEAM_PACKAGED_APP
  const candidates = []
  if (process.platform === 'darwin') {
    for (const entry of await fs.readdir(dist).catch(() => [])) {
      if (entry.startsWith('mac')) {
        candidates.push(path.join(dist, entry, 'ATeam.app', 'Contents', 'MacOS', 'ATeam'))
      }
    }
  } else if (process.platform === 'win32') {
    candidates.push(path.join(dist, 'win-unpacked', APP_NAME))
    candidates.push(path.join(dist, 'win-unpacked', 'ATeam.exe'))
  } else {
    candidates.push(path.join(dist, 'linux-unpacked', APP_NAME))
    candidates.push(path.join(dist, 'linux-unpacked', 'ATeam'))
    candidates.push(path.join(dist, 'linux-unpacked', '@ateamdesktop'))
    candidates.push(path.join(dist, 'linux-unpacked', 'ateam-desktop'))
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  fail(`Packaged executable not found. Run build:unpack first. Tried: ${candidates.join(', ')}`)
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForTarget(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        const page = targets.find(
          (target) => target.type === 'page' && target.url.includes('index.html')
        )
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
      }
    } catch {
      /* the app is still starting */
    }
    if (Date.now() > deadline) fail('Timed out waiting for the packaged window')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url)
    this.id = 0
    this.pending = new Map()
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to CDP')), 10_000)
      this.socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      this.socket.addEventListener(
        'error',
        (event) => {
          clearTimeout(timer)
          reject(event.error ?? new Error('CDP WebSocket error'))
        },
        { once: true }
      )
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const handler = this.pending.get(message.id)
      if (!handler) return
      this.pending.delete(message.id)
      if (message.error) handler.reject(new Error(message.error.message))
      else handler.resolve(message.result)
    })
  }

  async send(method, params = {}) {
    await this.opened
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (result.exceptionDetails) {
      console.error('[smoke] evaluation failed', JSON.stringify(result.exceptionDetails))
      fail(result.exceptionDetails.exception?.description ?? 'Evaluation failed')
    }
    return result.result.value
  }

  close() {
    this.socket.close()
  }
}

function startModelMock() {
  const server = http.createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    if (request.url === '/repos/lxqddd/ATeam/releases/latest') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          tag_name: 'v99.0.0',
          name: 'ATeam 99.0.0',
          body: 'Packaged update smoke.',
          html_url: 'https://github.com/lxqddd/ATeam/releases/tag/v99.0.0',
          published_at: '2026-11-22T00:00:00.000Z',
          draft: false,
          prerelease: false,
          assets: [
            {
              name: 'ATeam-99.0.0-arm64.dmg',
              browser_download_url:
                'https://github.com/lxqddd/ATeam/releases/download/v99.0.0/ATeam-99.0.0-arm64.dmg',
              size: 1024,
              content_type: 'application/octet-stream',
              digest: null
            },
            {
              name: 'ATeam-99.0.0-x64.dmg',
              browser_download_url:
                'https://github.com/lxqddd/ATeam/releases/download/v99.0.0/ATeam-99.0.0-x64.dmg',
              size: 1024,
              content_type: 'application/octet-stream',
              digest: null
            },
            {
              name: 'ATeam-99.0.0-x64-setup.exe',
              browser_download_url:
                'https://github.com/lxqddd/ATeam/releases/download/v99.0.0/ATeam-99.0.0-x64-setup.exe',
              size: 1024,
              content_type: 'application/octet-stream',
              digest: null
            },
            {
              name: 'ATeam-99.0.0-x86_64.AppImage',
              browser_download_url:
                'https://github.com/lxqddd/ATeam/releases/download/v99.0.0/ATeam-99.0.0-x86_64.AppImage',
              size: 1024,
              content_type: 'application/octet-stream',
              digest: null
            },
            {
              name: 'ateam_99.0.0_amd64.deb',
              browser_download_url:
                'https://github.com/lxqddd/ATeam/releases/download/v99.0.0/ateam_99.0.0_amd64.deb',
              size: 1024,
              content_type: 'application/octet-stream',
              digest: null
            }
          ]
        })
      )
      return
    }
    if (!request.url?.endsWith('/chat/completions')) {
      response.writeHead(404).end('{}')
      return
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    const hasToolResult = (body.messages ?? []).some((message) => message.role === 'tool')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const base = { id: 'smoke', object: 'chat.completion.chunk', created: 1, model: 'smoke-model' }
    const write = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`)
    if (!hasToolResult) {
      write({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'grep', arguments: '{"pattern":"needle"}' }
                }
              ]
            },
            finish_reason: null
          }
        ]
      })
      write({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      })
    } else {
      write({
        ...base,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'Packaged smoke found the needle.' },
            finish_reason: null
          }
        ]
      })
      write({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 }
      })
    }
    response.write('data: [DONE]\n\n')
    response.end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

async function run() {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const executable = await resolveExecutable(path.join(appRoot, 'dist'))
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'ateam-packaged-smoke-'))
  const port = await freePort()
  const mock = await startModelMock()
  const logs = []
  const args = [
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${port}`,
    ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : [])
  ]
  console.error(`[smoke] launching ${executable}`)
  const child = spawn(executable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ATEAM_GITHUB_API_URL: `http://127.0.0.1:${mock.port}` }
  })
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()))

  let cdp = null
  try {
    console.error(`[smoke] waiting for window on port ${port}`)
    const wsUrl = await waitForTarget(port)
    console.error('[smoke] connecting to renderer')
    cdp = new Cdp(wsUrl)
    console.error('[smoke] checking agent status')
    const health = await cdp.evaluate(`(async () => {
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        const status = await window.api.agent.status()
        const text = document.body.innerText
        if (status.status === 'ready' && text.includes('ATeam')) {
          return { status: status.status, title: document.title, text }
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      return { status: 'timeout', title: document.title, text: document.body.innerText }
    })()`)
    if (health.status !== 'ready') fail(`Agent worker did not start: ${health.status}`)
    if (!health.text.includes('ATeam')) fail('App shell did not render')

    const update = await cdp.evaluate('window.api.updates.check()')
    if (!update.available || update.latestVersion !== '99.0.0' || !update.asset) {
      fail(`Update check failed: ${JSON.stringify(update)}`)
    }
    const updateText = await cdp.evaluate(`(async () => {
      location.hash = '#/settings?section=update'
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        if (document.body.innerText.includes('99.0.0')) return document.body.innerText
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return document.body.innerText
    })()`)
    if (!updateText.includes('99.0.0')) fail('Update settings section did not render the release')

    console.error('[smoke] configuring model')
    const setup = await cdp.evaluate(`(async () => {
      const config = await window.api.models.addProvider({
        name: 'Smoke',
        type: 'openai-compatible',
        baseURL: 'http://127.0.0.1:${mock.port}/v1',
      })
      const provider = config.providers.find((entry) => entry.name === 'Smoke')
      await window.api.models.addModel({
        providerId: provider.id,
        modelId: 'smoke-model',
        name: 'Smoke Model',
        contextWindow: 128000
      })
      await window.api.models.setDefault({ providerId: provider.id, modelId: 'smoke-model' })
      const session = await window.api.agent.sessions.create()
      return session.id
    })()`)

    const workspace = path.join(userData, 'agent-workspace')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(path.join(workspace, 'needle.txt'), 'contains needle here\n')

    console.error('[smoke] running chat')
    const result = await cdp.evaluate(`(async () => {
      await window.api.agent.chat.send({ sessionId: ${JSON.stringify(setup)}, text: 'find needle' })
      const deadline = Date.now() + 30000
      let snapshot = null
      while (Date.now() < deadline) {
        snapshot = await window.api.agent.messages.list(${JSON.stringify(setup)})
        if (snapshot.messages.some((message) => message.role === 'assistant' && message.status !== 'streaming')) break
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      const sessions = await window.api.agent.sessions.list()
      return { snapshot, sessions }
    })()`)
    if (!result.sessions.some((session) => session.id === setup)) fail('Session was not persisted')
    const assistant = result.snapshot?.messages?.find((message) => message.role === 'assistant')
    const text = assistant?.parts
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
    const tool = assistant?.parts?.find((part) => part.type === 'tool')
    if (!text?.includes('Packaged smoke found the needle')) {
      fail(`Unexpected assistant response: ${JSON.stringify(assistant?.parts)}`)
    }
    if (!String(tool?.output ?? '').includes('needle.txt:1')) {
      fail(`grep tool did not run in the packaged app: ${JSON.stringify(tool)}`)
    }
    console.log(`Packaged smoke passed: ${health.title} / ${setup}`)
  } finally {
    cdp?.close()
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill()
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    child.stdout?.destroy()
    child.stderr?.destroy()
    await new Promise((resolve) => mock.server.close(resolve))
    await fs.rm(userData, { recursive: true, force: true }).catch(() => undefined)
    if (process.env.SMOKE_DEBUG) console.log(logs.join(''))
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
