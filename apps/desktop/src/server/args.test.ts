import { describe, expect, it } from 'vitest'
import { parseServerArgs } from './args'

describe('parseServerArgs', () => {
  it('uses server defaults and forwards model flags', () => {
    const options = parseServerArgs(
      ['--provider', 'openai', '--api-key', 'key', '--model', 'gpt-test'],
      {},
      '/cwd'
    )

    expect(options).toMatchObject({
      host: '127.0.0.1',
      port: 4096,
      token: null,
      help: false
    })
    expect(options.cli).toMatchObject({
      providerType: 'openai',
      apiKey: 'key',
      model: 'gpt-test',
      workspace: '/cwd'
    })
  })

  it('parses server flags with inline values', () => {
    const options = parseServerArgs(
      ['--host=0.0.0.0', '--port=8080', '--token=secret', '--model=m'],
      {}
    )

    expect(options).toMatchObject({ host: '0.0.0.0', port: 8080, token: 'secret' })
  })

  it('reads the token from the environment and supports help', () => {
    const options = parseServerArgs(['--help'], { ATEAM_SERVER_TOKEN: 'env-token' })
    expect(options).toMatchObject({ help: true, token: 'env-token' })
  })

  it('rejects invalid ports', () => {
    expect(() => parseServerArgs(['--port', '99999'], {})).toThrow('--port')
    expect(() => parseServerArgs(['--port'], {})).toThrow('requires a value')
  })
})
