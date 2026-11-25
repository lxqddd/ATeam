import { describe, expect, it } from 'vitest'
import { parseShellCommand, splitShellSegments, tokenizeShellSegment } from './shell-parse'

describe('shell parser', () => {
  it('splits bash and PowerShell separators outside quotes', () => {
    expect(splitShellSegments('echo "a && b" | grep x; pwd')).toEqual([
      'echo "a && b"',
      'grep x',
      'pwd'
    ])
    expect(splitShellSegments('Get-ChildItem; Write-Output "a;b"')).toEqual([
      'Get-ChildItem',
      'Write-Output "a;b"'
    ])
  })

  it('splits cmd chaining operators', () => {
    expect(splitShellSegments('cmd /c "echo a & echo b" & echo done')).toEqual([
      'cmd /c "echo a & echo b"',
      'echo done'
    ])
  })

  it('tokenizes quotes and escapes', () => {
    expect(tokenizeShellSegment('echo "a b" \'c d\' e')).toEqual(['echo', 'a b', 'c d', 'e'])
    expect(tokenizeShellSegment('echo a\\ b')).toEqual(['echo', 'a b'])
  })

  it('keeps redirections inside the segment', () => {
    expect(parseShellCommand('cat < in.txt > out.txt').segments).toEqual(['cat < in.txt > out.txt'])
    expect(parseShellCommand('cmd 2>&1 | tee log').segments).toEqual(['cmd 2>&1', 'tee log'])
  })

  it('marks command substitutions and variables as dynamic', () => {
    expect(parseShellCommand('echo $(date)').dynamic).toBe(true)
    expect(parseShellCommand('echo `date`').dynamic).toBe(true)
    expect(parseShellCommand('echo %PATH%').dynamic).toBe(true)
    expect(parseShellCommand('echo plain').dynamic).toBe(false)
  })
})
