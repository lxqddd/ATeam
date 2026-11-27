import { describe, expect, it } from 'vitest'
import { defaultCliDataDir } from '../cli/args'
import { defaultUserDataDir } from '../cli/config'
import { parseTuiArgs } from './args'

const HOME = '/home/tester'

function env(values: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...values }
}

describe('parseTuiArgs', () => {
  it('defaults to a local session in the current directory', () => {
    const options = parseTuiArgs([], env(), '/work', HOME)
    expect(options).toMatchObject({
      workspace: '/work',
      dataDir: defaultCliDataDir(),
      userData: defaultUserDataDir(env(), process.platform, HOME),
      sessionId: null,
      attachUrl: null,
      token: null,
      providerType: 'anthropic',
      model: '',
      reasoning: null,
      permissionMode: 'ask',
      agent: null,
      color: true,
      help: false
    })
  })

  it('reads model settings from the environment', () => {
    const options = parseTuiArgs(
      [],
      env({
        ATEAM_PROVIDER: 'openai',
        ATEAM_MODEL: 'gpt-test',
        ATEAM_API_KEY: 'sk-test',
        ATEAM_BASE_URL: 'https://api.example',
        ATEAM_SERVER_TOKEN: 'server-token'
      }),
      '/work',
      HOME
    )
    expect(options.providerType).toBe('openai')
    expect(options.model).toBe('gpt-test')
    expect(options.apiKey).toBe('sk-test')
    expect(options.baseURL).toBe('https://api.example')
    expect(options.token).toBe('server-token')
  })

  it('honors NO_COLOR', () => {
    expect(parseTuiArgs([], env({ NO_COLOR: '1' }), '/work', HOME).color).toBe(false)
  })

  it('parses separate and inline values, resolving paths', () => {
    const options = parseTuiArgs(
      [
        '--workspace',
        'project',
        '--data=store',
        '--user-data',
        'user-data',
        '--session',
        'session-1',
        '--attach',
        'http://127.0.0.1:4310/',
        '--token',
        'token-1',
        '--provider',
        'openai-compatible',
        '--base-url',
        'https://llm.example',
        '--api-key',
        'sk-test',
        '--model=local-model',
        '--context-window',
        '128000',
        '--max-output',
        '4096',
        '--reasoning',
        'high',
        '--permission',
        'auto',
        '--agent',
        'build',
        '--no-color'
      ],
      env(),
      '/base',
      HOME
    )
    expect(options).toMatchObject({
      workspace: '/base/project',
      dataDir: '/base/store',
      userData: '/base/user-data',
      sessionId: 'session-1',
      attachUrl: 'http://127.0.0.1:4310',
      token: 'token-1',
      providerType: 'openai-compatible',
      baseURL: 'https://llm.example',
      apiKey: 'sk-test',
      model: 'local-model',
      contextWindow: 128000,
      maxOutputTokens: 4096,
      reasoning: 'high',
      permissionMode: 'auto',
      agent: 'build',
      color: false
    })
  })

  it('accepts a help flag without requiring other values', () => {
    expect(parseTuiArgs(['--help'], env(), '/work', HOME).help).toBe(true)
    expect(parseTuiArgs(['-h'], env(), '/work', HOME).help).toBe(true)
    expect(parseTuiArgs(['--'], env(), '/work', HOME).help).toBe(false)
  })

  it.each([
    [['--model'], '--model requires a value'],
    [['--unknown'], 'Unknown flag: --unknown'],
    [['extra'], 'Unexpected argument: extra'],
    [['--provider', 'nope'], '--provider must be one of'],
    [['--reasoning', 'nope'], '--reasoning must be one of'],
    [['--permission', 'nope'], '--permission must be one of'],
    [['--context-window', '0'], '--context-window must be a positive integer'],
    [['--max-output', '1.5'], '--max-output must be a positive integer'],
    [['--attach', 'ftp://example'], '--attach must be an http(s) URL'],
    [['--attach', 'not a url'], '--attach must be an http(s) URL']
  ])('rejects %j', (argv, message) => {
    expect(() => parseTuiArgs(argv, env(), '/work', HOME)).toThrow(message)
  })

  it('rejects an invalid provider in the environment', () => {
    expect(() => parseTuiArgs([], env({ ATEAM_PROVIDER: 'nope' }), '/work', HOME)).toThrow(
      'ATEAM_PROVIDER must be one of'
    )
  })
})
