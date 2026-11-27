import { describe, expect, it } from 'vitest'
import {
  githubCommentSchema,
  githubContextSchema,
  githubCreatePullSchema,
  githubListSchema,
  githubRepoRequestSchema,
  githubTokenSchema
} from './github-schema'

describe('GitHub IPC schemas', () => {
  it('accepts a trimmed token and rejects empty values', () => {
    expect(githubTokenSchema.parse({ token: ' ghp_123 ' })).toEqual({ token: 'ghp_123' })
    expect(() => githubTokenSchema.parse({ token: '   ' })).toThrow()
    expect(() => githubTokenSchema.parse({})).toThrow()
  })

  it('accepts an optional directory for repository detection', () => {
    expect(githubRepoRequestSchema.parse({})).toEqual({})
    expect(githubRepoRequestSchema.parse({ directory: null })).toEqual({ directory: null })
    expect(githubRepoRequestSchema.parse({ directory: '/repo' })).toEqual({ directory: '/repo' })
    expect(() => githubRepoRequestSchema.parse({ directory: '' })).toThrow()
  })

  it('accepts issue and pull listing requests', () => {
    expect(githubListSchema.parse({ repo: 'octo/repo', kind: 'pull' })).toEqual({
      repo: 'octo/repo',
      kind: 'pull'
    })
    expect(() => githubListSchema.parse({ repo: 'octo/repo', kind: 'other' })).toThrow()
    expect(() => githubListSchema.parse({ repo: '' })).toThrow()
  })

  it('validates context, comment and pull request payloads', () => {
    expect(githubContextSchema.parse({ ref: 'octo/repo#1' })).toEqual({ ref: 'octo/repo#1' })
    expect(() => githubCommentSchema.parse({ ref: 'octo/repo#1', body: '  ' })).toThrow()
    expect(
      githubCreatePullSchema.parse({
        repo: 'octo/repo',
        title: 'Title',
        body: '',
        base: 'main',
        head: 'feature',
        draft: true
      })
    ).toEqual({
      repo: 'octo/repo',
      title: 'Title',
      body: '',
      base: 'main',
      head: 'feature',
      draft: true
    })
    expect(() =>
      githubCreatePullSchema.parse({
        repo: 'octo/repo',
        title: 'Title',
        body: '',
        base: 'main',
        head: 'feature'
      })
    ).toThrow()
  })
})
