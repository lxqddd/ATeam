import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCliModels, parseCliArgs } from './args'

const ENV = { ATEAM_API_KEY: 'env-key', ATEAM_MODEL: 'env-model' }

describe('parseCliArgs', () => {
  it('stops parsing options after a second separator', () => {
    const options = parseCliArgs(
      ['--', '--model', 'test-model', '--', '--help'],
      {},
      '/tmp/workspace'
    )

    expect(options.model).toBe('test-model')
    expect(options.help).toBe(false)
    expect(options.prompt).toBe('--help')
  })

  it('uses environment defaults and positional prompts', () => {
    const options = parseCliArgs(['--workspace', '/tmp/project', 'hello', 'world'], ENV, '/cwd')

    expect(options).toMatchObject({
      workspace: '/tmp/project',
      prompt: 'hello world',
      providerType: 'anthropic',
      apiKey: 'env-key',
      model: 'env-model',
      permissionMode: 'ask',
      dataDir: path.join(os.homedir(), '.ateam', 'cli')
    })
  })

  it('parses the restore-sessions flag', () => {
    const options = parseCliArgs(['--restore-sessions', '--data', '/tmp/ateam-data'], {}, '/cwd')
    expect(options).toMatchObject({ restoreSessions: true, dataDir: '/tmp/ateam-data' })
  })

  it('parses flags with inline values', () => {
    const options = parseCliArgs(
      [
        '--provider=openai-compatible',
        '--base-url=http://127.0.0.1:1234/v1',
        '--model=mock',
        '--permission=auto',
        '--reasoning=high',
        '--json',
        '--session=s1'
      ],
      {},
      '/cwd'
    )

    expect(options).toMatchObject({
      providerType: 'openai-compatible',
      baseURL: 'http://127.0.0.1:1234/v1',
      model: 'mock',
      permissionMode: 'auto',
      reasoning: 'high',
      json: true,
      sessionId: 's1'
    })
  })

  it('parses GitHub issue and comment references', () => {
    const options = parseCliArgs(
      [
        '--github-issue',
        'owner/repo#12',
        '--github-comment=https://github.com/o/r/pull/3',
        'fix it'
      ],
      {},
      '/cwd'
    )

    expect(options).toMatchObject({
      githubIssue: 'owner/repo#12',
      githubComment: 'https://github.com/o/r/pull/3',
      prompt: 'fix it'
    })
  })

  it('ignores a bare -- separator from package managers', () => {
    const options = parseCliArgs(['--', '--model', 'm', 'hello'], ENV)

    expect(options).toMatchObject({ model: 'm', prompt: 'hello' })
  })

  it('rejects unknown flags and invalid enums', () => {
    expect(() => parseCliArgs(['--nope'], ENV)).toThrow('Unknown flag')
    expect(() => parseCliArgs(['--provider', 'invalid'], ENV)).toThrow('--provider')
    expect(() => parseCliArgs(['--permission', 'yolo'], ENV)).toThrow('--permission')
  })

  it('requires values for value flags', () => {
    expect(() => parseCliArgs(['--model'], ENV)).toThrow('requires a value')
  })
})

describe('buildCliModels', () => {
  it('builds a runtime model config', () => {
    const options = parseCliArgs(
      ['--provider', 'openai', '--api-key', 'key', '--model', 'gpt-test', '--max-output', '4096'],
      {}
    )

    const config = buildCliModels(options)

    expect(config.defaultModel).toEqual({ providerId: 'cli', modelId: 'gpt-test' })
    expect(config.providers[0]).toMatchObject({ type: 'openai', apiKey: 'key' })
    expect(config.models[0]).toMatchObject({ modelId: 'gpt-test', maxOutputTokens: 4096 })
  })

  it('requires a model and credentials', () => {
    expect(() => buildCliModels(parseCliArgs([], {}))).toThrow('model is required')
    expect(() => buildCliModels(parseCliArgs(['--model', 'm'], {}))).toThrow('API key is required')
    expect(() =>
      buildCliModels(parseCliArgs(['--provider', 'openai-compatible', '--model', 'm'], {}))
    ).toThrow('--base-url')
  })
})
